"use client";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

/**
 * Email link sign-in. No passwords to reset, no password reset flow to build,
 * and studio owners already live in their inbox.
 */
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function sendLink() {
    if (!email.trim()) return;
    setState("sending");

    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    if (error) {
      setState("error");
      setMessage(error.message);
      return;
    }

    setState("sent");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-xl font-semibold tracking-tight">Studio reporting</h1>

      {state === "sent" ? (
        <p className="mt-3 text-sm text-neutral-600">
          Check {email} for a sign-in link. It expires in an hour.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-neutral-500">
            Enter your email and we&apos;ll send a sign-in link.
          </p>

          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendLink()}
            placeholder="you@studio.com"
            autoComplete="email"
            className="mt-5 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
          />

          <button
            onClick={sendLink}
            disabled={state === "sending"}
            className="mt-3 w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {state === "sending" ? "Sending…" : "Send link"}
          </button>

          {state === "error" && (
            <p className="mt-3 text-sm text-rose-600">
              Couldn&apos;t send the link: {message}
            </p>
          )}
        </>
      )}
    </main>
  );
}
