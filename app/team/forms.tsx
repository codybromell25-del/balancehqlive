"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addLogin, removeAccess, setPassword, setRole, type FormState } from "./actions";
import { STAFF_ROLES } from "./roles";
import { button, input, label } from "../instructors/ui";

function Message({ state }: { state: FormState }) {
  if (state.error) return <span className="text-sm text-rose-600">{state.error}</span>;
  if (state.ok) return <span className="text-sm text-[var(--accent)]">{state.ok}</span>;
  return null;
}

/**
 * autoComplete="new-password" stops the browser filling in a saved
 * password — easy to miss, and exactly how a login ends up with a
 * password nobody chose.
 */
export function PasswordForm({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setPassword, {});
  return (
    <form action={action} className="grid gap-1">
      <span className={label}>New password</span>
      <div className="flex gap-2">
        <input type="hidden" name="user_id" value={userId} />
        <input
          name="password"
          type="text"
          autoComplete="new-password"
          spellCheck={false}
          minLength={8}
          required
          placeholder="At least 8 characters"
          className={input}
        />
        <button disabled={pending} className={`${button} shrink-0`}>
          {pending ? "Saving…" : "Set"}
        </button>
      </div>
      <Message state={state} />
    </form>
  );
}

export function RoleForm({ userId, role }: { userId: string; role: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setRole, {});
  return (
    <form action={action} className="grid gap-1">
      <span className={label}>Can open</span>
      <div className="flex gap-2">
        <input type="hidden" name="user_id" value={userId} />
        <select name="role" defaultValue={role} className={input}>
          {STAFF_ROLES.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
        <button disabled={pending} className={`${button} shrink-0`}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      <Message state={state} />
    </form>
  );
}

export function RemoveButton({ userId, email }: { userId: string; email: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-xs text-rose-600">{error}</span>}
      <button
        disabled={pending}
        onClick={() => {
          if (!confirm(`Remove ${email}'s access? Their login will open nothing.`)) return;
          start(async () => {
            const res = await removeAccess(userId);
            if (res.error) setError(res.error);
            else router.refresh();
          });
        }}
        className="cursor-pointer text-xs text-[var(--text-muted)] underline underline-offset-2 hover:text-rose-600 disabled:opacity-50"
      >
        {pending ? "Removing…" : "Remove access"}
      </button>
    </span>
  );
}

export function AddLoginForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(addLogin, {});
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1">
        <span className={label}>Email</span>
        <input name="email" type="email" required autoComplete="off" placeholder="name@balancestudios.ie" className={input} />
      </label>
      <label className="grid gap-1">
        <span className={label}>Password</span>
        <input
          name="password"
          type="text"
          required
          minLength={8}
          autoComplete="new-password"
          spellCheck={false}
          placeholder="At least 8 characters"
          className={input}
        />
      </label>
      <label className="grid gap-1 sm:col-span-2">
        <span className={label}>Can open</span>
        <select name="role" defaultValue="instructor_admin" className={input}>
          {STAFF_ROLES.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label} — {r.note}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button disabled={pending} className={button}>
          {pending ? "Adding…" : "Add login"}
        </button>
        <Message state={state} />
      </div>
    </form>
  );
}
