/**
 * Shared pieces for the marketing calendar: its kinds of flag, the days a
 * month shows, and how dates and people are written.
 *
 * Dates are plain YYYY-MM-DD strings, and every label is built from the
 * tables below rather than toLocaleDateString, so the server and the
 * browser write a date identically and the page hydrates without a
 * mismatch.
 */

export type FlagKind = "balance" | "moment" | "holiday";

export const FLAG_KINDS: { key: FlagKind; label: string }[] = [
  { key: "balance", label: "balance dates" },
  { key: "moment", label: "Marketing moments" },
  { key: "holiday", label: "Bank holidays & school breaks" },
];

export const isFlagKind = (v: string): v is FlagKind => FLAG_KINDS.some((k) => k.key === v);

export const kindLabel = (kind: FlagKind) => FLAG_KINDS.find((k) => k.key === kind)!.label;

export type Flag = {
  id: string;
  day: string;
  kind: FlagKind;
  title: string;
  detail: string | null;
  createdBy: string | null;
};

export type Like = { userId: string; email: string };

export type Note = {
  id: string;
  day: string;
  /** Set on a reply: the top-level note it sits under. */
  parentId: string | null;
  body: string;
  authorId: string;
  authorEmail: string;
  /** Already written out, e.g. "9 Nov, 14:05". */
  when: string;
  likes: Like[];
  /** Shown straight away while it saves. */
  pending?: boolean;
};

export const MAX_NOTE = 2000;
export const MAX_FLAG_TITLE = 80;
export const MAX_FLAG_DETAIL = 200;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** A real calendar day written YYYY-MM-DD: 2027-02-30 is refused. */
export function isDay(v: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export const isMonth = (v: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

export function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function shiftMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

export function daysFrom(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Monday is 0 and Sunday 6: Irish calendars start the week on a Monday. */
const weekday = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;

/** Every day a month shows: whole weeks, from the Monday to the Sunday. */
export function monthGrid(month: string) {
  const first = `${month}-01`;
  const last = addDays(`${shiftMonth(month, 1)}-01`, -1);
  const start = addDays(first, -weekday(first));
  const end = addDays(last, 6 - weekday(last));
  const days: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  return { start, end, days };
}

const parts = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return { y, month: MONTHS[m - 1], d, wd: WEEKDAYS[weekday(day)] };
};

/** "November 2026" */
export function monthTitle(month: string) {
  const { y, month: name } = parts(`${month}-01`);
  return `${name} ${y}`;
}

/** "Friday 27 November 2026" */
export function longDay(day: string) {
  const p = parts(day);
  return `${p.wd} ${p.d} ${p.month} ${p.y}`;
}

/** "Fri 27 Nov" */
export function shortDay(day: string) {
  const p = parts(day);
  return `${p.wd.slice(0, 3)} ${p.d} ${p.month.slice(0, 3)}`;
}

/** "in 18 days", "tomorrow", "in 5 weeks" */
export function fromToday(today: string, day: string) {
  const n = daysFrom(today, day);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n < 0) return n === -1 ? "yesterday" : `${-n} days ago`;
  if (n < 28) return `in ${n} days`;
  if (n < 70) return `in ${Math.round(n / 7)} weeks`;
  return `in ${Math.round(n / 30.44)} months`;
}

/**
 * "kelly.smith@balancestudios.ie" → "Kelly". Logins carry no name, so the
 * first word of the email stands in for one.
 */
export function displayName(email: string) {
  const first = email.split("@")[0]?.split(/[._+\-\d]+/).find(Boolean) ?? "";
  return first ? first[0].toUpperCase() + first.slice(1).toLowerCase() : "Someone";
}

/** When a note was written, in Dublin time: "9 Nov, 14:05". Server side only. */
export function writtenAt(iso: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-IE", {
      timeZone: "Europe/Dublin",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return `${p.day} ${p.month}, ${p.hour}:${p.minute}`;
}
