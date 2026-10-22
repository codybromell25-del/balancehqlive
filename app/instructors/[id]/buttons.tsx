"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteDocument, setInstructorActive } from "../actions";

export function DeleteDocumentButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-xs text-rose-600 dark:text-rose-400">{error}</span>}
      <button
        disabled={pending}
        onClick={() => {
          if (!confirm(`Delete “${name}”? This can't be undone.`)) return;
          start(async () => {
            const res = await deleteDocument(id);
            if (res.error) setError(res.error);
            else router.refresh();
          });
        }}
        className="cursor-pointer text-xs text-[var(--text-muted)] underline underline-offset-2 hover:text-rose-600 disabled:opacity-50"
      >
        {pending ? "Deleting…" : "Delete"}
      </button>
    </span>
  );
}

export function ArchiveButton({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await setInstructorActive(id, !active);
            if (res.error) setError(res.error);
            else router.refresh();
          })
        }
        className="cursor-pointer rounded-lg border border-[var(--border)] px-3 py-1.5 transition hover:bg-[var(--chip)] disabled:opacity-50"
      >
        {active ? "Archive instructor" : "Restore instructor"}
      </button>
      <span className="text-xs text-[var(--text-muted)]">
        {active
          ? "For someone who no longer teaches. Their documents are kept, and they drop out of the warnings."
          : "Brings them back into the list and the insurance warnings."}
      </span>
      {error && <span className="text-xs text-rose-600 dark:text-rose-400">{error}</span>}
    </div>
  );
}
