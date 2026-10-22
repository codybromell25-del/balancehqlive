"use client";

import { useActionState } from "react";
import { updateInstructor, type FormState } from "../actions";
import { button, input, label } from "../ui";

export function EditInstructorForm(props: { id: string; fullName: string; email: string; phone: string; notes: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateInstructor, {});

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-3">
      <input type="hidden" name="id" value={props.id} />
      <label className="grid gap-1">
        <span className={label}>Name</span>
        <input name="full_name" required defaultValue={props.fullName} className={input} />
      </label>
      <label className="grid gap-1">
        <span className={label}>Email</span>
        <input name="email" type="email" defaultValue={props.email} className={input} />
      </label>
      <label className="grid gap-1">
        <span className={label}>Phone</span>
        <input name="phone" defaultValue={props.phone} className={input} />
      </label>
      <label className="grid gap-1 sm:col-span-3">
        <span className={label}>Notes</span>
        <textarea name="notes" rows={2} defaultValue={props.notes} className={input} />
      </label>
      <div className="flex items-center gap-3 sm:col-span-3">
        <button disabled={pending} className={button}>
          {pending ? "Saving…" : "Save"}
        </button>
        {state.ok && !pending && <span className="text-sm text-[var(--text-muted)]">Saved.</span>}
        {state.error && <span className="text-sm text-rose-600 dark:text-rose-400">{state.error}</span>}
      </div>
    </form>
  );
}
