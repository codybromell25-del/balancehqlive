import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { userClient } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Ask questions about the studio's own numbers.
 *
 * Claude gets a fixed set of read-only tools that map to the same Postgres
 * functions the dashboard uses. It cannot write SQL, cannot reach a table
 * directly, and cannot see anything the signed-in user could not already see:
 * every query runs through the user's own Supabase session, so row level
 * security and the owner-only gate on member details still apply.
 *
 * The API key lives only on the server. The browser never sees it.
 */

const MODEL = "claude-opus-5";
const MAX_TOOL_TURNS = 6;

const SYSTEM = `You answer questions about a Pilates studio's own performance data.

You have tools that return figures from the studio's database. Always call a
tool rather than guessing or estimating — you have no knowledge of this
business beyond what the tools return.

How to answer:
- Lead with the number, then the context. Studio owners are busy.
- Use euros and round sensibly. €57,206 not €57205.72.
- If a comparison is meaningful, make it: this period against the last, or one
  location against the others.
- Say what you don't know. Some things genuinely are not in the data.

Things about this data that will otherwise mislead you:
- Fill rate counts seats used, not seats sold. Momence's own reports count a
  late cancellation as a booking, so their fill rate reads higher than ours.
- Roughly €425,000 of historical revenue has no location attached — it came
  from a MindBody import that did not carry the site. Per-location revenue
  therefore does not sum to the studio total.
- Limerick opened on 25 May 2026. Comparing it to sites open since November
  on anything cumulative is unfair, and its intro-offer cohorts are young.
- No-shows are inferred: a booking on a finished class, never checked in and
  never cancelled. This matches Momence's own count to within 1%.
- Intro-offer conversion only counts cohorts older than 60 days, because the
  median conversion takes 23 days and recent buyers have not had time.

Keep answers to a few sentences unless asked for more. Plain prose, no
markdown headers, no bullet lists unless comparing three or more things.`;

