"use client";

import Link from "next/link";
import { useEffect, useOptimistic, useRef, useState, useTransition, type FormEvent } from "react";
import {
  FLAG_KINDS,
  MAX_FLAG_DETAIL,
  MAX_FLAG_TITLE,
  MAX_NOTE,
  displayName,
  fromToday,
  kindLabel,
  longDay,
  monthTitle,
  shiftMonth,
  shortDay,
  type Flag,
  type FlagKind,
  type Like,
  type Note,
} from "@/lib/marketing";
import { addFlag, addNote, deleteFlag, deleteNote, setLike, type Result } from "./actions";
import { button, input } from "../instructors/ui";

type Me = { id: string; email: string };

/** What a click changes, shown before the save comes back. */
type Change =
  | { type: "add"; note: Note }
  | { type: "delete"; id: string }
  | { type: "like"; id: string; liked: boolean; like: Like };

type Run = (change: Change, save: () => Promise<Result>, after?: (saved: boolean) => void) => void;

function applyChange(notes: Note[], change: Change): Note[] {
  switch (change.type) {
    case "add":
      return [...notes, change.note];
    case "delete":
      // A note takes its replies with it.
      return notes.filter((n) => n.id !== change.id && n.parentId !== change.id);
    case "like":
      return notes.map((n) => {
        if (n.id !== change.id) return n;
        const others = n.likes.filter((l) => l.userId !== change.like.userId);
        return { ...n, likes: change.liked ? [...others, change.like] : others };
      });
  }
}

const KIND: Record<FlagKind, { chip: string; dot: string }> = {
  balance: { chip: "bg-[var(--accent-soft)] text-[var(--text)]", dot: "bg-[var(--accent)]" },
  moment: { chip: "bg-[var(--sand)] text-[var(--sand-text)]", dot: "bg-[var(--sand-dot)]" },
  holiday: {
    chip: "bg-[var(--chip)] text-[var(--text-muted)] ring-1 ring-inset ring-[var(--border)]",
    dot: "bg-[var(--taupe-dot)]",
  },
};

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function byDay<T extends { day: string }>(items: T[]) {
  const map = new Map<string, T[]>();
  for (const item of items) map.set(item.day, [...(map.get(item.day) ?? []), item]);
  return map;
}

