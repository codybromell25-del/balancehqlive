"use client";

import { useActionState } from "react";
import { addInstructor, type FormState } from "./actions";
import { button, input } from "./ui";

export function AddInstructorForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(addInstructor, {});

  return (
    <form action={action} className="grid gap-2.5 sm:grid-cols-[2fr_2fr_1.5fr_auto]">
      <input name="full_name" required placeholder="Full name" className={input} />
      <input name="email" type="email" placeholder="Email (optional)" className={input} />
      <input name="phone" placeholder="Phone (optional)" className={input} />
      <button disabled={pending} className={button}>
        {pending ? "Adding…" : "Add"}
      </button>
      {state.error && <p className="text-sm text-rose-600 sm:col-span-4 dark:text-rose-400">{state.error}</p>}
    </form>
  );
}
