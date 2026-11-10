"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { displayName } from "@/lib/marketing";
import {
  AREAS,
  CATEGORIES,
  STATUSES,
  categoryLabel,
  statusLabel,
  telHref,
  websiteHref,
  type Activity,
  type LeadDetail,
  type LeadRow,
  type Status,
} from "@/lib/sales";
import { addLead, getLead, logActivity, setStatus } from "./actions";
import { button, input, label } from "../instructors/ui";

type StatusFilter = "open" | "all" | "due" | Status;
type Sort = "suggested" | "distance" | "name";

const OPEN: Status[] = ["new", "contacted", "follow_up", "interested"];
const PAGE = 100;

const STATUS_STYLE: Record<Status, string> = {
  new: "bg-[var(--chip)] text-[var(--text-muted)] ring-1 ring-inset ring-[var(--border)]",
  contacted: "bg-[var(--sand)] text-[var(--sand-text)]",
  follow_up: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200",
  interested: "bg-[#e1eee5] text-[#365e47]",
  won: "bg-[var(--accent-soft)] text-[var(--text)]",
  not_interested: "bg-[var(--blush)] text-[#8a4a40]",
  do_not_contact: "bg-[#e9e4e1] text-[#5b514b]",
};

const TILES: { key: StatusFilter; label: string }[] = [
  { key: "new", label: "To contact" },
  { key: "due", label: "Follow-ups due" },
  { key: "contacted", label: "Contacted" },
  { key: "interested", label: "Interested" },
  { key: "won", label: "Signed up" },
];

const isDue = (l: LeadRow, today: string) =>
  Boolean(l.follow_up_on && l.follow_up_on <= today && OPEN.includes(l.status));

/** Due follow-ups first, then hot leads, then the untouched ones. */
function rank(l: LeadRow, today: string) {
  if (isDue(l, today)) return 0;
  return { interested: 1, new: 2, contacted: 3, follow_up: 4, won: 5, not_interested: 6, do_not_contact: 7 }[l.status];
}

const dublinDay = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Europe/Dublin" });
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const shortDate = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IE", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });

function nextStep(l: LeadRow, today: string) {
  if (l.follow_up_on && OPEN.includes(l.status)) {
    const n = daysBetween(today, l.follow_up_on);
    if (n < 0) return { text: `Follow-up overdue ${-n}d`, warn: true };
    if (n === 0) return { text: "Follow up today", warn: true };
    return { text: `Follow up ${shortDate(l.follow_up_on)}`, warn: false };
  }
  if (l.last_contact_at) {
    const n = daysBetween(dublinDay(l.last_contact_at), today);
    return { text: n === 0 ? "Contacted today" : n === 1 ? "Contacted yesterday" : `Contacted ${n} days ago`, warn: false };
  }
  return { text: "Not contacted yet", warn: false };
}

function firstName(name: string | null) {
  if (!name) return null;
  const words = name
    .replace(/\(.*?\)/g, "")
    .trim()
    .split(/\s+/)
    .filter((w) => !/^(mr|mrs|ms|miss|dr|fr|sr|br)\.?$/i.test(w));
  const w = words[0];
  return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : null;
}

/** An intro email ready to edit in the salesperson's own mail app. */
function mailto(l: LeadRow, me: string) {
  if (!l.email) return undefined;
  const hello = firstName(l.contact_name);
  const sender = displayName(me);
  const body = [
    `Hi${hello ? ` ${hello}` : ""},`,
    "",
    `I'm ${sender} from balance, the Pilates studio in ${l.area}. We'd love to offer your team discounted classes at our ${l.area} studio, an easy wellbeing perk for your staff.`,
    "",
    "Could I send on the details, or would a quick call this week suit?",
    "",
    "Kind regards,",
    sender,
    "balance",
  ].join("\n");
  return `mailto:${l.email}?subject=${encodeURIComponent("Discounted Pilates classes for your team")}&body=${encodeURIComponent(body)}`;
}

