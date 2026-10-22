"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { BUCKET, DOC_TYPES, MAX_FILE_BYTES } from "@/lib/instructors";
import { recordDocument } from "../actions";
import { button, input, label } from "../ui";

/**
 * Uploads straight from the browser to the private bucket, then records the
 * document. Storage policies check the signed-in user's role against the
 * studio folder, so this cannot write anywhere a server action couldn't.
 */
export function UploadForm({ studioId, instructorId }: { studioId: string; instructorId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [docType, setDocType] = useState("insurance");
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const file = form.get("file");
    const validUntil = String(form.get("valid_until") ?? "");

    if (!(file instanceof File) || file.size === 0) return fail("Choose a file to upload.");
    if (file.size > MAX_FILE_BYTES) return fail("That file is over 15 MB. A PDF or a smaller photo will do.");
    if (docType === "insurance" && !validUntil) return fail("Add the date the insurance is valid until.");

    setState("working");
    const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(-120) || "document";
    const path = `${studioId}/${instructorId}/${crypto.randomUUID()}-${safeName}`;

    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (uploadError) return fail(`Upload failed: ${uploadError.message}`);

    const res = await recordDocument({
      instructorId,
      docType,
      title: String(form.get("title") ?? ""),
      validUntil,
      filePath: path,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
    });

    if (res.error) {
      // Don't leave an orphaned file behind when the record was refused.
      await supabase.storage.from(BUCKET).remove([path]);
      return fail(res.error);
    }

    formRef.current?.reset();
    setDocType("insurance");
    setState("done");
    setMessage("Uploaded.");
    router.refresh();
  }

  function fail(text: string) {
    setState("error");
    setMessage(text);
  }

  return (
    <form ref={formRef} onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1">
        <span className={label}>Type</span>
        <select name="doc_type" value={docType} onChange={(e) => setDocType(e.target.value)} className={input}>
          {DOC_TYPES.map((d) => (
            <option key={d.key} value={d.key}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1">
        <span className={label}>
          Valid until{docType === "insurance" ? "" : " (optional)"}
        </span>
        <input name="valid_until" type="date" required={docType === "insurance"} className={input} />
      </label>
      <label className="grid gap-1 sm:col-span-2">
        <span className={label}>Name (optional)</span>
        <input name="title" placeholder="e.g. Public liability insurance 2026" className={input} />
      </label>
      <label className="grid gap-1 sm:col-span-2">
        <span className={label}>File</span>
        <input
          name="file"
          type="file"
          required
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.doc,.docx,application/pdf,image/*"
          className="text-sm file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-[var(--border)] file:bg-[var(--chip)] file:px-3 file:py-1.5 file:text-sm"
        />
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button disabled={state === "working"} className={button}>
          {state === "working" ? "Uploading…" : "Upload"}
        </button>
        {message && (
          <span className={`text-sm ${state === "error" ? "text-rose-600 dark:text-rose-400" : "text-[var(--text-muted)]"}`}>
            {message}
          </span>
        )}
      </div>
    </form>
  );
}