/** The tools. Each maps to one Postgres function the dashboard already uses. */
const TOOLS: Anthropic.Tool[] = [
  {
    name: "get_overview",
    description:
      "Classes, capacity, attendance, no-shows, fill rate, revenue and new members for a date range. Optionally for one location. This is the starting point for most questions.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date, YYYY-MM-DD" },
        to: { type: "string", description: "End date, YYYY-MM-DD" },
        location_id: {
          type: "integer",
          description: "Momence location id. Omit for all locations.",
        },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_revenue",
    description:
      "Revenue for a date range, broken down by location and by what was sold, with a daily trend. Use for money questions.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
        location_name: {
          type: "string",
          description: "Exact location name, e.g. 'balance - Clane'. Omit for all.",
        },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_schedule_heatmap",
    description:
      "Fill rate by weekday and hour, for finding which time slots are weak or strong. weekday is 1=Monday.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
        location_id: { type: "integer" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_teacher_and_class_performance",
    description:
      "Fill rate and no-show rate by teacher and by class format, for anyone with 10+ classes in the range. Teacher names are only returned to studio owners.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
        location_id: { type: "integer" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_membership_health",
    description:
      "Member lifecycle counts (new, regular, occasional, lapsing, lost), monthly active members split new versus returning, and cohort retention.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_intro_offers",
    description:
      "Intro-offer conversion: how many were sold, how many bought again, how long they took, and the split by location. Only counts cohorts older than 60 days.",
    input_schema: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
      required: ["from", "to"],
    },
  },
  {
    name: "get_cancellations",
    description:
      "Cancellation counts by how much notice was given, plus unsold seats, for a date range.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
        location_id: { type: "integer" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "list_locations",
    description:
      "The studio's locations with their ids and names. Call this first if a question names a site, so you can resolve it to an id.",
    input_schema: { type: "object", properties: {} },
  },
];

export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "Chat is not configured — ANTHROPIC_API_KEY is not set." },
      { status: 503 },
    );
  }

  const db = await userClient();
  const {
    data: { user },
  } = await db.auth.getUser();

  // The tools run as this user, so an unauthenticated caller would see
  // nothing anyway — but there is no reason to spend tokens finding out.
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: { question?: string; history?: Anthropic.MessageParam[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }

  const question = (body.question ?? "").trim();
  if (!question) {
    return NextResponse.json({ error: "No question" }, { status: 400 });
  }
  if (question.length > 1000) {
    return NextResponse.json({ error: "Question too long" }, { status: 400 });
  }

  /** Run one tool. Everything goes through the user's session, so RLS applies. */
  async function runTool(name: string, input: Record<string, unknown>) {
    const loc = input.location_id as number | undefined;
    switch (name) {
      case "get_overview":
        return db.rpc("dashboard_summary", {
          p_from: input.from, p_to: input.to, p_location: loc ?? null,
        });
      case "get_revenue":
        return db.rpc("dashboard_revenue", {
          p_from: input.from, p_to: input.to,
          p_location: (input.location_name as string) ?? null,
        });
      case "get_schedule_heatmap":
        return db.rpc("dashboard_heatmap", {
          p_from: input.from, p_to: input.to, p_location: loc ?? null,
        });
      case "get_teacher_and_class_performance":
        return db.rpc("dashboard_performance", {
          p_from: input.from, p_to: input.to, p_location: loc ?? null,
        });
      case "get_membership_health": {
        const [life, trend, cohorts] = await Promise.all([
          db.rpc("dashboard_lifecycle", {}),
          db.rpc("dashboard_membership_trend", { p_months: 12 }),
          db.rpc("dashboard_cohorts", { p_months: 9 }),
        ]);
        return { data: { lifecycle: life.data, monthly: trend.data, cohorts: cohorts.data }, error: null };
      }
      case "get_intro_offers":
        return db.rpc("dashboard_intro_offers", {
          p_from: input.from, p_to: input.to, p_mature_days: 60,
        });
      case "get_cancellations":
        return db.rpc("dashboard_cancellations", {
          p_from: input.from, p_to: input.to, p_location: loc ?? null,
        });
      case "list_locations":
        return db.from("locations").select("momence_location_id, name").order("name");
      default:
        return { data: null, error: { message: `Unknown tool: ${name}` } };
    }
  }

  const client = new Anthropic({ apiKey: key });
  const today = new Date().toISOString().slice(0, 10);

  const messages: Anthropic.MessageParam[] = [
    ...(body.history ?? []).slice(-8),
    { role: "user", content: `Today is ${today}.\n\n${question}` },
  ];

  try {
    for (let turn = 0; turn <= MAX_TOOL_TURNS; turn++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        // Low effort: these are lookups and comparisons over small JSON
        // results, not problems that reward deep reasoning — and the user
        // is paying per token.
        output_config: { effort: "low" },
        system: SYSTEM,
        tools: TOOLS,
        messages,
      });

      if (response.stop_reason !== "tool_use") {
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();

        return NextResponse.json({
          answer: text || "I could not find an answer to that in the data.",
          history: [...messages, { role: "assistant", content: response.content }].slice(-10),
          usage: response.usage,
        });
      }

      messages.push({ role: "assistant", content: response.content });

      // All tool_result blocks must go back in a single user message.
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const { data, error } = await runTool(
          block.name,
          block.input as Record<string, unknown>,
        );
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          is_error: Boolean(error),
          content: error ? String(error.message ?? error) : JSON.stringify(data).slice(0, 60_000),
        });
      }
      messages.push({ role: "user", content: results });
    }

    return NextResponse.json({
      answer:
        "That took more lookups than I'm allowed in one go. Try asking something narrower.",
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "Rate limited — try again shortly." }, { status: 429 });
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: "The Anthropic API key was rejected." }, { status: 502 });
    }
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `Claude API error ${err.status}` }, { status: 502 });
    }
    return NextResponse.json({ error: "Something went wrong answering that." }, { status: 500 });
  }
}
