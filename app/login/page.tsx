"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

/**
 * Password sign-in, with an email link as a fallback.
 *
 * A studio is a shared workplace: staff sign in on the desk iPad, and waiting
 * on an inbox for a link every time is friction that gets solved by writing
 * the password on a Post-it. A password the team knows is the honest design.
 * Email links stay available for anyone who prefers them, and are the only
 * route back in if the password is forgotten.
 */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"password" | "link">("password");
  const [state, setState] = useState<"idle" | "working" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  function client() {
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }

  async function signIn() {
    if (!email.trim() || !password) return;
    setState("working");

    const { error } = await client().auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setState("error");
      setMessage(error.message);
      return;
    }

    // Full reload rather than a client transition, so the server component
    // reads the session cookie that was just written.
    router.push("/dashboard");
    router.refresh();
  }

  async function sendLink() {
    if (!email.trim()) return;
    setState("working");

    const { error } = await client().auth.signInWithOtp({
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

  const input =
    "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm " +
    "outline-none transition focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]";

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-xl font-semibold tracking-tight">Studio reporting</h1>

      {state === "sent" ? (
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          Check {email} for a sign-in link. It expires in an hour.
        </p>
      ) : (
        <>
          <p className="mt-1.5 text-sm text-[var(--text-muted)]">
            {mode === "password"
              ? "Sign in to see your studio's numbers."
              : "We'll email you a link — no password needed."}
          </p>

          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (mode === "password" ? signIn() : sendLink())}
            placeholder="you@studio.com"
            autoComplete="username"
            className={`mt-5 ${input}`}
          />

          {mode === "password" && (
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && signIn()}
              placeholder="Password"
              autoComplete="current-password"
              className={`mt-2.5 ${input}`}
            />
          )}

          <button
            onClick={mode === "password" ? signIn : sendLink}
            disabled={state === "working"}
            className="mt-3 w-full cursor-pointer rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white transition disabled:opacity-50"
          >
            {state === "working"
              ? mode === "password"
                ? "Signing in…"
                : "Sending…"
              : mode === "password"
                ? "Sign in"
                : "Send link"}
          </button>

          <button
            onClick={() => {
              setMode(mode === "password" ? "link" : "password");
              setState("idle");
            }}
            className="mt-3 cursor-pointer text-xs text-[var(--text-muted)] underline underline-offset-2 hover:text-[var(--text)]"
          >
            {mode === "password" ? "Email me a link instead" : "Use a password instead"}
          </button>

          {state === "error" && (
            <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{message}</p>
          )}
        </>
      )}
    </main>
  );
}
