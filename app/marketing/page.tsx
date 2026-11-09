import { redirect } from "next/navigation";
import { getAccess } from "@/lib/access";
import { todayInDublin } from "@/lib/instructors";
import { FLAG_KINDS, isDay, isMonth, monthGrid, writtenAt, type Flag, type FlagKind, type Note } from "@/lib/marketing";
import { TopBar } from "../instructors/ui";
import { MarketingCalendar } from "./calendar";

export const dynamic = "force-dynamic";

type FlagRow = {
  id: string;
  day: string;
  kind: FlagKind;
  title: string;
  detail: string | null;
  created_by: string | null;
};

type NoteRow = {
  id: string;
  day: string;
  parent_id: string | null;
  body: string;
  author_id: string;
  author_email: string;
  created_at: string;
  marketing_note_likes: { user_id: string; user_email: string }[];
};

const FLAG_COLUMNS = "id, day, kind, title, detail, created_by";
const KIND_ORDER = FLAG_KINDS.map((k) => k.key);

const toFlags = (rows: FlagRow[] | null): Flag[] =>
  (rows ?? [])
    .map((r) => ({ id: r.id, day: r.day, kind: r.kind, title: r.title, detail: r.detail, createdBy: r.created_by }))
    .sort((a, b) => a.day.localeCompare(b.day) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));

/**
 * The marketing calendar: one month at a time, with the flagged dates and
 * everyone's notes for the weeks on screen. ?m=2027-01 picks the month and
 * ?d=2027-01-01 opens a day.
 */
export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; d?: string }>;
}) {
  const { db, user, canPlan, managesPlans } = await getAccess();
  if (!user) redirect("/login");
  if (!canPlan) redirect("/");

  const today = todayInDublin();
  const { m, d } = await searchParams;
  const month = m && isMonth(m) ? m : today.slice(0, 7);
  const grid = monthGrid(month);
  const open = d && isDay(d) && d >= grid.start && d <= grid.end ? d : null;

  const [flags, notes, upcoming] = await Promise.all([
    db.from("marketing_flags").select(FLAG_COLUMNS).gte("day", grid.start).lte("day", grid.end),
    db
      .from("marketing_notes")
      .select("id, day, parent_id, body, author_id, author_email, created_at, marketing_note_likes(user_id, user_email)")
      .gte("day", grid.start)
      .lte("day", grid.end)
      .order("created_at"),
    db.from("marketing_flags").select(FLAG_COLUMNS).gte("day", today).order("day").limit(8),
  ]);
  const failed = flags.error ?? notes.error ?? upcoming.error;
  if (failed) throw new Error(`The marketing calendar didn't load: ${failed.message}`);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-8 sm:py-12">
      <TopBar email={user.email ?? ""} back={{ href: "/", label: "balanceHQ" }} />
      <MarketingCalendar
        // A fresh calendar for each month, so the open day starts from the link.
        key={month}
        month={month}
        today={today}
        days={grid.days}
        open={open}
        flags={toFlags(flags.data as FlagRow[])}
        upcoming={toFlags(upcoming.data as FlagRow[])}
        notes={((notes.data ?? []) as NoteRow[]).map(
          (n): Note => ({
            id: n.id,
            day: n.day,
            parentId: n.parent_id,
            body: n.body,
            authorId: n.author_id,
            authorEmail: n.author_email,
            when: writtenAt(n.created_at),
            likes: n.marketing_note_likes.map((l) => ({ userId: l.user_id, email: l.user_email })),
          }),
        )}
        me={{ id: user.id, email: user.email ?? "" }}
        managesPlans={managesPlans}
      />
    </main>
  );
}