export function MarketingCalendar(props: {
  month: string;
  today: string;
  /** Whole weeks, Monday to Sunday. */
  days: string[];
  /** The day to open, from the link. */
  open: string | null;
  flags: Flag[];
  upcoming: Flag[];
  notes: Note[];
  me: Me;
  managesPlans: boolean;
}) {
  const { month, today, me, managesPlans } = props;
  const [selected, setSelected] = useState(props.open);
  const [notes, show] = useOptimistic(props.notes, applyChange);
  const [, startTransition] = useTransition();
  const [error, setError] = useState("");

  const flagsByDay = byDay(props.flags);
  const notesByDay = byDay(notes);

  // The open day goes in the address, so a refresh or a shared link lands on it.
  function select(day: string | null) {
    setSelected(day);
    setError("");
    window.history.replaceState(null, "", day ? `/marketing?m=${month}&d=${day}` : `/marketing?m=${month}`);
  }

  // Show the change at once and save it. The saved page then takes over,
  // or, if the save failed, the change falls away and the error shows.
  const run: Run = (change, save, after) => {
    setError("");
    startTransition(async () => {
      show(change);
      const res = await save();
      if (res.error) setError(res.error);
      after?.(!res.error);
    });
  };

  // While a day is open: Escape closes it, and the page behind stays still.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && select(null);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [selected]);

  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const navButton =
    "grid size-10 place-items-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-lg leading-none transition hover:border-[var(--accent)]";

  return (
    <>
      <header className="mb-6">
        <h1 className="text-[1.6rem] font-semibold tracking-tight">Marketing calendar</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">
          The dates to plan around, and the team&apos;s ideas for each one. Click any day to add a note, reply or
          like.
        </p>
      </header>

      <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_1px_2px_rgba(30,26,26,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6 sm:py-5">
          <h2 className="font-serif text-2xl tracking-tight sm:text-[2rem]">{monthTitle(month)}</h2>
          <nav className="flex items-center gap-2" aria-label="Months">
            <Link href={`/marketing?m=${prev}`} prefetch aria-label={`Previous month, ${monthTitle(prev)}`} className={navButton}>
              ‹
            </Link>
            <Link
              href={`/marketing?m=${today.slice(0, 7)}`}
              className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium transition hover:border-[var(--accent)]"
            >
              Today
            </Link>
            <Link href={`/marketing?m=${next}`} prefetch aria-label={`Next month, ${monthTitle(next)}`} className={navButton}>
              ›
            </Link>
          </nav>
        </div>

        <div className="grid grid-cols-7 border-y border-[var(--border)]">
          {WEEK.map((d) => (
            <div
              key={d}
              className="px-1 py-2 text-center text-[0.68rem] font-semibold uppercase tracking-[0.15em] text-[var(--text-muted)] sm:px-3 sm:text-left"
            >
              <span className="sm:hidden">{d[0]}</span>
              <span className="hidden sm:inline">{d}</span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-px bg-[var(--border)]">
          {props.days.map((day) => (
            <DayCell
              key={day}
              day={day}
              month={month}
              today={today}
              flags={flagsByDay.get(day) ?? []}
              notes={notesByDay.get(day) ?? []}
              selected={day === selected}
              onSelect={select}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--text-muted)] sm:px-6">
          {FLAG_KINDS.map((k) => (
            <span key={k.key} className="inline-flex items-center gap-1.5">
              <span className={`size-2 rounded-full ${KIND[k.key].dot}`} />
              {k.label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <Bubble /> Notes
          </span>
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
        <h2 className="font-serif text-lg tracking-tight">Coming up</h2>
        {props.upcoming.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--text-muted)]">Nothing flagged ahead yet.</p>
        ) : (
          <ul className="mt-3 grid gap-x-8 gap-y-0.5 md:grid-cols-2">
            {props.upcoming.map((f) => {
              const row = "flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-[var(--bg)]";
              const inner = (
                <>
                  <span className={`size-2 shrink-0 rounded-full ${KIND[f.kind].dot}`} />
                  <span className="w-[5.6rem] shrink-0 text-sm tabular-nums text-[var(--text-muted)]">{shortDay(f.day)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{f.title}</span>
                  <span className="shrink-0 text-xs text-[var(--text-muted)]">{fromToday(today, f.day)}</span>
                </>
              );
              return (
                <li key={f.id}>
                  {props.days.includes(f.day) ? (
                    <button type="button" onClick={() => select(f.day)} className={row}>
                      {inner}
                    </button>
                  ) : (
                    <Link href={`/marketing?m=${f.day.slice(0, 7)}&d=${f.day}`} className={row}>
                      {inner}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {selected && (
        <DayPanel
          key={selected}
          day={selected}
          today={today}
          flags={flagsByDay.get(selected) ?? []}
          notes={notesByDay.get(selected) ?? []}
          me={me}
          managesPlans={managesPlans}
          error={error}
          run={run}
          onClose={() => select(null)}
        />
      )}
    </>
  );
}

function DayCell(props: {
  day: string;
  month: string;
  today: string;
  flags: Flag[];
  notes: Note[];
  selected: boolean;
  onSelect: (day: string) => void;
}) {
  const { day, today, flags, notes } = props;
  const inMonth = day.startsWith(props.month);
  const isToday = day === today;
  const first = notes.find((n) => !n.parentId);
  const label = [
    longDay(day),
    isToday && "today",
    ...flags.map((f) => f.title),
    notes.length && `${notes.length} note${notes.length === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <button
      type="button"
      onClick={() => props.onSelect(day)}
      aria-label={label}
      aria-current={isToday ? "date" : undefined}
      className={[
        "relative flex min-h-[4rem] min-w-0 cursor-pointer flex-col gap-1 p-1 text-left transition sm:min-h-[6.75rem] sm:p-2 lg:min-h-[8.5rem]",
        isToday
          ? "bg-[var(--today)]"
          : inMonth
            ? "bg-[var(--surface)] hover:bg-[var(--cell-hover)]"
            : "bg-[var(--bg)] hover:bg-[var(--chip)]",
        props.selected
          ? "outline-2 -outline-offset-2 outline-[var(--text)]"
          : isToday
            ? "outline-2 -outline-offset-2 outline-[var(--accent)]"
            : "",
      ].join(" ")}
    >
      <span className="flex items-center justify-between gap-1">
        <span
          className={
            isToday
              ? "grid size-7 place-items-center rounded-full bg-[var(--text)] text-sm font-semibold text-white"
              : `grid h-7 place-items-center px-1 text-sm font-medium ${
                  !inMonth ? "text-[var(--text-muted)] opacity-60" : day < today ? "text-[var(--text-muted)]" : ""
                }`
          }
        >
          {Number(day.slice(8))}
        </span>
        {isToday && (
          <span className="hidden text-[0.62rem] font-bold uppercase tracking-[0.18em] text-[var(--accent)] sm:block">
            Today
          </span>
        )}
      </span>

      {flags.length > 0 && (
        <>
          <span className="hidden min-w-0 flex-col gap-1 sm:flex">
            {flags.slice(0, 2).map((f) => (
              <span
                key={f.id}
                className={`truncate rounded-md px-1.5 py-[3px] text-[0.7rem] font-medium leading-tight ${KIND[f.kind].chip}`}
              >
                {f.title}
              </span>
            ))}
            {flags.length > 2 && (
              <span className="px-1 text-[0.68rem] text-[var(--text-muted)]">+{flags.length - 2} more</span>
            )}
          </span>
          <span className="flex flex-wrap gap-1 px-1 sm:hidden">
            {flags.map((f) => (
              <span key={f.id} className={`size-1.5 rounded-full ${KIND[f.kind].dot}`} />
            ))}
          </span>
        </>
      )}

      {first && (
        <span className="hidden truncate px-1 text-[0.7rem] text-[var(--text-muted)] lg:block">
          <span className="font-semibold">{displayName(first.authorEmail)}:</span> {first.body}
        </span>
      )}

      {notes.length > 0 && (
        <span className="mt-auto inline-flex items-center gap-1 px-1 text-[0.7rem] font-semibold text-[var(--text-muted)]">
          <Bubble /> {notes.length}
        </span>
      )}
    </button>
  );
}

function DayPanel(props: {
  day: string;
  today: string;
  flags: Flag[];
  notes: Note[];
  me: Me;
  managesPlans: boolean;
  error: string;
  run: Run;
  onClose: () => void;
}) {
  const { day, today, notes, me, managesPlans, run } = props;
  const panel = useRef<HTMLDivElement>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const roots = notes.filter((n) => !n.parentId);

  useEffect(() => panel.current?.focus(), []);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div aria-hidden className="absolute inset-0 bg-[#1e1a1a]/25" onClick={props.onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="day-title"
        className="relative flex h-full w-full max-w-[28rem] flex-col bg-[var(--bg)] shadow-2xl outline-none"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-5 py-4">
          <div>
            <p
              className={`text-[0.68rem] font-bold uppercase tracking-[0.2em] ${
                day === today ? "text-[var(--accent)]" : "text-[var(--text-muted)]"
              }`}
            >
              {day === today ? "Today" : fromToday(today, day)}
            </p>
            <h2 id="day-title" className="mt-1 font-serif text-xl tracking-tight">
              {longDay(day)}
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

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {props.flags.length > 0 && (
            <ul className="mb-3 grid gap-2">
              {props.flags.map((f) => (
                <FlagItem key={f.id} flag={f} canRemove={f.createdBy === me.id || managesPlans} />
              ))}
            </ul>
          )}
          <FlagForm day={day} />

          <h3 className="mt-7 text-[0.68rem] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)]">
            Notes{notes.length > 0 && ` · ${notes.length}`}
          </h3>
          {roots.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--text-muted)]">No notes yet. Got an idea for this day? Add it below.</p>
          ) : (
            <ul className="mt-4 space-y-5">
              {roots.map((n) => (
                <Thread
                  key={n.id}
                  note={n}
                  replies={notes.filter((r) => r.parentId === n.id)}
                  me={me}
                  managesPlans={managesPlans}
                  run={run}
                  replying={replyTo === n.id}
                  onReply={() => setReplyTo(n.id)}
                  onDoneReplying={() => setReplyTo(null)}
                />
              ))}
            </ul>
          )}
        </div>

        <footer className="border-t border-[var(--border)] bg-[var(--surface)] px-5 py-4">
          {props.error && (
            <p role="alert" className="mb-2 text-sm text-rose-600">
              {props.error}
            </p>
          )}
          <Composer day={day} parentId={null} me={me} run={run} placeholder="Add a note or an idea for this day…" />
        </footer>
      </div>
    </div>
  );
}

function Thread(props: {
  note: Note;
  replies: Note[];
  me: Me;
  managesPlans: boolean;
  run: Run;
  replying: boolean;
  onReply: () => void;
  onDoneReplying: () => void;
}) {
  const { note, replies, me, managesPlans, run } = props;
  return (
    <li>
      <NoteView note={note} me={me} managesPlans={managesPlans} run={run} onReply={props.onReply} />
      {(replies.length > 0 || props.replying) && (
        <ul className="ml-[0.95rem] mt-3 space-y-3 border-l-2 border-[var(--border)] pl-[1.6rem]">
          {replies.map((r) => (
            <li key={r.id}>
              <NoteView note={r} me={me} managesPlans={managesPlans} run={run} onReply={props.onReply} small />
            </li>
          ))}
          {props.replying && (
            <li>
              <Composer
                day={note.day}
                parentId={note.id}
                me={me}
                run={run}
                autoFocus
                placeholder={`Reply to ${displayName(note.authorEmail)}…`}
                onDone={props.onDoneReplying}
              />
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

function NoteView(props: { note: Note; me: Me; managesPlans: boolean; run: Run; onReply: () => void; small?: boolean }) {
  const { note, me, run } = props;
  const liked = note.likes.some((l) => l.userId === me.id);
  // "you" first, then everyone else in the order they liked it.
  const likers = [
    ...(liked ? ["you"] : []),
    ...note.likes.filter((l) => l.userId !== me.id).map((l) => displayName(l.email)),
  ];
  const canDelete = note.authorId === me.id || props.managesPlans;

  return (
    <div className={`flex gap-3 ${note.pending ? "opacity-60" : ""}`}>
      <Avatar email={note.authorEmail} small={props.small} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-semibold" title={note.authorEmail}>
            {displayName(note.authorEmail)}
          </span>
          <span className="text-xs text-[var(--text-muted)]">{note.pending ? "Saving…" : note.when}</span>
        </p>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed">{note.body}</p>
        {!note.pending && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-[var(--text-muted)]">
            <button
              type="button"
              aria-pressed={liked}
              aria-label={liked ? "Unlike" : "Like"}
              title={likers.length ? likedBy(likers) : "Like"}
              onClick={() =>
                run({ type: "like", id: note.id, liked: !liked, like: { userId: me.id, email: me.email } }, () =>
                  setLike(note.id, !liked),
                )
              }
              className={`inline-flex cursor-pointer items-center gap-1 transition hover:text-[var(--text)] ${
                liked ? "text-[var(--like)] hover:text-[var(--like)]" : ""
              }`}
            >
              <Heart filled={liked} />
              {note.likes.length || "Like"}
            </button>
            <button type="button" onClick={props.onReply} className="cursor-pointer transition hover:text-[var(--text)]">
              Reply
            </button>
            {canDelete && (
              <button
                type="button"
                onClick={() => {
                  if (!confirm(note.parentId ? "Delete this reply?" : "Delete this note and its replies?")) return;
                  run({ type: "delete", id: note.id }, () => deleteNote(note.id));
                }}
                className="cursor-pointer transition hover:text-rose-600"
              >
                Delete
              </button>
            )}
            {likers.length > 0 && <span className="font-normal">{likedBy(likers)}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function Composer(props: {
  day: string;
  parentId: string | null;
  me: Me;
  run: Run;
  placeholder: string;
  autoFocus?: boolean;
  /** Set on a reply box: closes it once the reply has saved, or on Cancel. */
  onDone?: () => void;
}) {
  const { day, parentId, me } = props;
  const [body, setBody] = useState("");

  function send() {
    const text = body.trim();
    if (!text) return;
    const id = crypto.randomUUID();
    props.run(
      {
        type: "add",
        note: { id, day, parentId, body: text, authorId: me.id, authorEmail: me.email, when: "", likes: [], pending: true },
      },
      () => addNote({ id, day, body: text, parentId }),
      // If it didn't save, put the words back rather than lose them.
      (saved) => (saved ? props.onDone?.() : setBody(text)),
    );
    setBody("");
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      className="grid gap-2"
    >
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            send();
          }
        }}
        rows={parentId ? 2 : 3}
        maxLength={MAX_NOTE}
        autoFocus={props.autoFocus}
        placeholder={props.placeholder}
        aria-label={parentId ? "Your reply" : "New note"}
        className={`${input} resize-none leading-relaxed`}
      />
      <div className="flex items-center justify-end gap-3">
        {props.onDone && (
          <button
            type="button"
            onClick={props.onDone}
            className="cursor-pointer text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            Cancel
          </button>
        )}
        <button disabled={!body.trim()} className={button}>
          {parentId ? "Reply" : "Post note"}
        </button>
      </div>
    </form>
  );
}

function FlagItem({ flag, canRemove }: { flag: Flag; canRemove: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  return (
    <li className={`rounded-xl px-3.5 py-2.5 ${KIND[flag.kind].chip} ${pending ? "opacity-50" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.62rem] font-bold uppercase tracking-[0.16em] opacity-70">{kindLabel(flag.kind)}</p>
          <p className="text-sm font-semibold">{flag.title}</p>
          {flag.detail && <p className="mt-0.5 text-[0.8rem] leading-snug opacity-90">{flag.detail}</p>}
        </div>
        {canRemove && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (!confirm(`Remove the “${flag.title}” flag?`)) return;
              start(async () => {
                const res = await deleteFlag(flag.id);
                setError(res.error ?? "");
              });
            }}
            className="shrink-0 cursor-pointer text-xs underline underline-offset-2 opacity-70 transition hover:opacity-100"
          >
            Remove
          </button>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-rose-700">{error}</p>}
    </li>
  );
}

function FlagForm({ day }: { day: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="cursor-pointer text-sm font-semibold text-[var(--accent)] underline-offset-2 hover:underline"
      >
        + Flag this day
      </button>
    );
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    start(async () => {
      const res = await addFlag(day, form);
      setError(res.error ?? "");
      if (!res.error) setOpen(false);
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <input
        name="title"
        required
        maxLength={MAX_FLAG_TITLE}
        autoFocus
        placeholder="What's on? e.g. New membership launch"
        aria-label="Flag name"
        className={input}
      />
      <input name="detail" maxLength={MAX_FLAG_DETAIL} placeholder="Detail (optional)" aria-label="Detail" className={input} />
      <div className="flex flex-wrap items-center gap-2">
        <select name="kind" defaultValue="balance" aria-label="Kind of date" className={`${input} w-auto min-w-0 flex-1`}>
          {FLAG_KINDS.map((k) => (
            <option key={k.key} value={k.key}>
              {k.label}
            </option>
          ))}
        </select>
        <button disabled={pending} className={button}>
          {pending ? "Saving…" : "Add flag"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError("");
          }}
          className="cursor-pointer text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
    </form>
  );
}

/** "Liked by you and Ciara", "Liked by Kelly, Ciara and you", "Liked by 5 people". */
function likedBy(names: string[]) {
  if (names.length > 3) return `Liked by ${names.length} people`;
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Liked by ${list}`;
}

const AVATAR_TINTS =["bg-[var(--accent-soft)]", "bg-[var(--sand)]", "bg-[var(--border)]", "bg-[var(--blush)]"];

function Avatar({ email, small }: { email: string; small?: boolean }) {
  const name = displayName(email);
  let hash = 7;
  for (const c of email) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-full font-semibold text-[var(--text)] ${
        AVATAR_TINTS[hash % AVATAR_TINTS.length]
      } ${small ? "size-7 text-xs" : "size-8 text-sm"}`}
    >
      {name[0]}
    </span>
  );
}

function Heart({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
      <path
        strokeLinejoin="round"
        d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.4 4.5 7 4.5c2.1 0 3.6 1.2 5 3 1.4-1.8 2.9-3 5-3 3.6 0 5.6 3.5 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"
      />
    </svg>
  );
}

function Bubble() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinejoin="round" d="M4 5.5h16v10H9.5L5 19.5v-4H4z" />
    </svg>
  );
}
