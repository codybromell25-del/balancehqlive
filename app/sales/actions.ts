"use server";

import { getAccess } from "@/lib/access";
import { isUuid } from "@/lib/instructors";
import { isDay } from "@/lib/marketing";
import {
  LEAD_DETAIL_COLUMNS,
  LEAD_LIST_COLUMNS,
  formatPhone,
  isArea,
  isCategory,
  isStatus,
  statusLabel,
  type Activity,
  type LeadDetail,
  type LeadRow,
  type Status,
} from "@/lib/sales";

/**
 * Writes for the sales dashboard. Each runs as the signed-in person, so row
 * level security decides (migration 0022); these checks give a readable
 * message.
 *
 * Nothing here revalidates the page: the list holds every lead, and
 * re-sending all of them after each logged call would make the dashboard
 * crawl. Each action returns the lead as it now stands and the page swaps
 * that one row in.
 */

const NO_ACCESS = "Your account can't use the sales dashboard.";
const GONE = "That lead no longer exists.";
const clean = (v: unknown) => (typeof v === "string" ? v.trim() : "");

type Result<T> = { ok: false; error: string } | ({ ok: true } & T);

/** "Wed 11 Nov 2026" */
const readableDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IE", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export async function getLead(id: string): Promise<Result<{ lead: LeadDetail; activities: Activity[] }>> {
  const { db, canSell } = await getAccess();
  if (!canSell) return { ok: false, error: NO_ACCESS };
  if (!isUuid(id)) return { ok: false, error: GONE };

  const [{ data: lead }, { data: activities, error }] = await Promise.all([
    db.from("sales_leads").select(LEAD_DETAIL_COLUMNS).eq("id", id).maybeSingle(),
    db
      .from("sales_activities")
      .select("id, kind, body, author_email, created_at")
      .eq("lead_id", id)
      .order("created_at", { ascending: false }),
  ]);
  if (error) return { ok: false, error: error.message };
  if (!lead) return { ok: false, error: GONE };
  return { ok: true, lead: lead as LeadDetail, activities: (activities ?? []) as Activity[] };
}

/**
 * Logs a call, email, meeting or note. Any contact moves a new lead to
 * "contacted" and stamps when they were last spoken to.
 */
export async function logActivity(input: {
  leadId: string;
  kind: "call" | "email" | "meeting" | "note";
  body: string;
}): Promise<Result<{ lead: LeadRow; activity: Activity }>> {
  const { db, canSell } = await getAccess();
  if (!canSell) return { ok: false, error: NO_ACCESS };
  if (!isUuid(input.leadId)) return { ok: false, error: GONE };
  if (!["call", "email", "meeting", "note"].includes(input.kind)) return { ok: false, error: "Choose what happened." };
  const body = clean(input.body);
  if (input.kind === "note" && !body) return { ok: false, error: "Write the note first." };
  if (body.length > 4000) return { ok: false, error: "Keep it under 4,000 characters." };

  const { data: activity, error } = await db
    .from("sales_activities")
    .insert({ lead_id: input.leadId, kind: input.kind, body: body || null })
    .select("id, kind, body, author_email, created_at")
    .single();
  if (error) return { ok: false, error: error.message };

  const { data: current } = await db.from("sales_leads").select("status").eq("id", input.leadId).maybeSingle();
  if (!current) return { ok: false, error: GONE };
  const change: Record<string, unknown> = {};
  if (input.kind !== "note") change.last_contact_at = new Date().toISOString();
  if (input.kind !== "note" && current.status === "new") change.status = "contacted";

  const { data: lead, error: updateError } = Object.keys(change).length
    ? await db.from("sales_leads").update(change).eq("id", input.leadId).select(LEAD_LIST_COLUMNS).single()
    : await db.from("sales_leads").select(LEAD_LIST_COLUMNS).eq("id", input.leadId).single();
  if (updateError) return { ok: false, error: updateError.message };

  return { ok: true, lead: lead as LeadRow, activity: activity as Activity };
}

/**
 * Moves a lead along. A follow-up date can come with any status; picking
 * "follow up" without one is allowed, the date can be set after.
 */
export async function setStatus(input: {
  leadId: string;
  status: Status;
  followUpOn: string | null;
}): Promise<Result<{ lead: LeadRow; activity: Activity | null }>> {
  const { db, canSell } = await getAccess();
  if (!canSell) return { ok: false, error: NO_ACCESS };
  if (!isUuid(input.leadId)) return { ok: false, error: GONE };
  if (!isStatus(input.status)) return { ok: false, error: "Choose a status." };
  if (input.followUpOn !== null && !isDay(input.followUpOn)) return { ok: false, error: "That date isn't valid." };

  const { data: before } = await db.from("sales_leads").select("status, follow_up_on").eq("id", input.leadId).maybeSingle();
  if (!before) return { ok: false, error: GONE };

  const { data: lead, error } = await db
    .from("sales_leads")
    .update({ status: input.status, follow_up_on: input.followUpOn })
    .eq("id", input.leadId)
    .select(LEAD_LIST_COLUMNS)
    .single();
  if (error) return { ok: false, error: error.message };

  // Keep a line in the history whenever the status or date moves.
  const parts: string[] = [];
  if (before.status !== input.status) parts.push(`Status: ${statusLabel(input.status)}`);
  if ((before.follow_up_on ?? null) !== input.followUpOn) {
    parts.push(input.followUpOn ? `Follow up on ${readableDay(input.followUpOn)}` : "Follow-up date cleared");
  }
  let activity: Activity | null = null;
  if (parts.length) {
    const { data } = await db
      .from("sales_activities")
      .insert({ lead_id: input.leadId, kind: "status", body: parts.join(" · ") })
      .select("id, kind, body, author_email, created_at")
      .single();
    activity = (data as Activity) ?? null;
  }
  return { ok: true, lead: lead as LeadRow, activity };
}

/** A lead the salesperson found themselves. */
export async function addLead(form: FormData): Promise<Result<{ lead: LeadRow }>> {
  const { db, canSell, salesStudioId } = await getAccess();
  if (!canSell || !salesStudioId) return { ok: false, error: NO_ACCESS };

  const name = clean(form.get("name"));
  const category = clean(form.get("category"));
  const area = clean(form.get("area"));
  const email = clean(form.get("email")).toLowerCase();
  const phone = clean(form.get("phone"));
  if (!name) return { ok: false, error: "Add the organisation's name." };
  if (!isCategory(category)) return { ok: false, error: "Choose what kind of organisation it is." };
  if (!isArea(area)) return { ok: false, error: "Choose the nearest studio." };
  if (!phone && !email) return { ok: false, error: "Add a phone number or an email." };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "That email doesn't look right." };

  const { data: lead, error } = await db
    .from("sales_leads")
    .insert({
      studio_id: salesStudioId,
      name,
      category,
      area,
      phone: formatPhone(phone),
      email: email || null,
      town: clean(form.get("town")) || null,
      website: clean(form.get("website")) || null,
      contact_name: clean(form.get("contact_name")) || null,
      source: "Added by hand",
    })
    .select(LEAD_LIST_COLUMNS)
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, lead: lead as LeadRow };
}
