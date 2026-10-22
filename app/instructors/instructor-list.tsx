"use client";

import { useState } from "react";
import Link from "next/link";
import { docTypeLabel, type Insurance } from "@/lib/instructors";
import { InsuranceBadge, input } from "./ui";

export type InstructorRow = {
  id: string;
  name: string;
  contact: string;
  documents: number;
  types: string[];
  insurance: Insurance;
};

/**
 * The instructor list, searchable by name. Every row opens that
 * instructor's profile, where all of their documents are kept together.
 */
export function InstructorList({ rows, searchable = true }: { rows: InstructorRow[]; searchable?: boolean }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;

  return (
    <div>
      {searchable && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search instructors"
          aria-label="Search instructors"
          className={`mb-4 max-w-xs ${input}`}
        />
      )}

      {shown.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">No instructor matches “{query}”.</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {shown.map((r) => (
            <li key={r.id}>
              <Link
                href={`/instructors/${r.id}`}
                className="group -mx-2 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg px-2 py-3 transition hover:bg-[var(--chip)]"
              >
                <div className="min-w-[12rem] flex-1">
                  <div className="font-medium group-hover:underline group-hover:underline-offset-2">{r.name}</div>
                  <div className="text-xs text-[var(--text-muted)]">
                    {r.documents === 0
                      ? "No documents yet"
                      : `${r.documents} document${r.documents === 1 ? "" : "s"}: ${r.types.map(docTypeLabel).join(", ")}`}
                    {r.contact && ` · ${r.contact}`}
                  </div>
                </div>
                <InsuranceBadge insurance={r.insurance} />
                <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs font-semibold transition group-hover:border-[var(--accent-soft)] group-hover:bg-[var(--accent-soft)]">
                  Open →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
