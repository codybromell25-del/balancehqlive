"use client";

import { useRef, useState } from "react";

interface Turn {
  question: string;
  answer?: string;
  error?: string;
}

const SUGGESTIONS = [
  "Which location had the best month?",
  "Where are we losing new members?",
  "What are my worst class times?",
  "How is intro-offer conversion trending?",
];

/**
 * Ask questions about the studio's numbers.
 *
 * History is kept client-side and passed back with each question so follow-ups
 * work ("what about Bray?"), trimmed server-side so a long session cannot grow
 * the bill without limit.
 */
export function Ask() {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const history = useRef<unknown[]>([]);

  async function ask(q: string) {
    const text = q.trim();
    if (!text || busy) return;

    setQuestion("");
    setBusy(true);
    setTurns((t) => [...t, { question: text }]);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, history: history.current }),
      });
      const data = await res.json();

      if (!res.ok) {
        setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, error: data.error } : x)));
      } else {
        history.current = data.history ?? [];
        setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, answer: data.answer } : x)));
      }
    } catch {
      setTurns((t) =>
        t.map((x, i) => (i === t.length - 1 ? { ...x, error: "Could not reach the server." } : x)),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-sm font-semibold">Ask about your numbers</h2>
      <p className="mt-0.5 text-xs text-[var(--text-muted)]">
        Questions are answered from this studio&apos;s own data.
      </p>

      {turns.length > 0 && (
        <div className="mt-4 space-y-4">
          {turns.map((t, i) => (
            <div key={i}>
              <div className="text-sm font-medium">{t.question}</div>
              {t.answer && (
                <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-muted)]">
                  {t.answer}
                </p>
              )}
              {t.error && (
                <p className="mt-1.5 text-sm text-rose-600 dark:text-rose-400">{t.error}</p>
              )}
              {!t.answer && !t.error && (
                <p className="mt-1.5 text-sm text-[var(--text-muted)]">Looking…</p>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask(question)}
          placeholder="How did Clane do last month?"
          disabled={busy}
          maxLength={1000}
          className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none transition focus:border-[var(--accent)] disabled:opacity-60"
        />
        <button
          onClick={() => ask(question)}
          disabled={busy || !question.trim()}
          className="cursor-pointer rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition disabled:opacity-40"
        >
          {busy ? "…" : "Ask"}
        </button>
      </div>

      {turns.length === 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => ask(s)}
              className="cursor-pointer rounded-full border border-[var(--border)] bg-[var(--chip)] px-3 py-1 text-xs text-[var(--text-muted)] transition hover:text-[var(--text)]"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