export function SalesBoard(props: { leads: LeadRow[]; today: string; me: string }) {
  const { today, me } = props;
  const [leads, setLeads] = useState(props.leads);
  const [query, setQuery] = useState("");
  const [area, setArea] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  const [status, setStatusFilter] = useState<StatusFilter>("open");
  const [sort, setSort] = useState<Sort>("suggested");
  const [limit, setLimit] = useState(PAGE);
  const [openId, setOpenId] = useState<string | null>(null);
  // The list's order when a lead was opened. Logging a call re-sorts the
  // list, and Next must still go to the lead that was below this one.
  const [queue, setQueue] = useState<string[] | null>(null);
  const [adding, setAdding] = useState(false);

  function open(id: string | null) {
    setOpenId(id);
    if (!id) setQueue(null);
    else if (!queue) setQueue(shown.map((l) => l.id));
    window.history.replaceState(null, "", id ? `/sales?lead=${id}` : "/sales");
  }

  // Area and type set the scope; the tiles count within it.
  const scoped = useMemo(
    () => leads.filter((l) => (area === "all" || l.area === area) && (category === "all" || l.category === category)),
    [leads, area, category],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = scoped.filter((l) => {
      if (status === "open" && !OPEN.includes(l.status)) return false;
      if (status === "due" && !isDue(l, today)) return false;
      if (status !== "open" && status !== "all" && status !== "due" && l.status !== status) return false;
      if (!q) return true;
      return `${l.name} ${l.town ?? ""} ${l.contact_name ?? ""} ${l.email ?? ""}`.toLowerCase().includes(q);
    });
    const byName = (a: LeadRow, b: LeadRow) => a.name.localeCompare(b.name);
    const byDistance = (a: LeadRow, b: LeadRow) => (a.distance_km ?? 999) - (b.distance_km ?? 999);
    return rows.sort((a, b) =>
      sort === "name"
        ? byName(a, b)
        : sort === "distance"
          ? byDistance(a, b) || byName(a, b)
          : rank(a, today) - rank(b, today) || byDistance(a, b) || byName(a, b),
    );
  }, [scoped, query, status, sort, today]);

  useEffect(() => setLimit(PAGE), [query, area, category, status, sort]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { due: 0 };
    for (const l of scoped) {
      c[l.status] = (c[l.status] ?? 0) + 1;
      if (isDue(l, today)) c.due++;
    }
    return c;
  }, [scoped, today]);

  const byArea = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of leads) if (category === "all" || l.category === category) c[l.area] = (c[l.area] ?? 0) + 1;
    return c;
  }, [leads, category]);

  const byCategory = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of leads) if (area === "all" || l.area === area) c[l.category] = (c[l.category] ?? 0) + 1;
    return c;
  }, [leads, area]);

  const order = queue ?? shown.map((l) => l.id);
  const index = openId ? order.indexOf(openId) : -1;
  const openRow = openId ? (leads.find((l) => l.id === openId) ?? null) : null;

  // Pick up ?lead= so a link, or a refresh, reopens the lead.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("lead");
    if (id && props.leads.some((l) => l.id === id)) open(id);
    // Only on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function replace(row: LeadRow) {
    setLeads((all) => all.map((l) => (l.id === row.id ? row : l)));
  }

  // The shared field style, minus its full width, so the filters sit in a row.
  const select = `${input.replace("w-full ", "")} w-auto min-w-0 cursor-pointer`;

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[1.6rem] font-semibold tracking-tight">Sales dashboard</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">
            Hotels, companies, schools and colleges near each studio. Work down the list: call or email, log what
            happened, and set a follow-up.
          </p>
        </div>
        <button type="button" onClick={() => setAdding(true)} className={button}>
          + Add a lead
        </button>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {TILES.map((t) => {
          const active = status === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setStatusFilter(active ? "open" : t.key)}
              aria-pressed={active}
              className={`cursor-pointer rounded-2xl border p-4 text-left transition ${
                active
                  ? "border-[var(--accent)] bg-[var(--today)]"
                  : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)]"
              }`}
            >
              <span className="block text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                {t.label}
              </span>
              <span className={`mt-1 block font-serif text-3xl tabular-nums ${t.key === "due" && counts.due ? "text-amber-700" : ""}`}>
                {(counts[t.key] ?? 0).toLocaleString("en-IE")}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search organisations, towns or contacts"
          aria-label="Search leads"
          className={`${input} w-full sm:w-80`}
        />
        <select value={area} onChange={(e) => setArea(e.target.value)} aria-label="Studio" className={select}>
          <option value="all">All studios ({leads.filter((l) => category === "all" || l.category === category).length})</option>
          {AREAS.map((a) => (
            <option key={a} value={a}>
              {a} ({byArea[a] ?? 0})
            </option>
          ))}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Type" className={select}>
          <option value="all">All types</option>
          {CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label} ({byCategory[c.key] ?? 0})
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} aria-label="Status" className={select}>
          <option value="open">Open leads</option>
          <option value="due">Follow-ups due</option>
          {STATUSES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
          <option value="all">Everything</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort" className={select}>
          <option value="suggested">Suggested order</option>
          <option value="distance">Nearest first</option>
          <option value="name">A to Z</option>
        </select>
        <span className="ml-auto text-xs text-[var(--text-muted)]">
          {shown.length.toLocaleString("en-IE")} lead{shown.length === 1 ? "" : "s"}
        </span>
      </div>

      <section className="mt-4 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
        {shown.length === 0 ? (
          <p className="p-6 text-sm text-[var(--text-muted)]">No leads match. Try another studio, type or status.</p>
        ) : (
          <>
            <table className="hidden w-full table-fixed text-sm md:table">
              <thead className="bg-[var(--bg)] text-left text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                <tr>
                  <th className="w-[28%] px-4 py-3">Organisation</th>
                  <th className="w-[12%] px-3 py-3">Type</th>
                  <th className="w-[10%] px-3 py-3">Studio</th>
                  <th className="w-[12%] px-3 py-3">Phone</th>
                  <th className="w-[18%] px-3 py-3">Email</th>
                  <th className="w-[10%] px-3 py-3">Status</th>
                  <th className="w-[10%] px-3 py-3">Next step</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {shown.slice(0, limit).map((l) => {
                  const step = nextStep(l, today);
                  return (
                    <tr
                      key={l.id}
                      onClick={() => open(l.id)}
                      className={`cursor-pointer align-top transition hover:bg-[var(--cell-hover)] ${l.id === openId ? "bg-[var(--today)]" : ""}`}
                    >
                      <td className="px-4 py-3">
                        <button type="button" onClick={() => open(l.id)} className="block max-w-full cursor-pointer truncate text-left font-medium hover:underline">
                          {l.name}
                        </button>
                        <span className="block truncate text-xs text-[var(--text-muted)]">
                          {[l.town, l.distance_km != null ? `${l.distance_km} km` : null, l.contact_name].filter(Boolean).join(" · ")}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-[var(--text-muted)]">{categoryLabel(l.category)}</td>
                      <td className="px-3 py-3">{l.area}</td>
                      <td className="px-3 py-3 tabular-nums">
                        {l.phone ? (
                          <a href={telHref(l.phone) ?? undefined} onClick={(e) => e.stopPropagation()} className="hover:underline">
                            {l.phone}
                          </a>
                        ) : (
                          <span className="text-[var(--text-muted)]">—</span>
                        )}
                      </td>
                      <td className="truncate px-3 py-3">
                        {l.email ? (
                          <a href={mailto(l, me)} onClick={(e) => e.stopPropagation()} className="hover:underline">
                            {l.email}
                          </a>
                        ) : (
                          <span className="text-[var(--text-muted)]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <StatusPill status={l.status} />
                      </td>
                      <td className={`px-3 py-3 text-xs ${step.warn ? "font-semibold text-amber-700" : "text-[var(--text-muted)]"}`}>
                        {step.text}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <ul className="divide-y divide-[var(--border)] md:hidden">
              {shown.slice(0, limit).map((l) => {
                const step = nextStep(l, today);
                return (
                  <li key={l.id}>
                    <button type="button" onClick={() => open(l.id)} className="block w-full cursor-pointer px-4 py-3 text-left">
                      <span className="flex items-start justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{l.name}</span>
                          <span className="block truncate text-xs text-[var(--text-muted)]">
                            {categoryLabel(l.category)} · {l.area}
                            {l.town ? ` · ${l.town}` : ""}
                          </span>
                        </span>
                        <StatusPill status={l.status} />
                      </span>
                      <span className={`mt-1 block text-xs ${step.warn ? "font-semibold text-amber-700" : "text-[var(--text-muted)]"}`}>
                        {step.text}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {shown.length > limit && (
              <div className="border-t border-[var(--border)] p-3 text-center">
                <button
                  type="button"
                  onClick={() => setLimit((n) => n + PAGE)}
                  className="cursor-pointer rounded-full border border-[var(--border)] px-4 py-2 text-sm font-medium transition hover:border-[var(--accent)]"
                >
                  Show {Math.min(PAGE, shown.length - limit)} more of {(shown.length - limit).toLocaleString("en-IE")}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {openRow && (
        <LeadPanel
          key={openRow.id}
          row={openRow}
          me={me}
          today={today}
          position={index >= 0 ? `${index + 1} of ${order.length}` : null}
          onPrev={index > 0 ? () => open(order[index - 1]) : null}
          onNext={index >= 0 && index < order.length - 1 ? () => open(order[index + 1]) : null}
          onClose={() => open(null)}
          onChange={replace}
        />
      )}

      {adding && (
        <AddLead
          me={me}
          onClose={() => setAdding(false)}
          onAdded={(row) => {
            setLeads((all) => [row, ...all]);
            setAdding(false);
            open(row.id);
          }}
        />
      )}
    </>
  );
}

function StatusPill({ status }: { status: Status }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>
      {statusLabel(status)}
    </span>
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IE", {
    timeZone: "Europe/Dublin",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const KIND_LABEL: Record<Activity["kind"], string> = {
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  note: "Note",
  status: "Update",
};

function LeadPanel(props: {
  row: LeadRow;
  me: string;
  today: string;
  position: string | null;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onClose: () => void;
  onChange: (row: LeadRow) => void;
}) {
  const { row, me, today } = props;
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [nextStatus, setNextStatus] = useState<Status>(row.status);
  const [followUp, setFollowUp] = useState(row.follow_up_on ?? "");
  const [pending, start] = useTransition();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    getLead(row.id).then((res) => {
      if (!live) return;
      if (!res.ok) setError(res.error);
      else {
        setDetail(res.lead);
        setActivities(res.activities);
      }
    });
    panel.current?.focus();
    return () => {
      live = false;
    };
  }, [row.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  });

  function log(kind: "call" | "email" | "meeting" | "note", text: string) {
    setError("");
    start(async () => {
      const res = await logActivity({ leadId: row.id, kind, body: [text, note.trim()].filter(Boolean).join(" — ") });
      if (!res.ok) return setError(res.error);
      props.onChange(res.lead);
      setActivities((a) => [res.activity, ...(a ?? [])]);
      setNextStatus(res.lead.status);
      setNote("");
    });
  }

  function addNote() {
    if (!note.trim()) return setError("Write the note first.");
    setError("");
    start(async () => {
      const res = await logActivity({ leadId: row.id, kind: "note", body: note });
      if (!res.ok) return setError(res.error);
      setActivities((a) => [res.activity, ...(a ?? [])]);
      setNote("");
    });
  }

  function saveStatus(status: Status, date: string) {
    setError("");
    start(async () => {
      const res = await setStatus({ leadId: row.id, status, followUpOn: date || null });
      if (!res.ok) return setError(res.error);
      props.onChange(res.lead);
      if (res.activity) setActivities((a) => [res.activity!, ...(a ?? [])]);
    });
  }

  const plusDays = (n: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  const lead = detail ?? row;
  const site = detail ? websiteHref(detail.website) : null;
  const source = detail?.source;
  const quick = "cursor-pointer rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold transition hover:border-[var(--accent)] disabled:opacity-50";

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div aria-hidden className="absolute inset-0 bg-[#1e1a1a]/25" onClick={props.onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lead-title"
        className="relative flex h-full w-full max-w-[34rem] flex-col bg-[var(--bg)] shadow-2xl outline-none"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-5 py-4">
          <div className="min-w-0">
            <p className="text-[0.68rem] font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
              {categoryLabel(lead.category)} · {lead.area}
              {lead.distance_km != null && ` · ${lead.distance_km} km`}
            </p>
            <h2 id="lead-title" className="mt-1 font-serif text-xl leading-snug tracking-tight">
              {lead.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Close"
            className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full text-2xl leading-none text-[var(--text-muted)] transition hover:bg-[var(--chip)] hover:text-[var(--text)]"
          >
            ×
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className={label}>Phone</p>
                  <p className="text-base font-semibold tabular-nums">{lead.phone ?? "—"}</p>
                </div>
                {lead.phone && (
                  <a href={telHref(lead.phone) ?? undefined} className={button}>
                    Call
                  </a>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className={label}>Email</p>
                  <p className="truncate text-sm font-medium">{lead.email ?? "—"}</p>
                </div>
                {lead.email && (
                  <a href={mailto(lead, me)} className={button}>
                    Email
                  </a>
                )}
              </div>
              {lead.contact_name && (
                <div>
                  <p className={label}>Contact</p>
                  <p className="text-sm">
                    {lead.contact_name}
                    {detail?.contact_role && <span className="text-[var(--text-muted)]"> · {detail.contact_role}</span>}
                  </p>
                </div>
              )}
              {detail && (
                <dl className="grid gap-1 border-t border-[var(--border)] pt-3 text-sm">
                  {(detail.address || detail.town) && (
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 text-[var(--text-muted)]">Address</dt>
                      <dd>{[detail.address || detail.town, detail.eircode].filter(Boolean).join(", ")}</dd>
                    </div>
                  )}
                  {site && (
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 text-[var(--text-muted)]">Website</dt>
                      <dd className="min-w-0 truncate">
                        <a href={site} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] underline underline-offset-2">
                          {site.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                        </a>
                      </dd>
                    </div>
                  )}
                  {(detail.size || detail.sector) && (
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 text-[var(--text-muted)]">About</dt>
                      <dd>{[detail.sector, detail.size].filter(Boolean).join(" · ")}</dd>
                    </div>
                  )}
                  {detail.notes && (
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 text-[var(--text-muted)]">Notes</dt>
                      <dd className="min-w-0 break-words">{detail.notes}</dd>
                    </div>
                  )}
                  {source && (
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 text-[var(--text-muted)]">Source</dt>
                      <dd className="min-w-0 truncate text-xs text-[var(--text-muted)]">
                        {/^https?:\/\//.test(source) ? (
                          <a href={source} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                            {source.replace(/^https?:\/\/(www\.)?/, "")}
                          </a>
                        ) : (
                          source
                        )}
                      </dd>
                    </div>
                  )}
                </dl>
              )}
            </div>
          </section>

          <section>
            <h3 className={label}>Log what happened</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" disabled={pending} onClick={() => log("call", "No answer")} className={quick}>
                No answer
              </button>
              <button type="button" disabled={pending} onClick={() => log("call", "Left a voicemail")} className={quick}>
                Left voicemail
              </button>
              <button type="button" disabled={pending} onClick={() => log("call", "Spoke to them")} className={quick}>
                Spoke to them
              </button>
              <button type="button" disabled={pending} onClick={() => log("email", "Sent an email")} className={quick}>
                Sent email
              </button>
              <button type="button" disabled={pending} onClick={() => log("meeting", "Had a meeting")} className={quick}>
                Meeting
              </button>
            </div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={4000}
              placeholder="Add detail: who you spoke to, what they said… (saved with the button you press)"
              aria-label="Note"
              className={`${input} mt-2 resize-none`}
            />
            <div className="mt-2 flex justify-end">
              <button type="button" disabled={pending || !note.trim()} onClick={addNote} className={quick}>
                Save as a note
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <h3 className={label}>Status and follow-up</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <select
                value={nextStatus}
                onChange={(e) => setNextStatus(e.target.value as Status)}
                aria-label="Status"
                className={`${input} cursor-pointer`}
              >
                {STATUSES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={followUp}
                min={today}
                onChange={(e) => setFollowUp(e.target.value)}
                aria-label="Follow up on"
                className={input}
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-[var(--text-muted)]">Follow up:</span>
              {[
                ["Tomorrow", 1],
                ["In 3 days", 3],
                ["Next week", 7],
                ["In 2 weeks", 14],
              ].map(([text, n]) => (
                <button key={text} type="button" onClick={() => setFollowUp(plusDays(n as number))} className={quick}>
                  {text}
                </button>
              ))}
              {followUp && (
                <button type="button" onClick={() => setFollowUp("")} className="cursor-pointer text-xs text-[var(--text-muted)] underline">
                  Clear
                </button>
              )}
            </div>
            <div className="mt-3 flex items-center justify-end gap-3">
              {(nextStatus !== row.status || (followUp || null) !== row.follow_up_on) && (
                <span className="text-xs text-[var(--text-muted)]">Not saved yet</span>
              )}
              <button
                type="button"
                disabled={pending || (nextStatus === row.status && (followUp || null) === row.follow_up_on)}
                onClick={() => saveStatus(nextStatus, followUp)}
                className={button}
              >
                Save
              </button>
            </div>
          </section>

          {error && (
            <p role="alert" className="text-sm text-rose-600">
              {error}
            </p>
          )}

          <section>
            <h3 className={label}>History</h3>
            {activities === null ? (
              <p className="mt-2 text-sm text-[var(--text-muted)]">Loading…</p>
            ) : activities.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--text-muted)]">Nothing logged yet.</p>
            ) : (
              <ol className="mt-2 space-y-3">
                {activities.map((a) => (
                  <li key={a.id} className="flex gap-3 text-sm">
                    <span className="mt-0.5 w-16 shrink-0 text-[0.66rem] font-bold uppercase tracking-[0.12em] text-[var(--accent)]">
                      {KIND_LABEL[a.kind]}
                    </span>
                    <span className="min-w-0 flex-1">
                      {a.body && <span className="block whitespace-pre-wrap break-words">{a.body}</span>}
                      <span className="block text-xs text-[var(--text-muted)]">
                        {displayName(a.author_email)} · {when(a.created_at)}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--surface)] px-5 py-3">
          <button
            type="button"
            disabled={!props.onPrev}
            onClick={() => props.onPrev?.()}
            className="cursor-pointer text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text)] disabled:cursor-default disabled:opacity-40"
          >
            ← Previous
          </button>
          {props.position && <span className="text-xs text-[var(--text-muted)]">{props.position}</span>}
          <button type="button" disabled={!props.onNext} onClick={() => props.onNext?.()} className={button}>
            Next lead →
          </button>
        </footer>
      </div>
    </div>
  );
}

function AddLead(props: { me: string; onClose: () => void; onAdded: (row: LeadRow) => void }) {
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError("");
    start(async () => {
      const res = await addLead(form);
      if (!res.ok) setError(res.error);
      else props.onAdded(res.lead);
    });
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div aria-hidden className="absolute inset-0 bg-[#1e1a1a]/25" onClick={props.onClose} />
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-lead-title"
        className="relative grid w-full max-w-lg gap-3 rounded-2xl bg-[var(--surface)] p-6 shadow-2xl"
      >
        <h2 id="add-lead-title" className="font-serif text-xl tracking-tight">
          Add a lead
        </h2>
        <input name="name" required autoFocus placeholder="Organisation" aria-label="Organisation" className={input} />
        <div className="grid gap-3 sm:grid-cols-2">
          <select name="category" defaultValue="company" aria-label="Type" className={`${input} cursor-pointer`}>
            {CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.one}
              </option>
            ))}
          </select>
          <select name="area" defaultValue="" required aria-label="Nearest studio" className={`${input} cursor-pointer`}>
            <option value="" disabled>
              Nearest studio
            </option>
            {AREAS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <input name="phone" placeholder="Phone" aria-label="Phone" className={input} />
          <input name="email" type="email" placeholder="Email" aria-label="Email" className={input} />
          <input name="town" placeholder="Town (optional)" aria-label="Town" className={input} />
          <input name="contact_name" placeholder="Contact name (optional)" aria-label="Contact name" className={input} />
        </div>
        <input name="website" placeholder="Website (optional)" aria-label="Website" className={input} />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={props.onClose} className="cursor-pointer text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
            Cancel
          </button>
          <button disabled={pending} className={button}>
            {pending ? "Adding…" : "Add lead"}
          </button>
        </div>
      </form>
    </div>
  );
}
