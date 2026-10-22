/**
 * Instructor documents: the shared vocabulary for the pages, the server
 * actions and the upload form.
 */

export const BUCKET = "instructor-documents";

/** Largest file the bucket accepts (migration 0018 sets the same limit). */
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

/** How far ahead an insurance expiry starts showing as a warning: a month. */
export const WARN_DAYS = 30;

export const DOC_TYPES = [
  { key: "insurance", label: "Insurance" },
  { key: "qualification", label: "Qualification" },
  { key: "first_aid", label: "First aid" },
  { key: "contract", label: "Contract" },
  { key: "id", label: "ID" },
  { key: "other", label: "Other" },
] as const;

export type DocType = (typeof DOC_TYPES)[number]["key"];

export const isDocType = (v: string): v is DocType => DOC_TYPES.some((d) => d.key === v);

export const docTypeLabel = (key: string) => DOC_TYPES.find((d) => d.key === key)?.label ?? key;

export const isUuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export const isIsoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/**
 * Today on the studio's calendar. The server runs in UTC, and an expiry
 * that flips at midnight should flip at Irish midnight.
 */
export function todayInDublin(now = new Date()) {
  return now.toLocaleDateString("sv-SE", { timeZone: "Europe/Dublin" });
}

function daysBetween(fromIso: string, toIso: string) {
  return Math.round(
    (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000,
  );
}

export type Insurance =
  | { state: "missing" }
  | { state: "expired" | "expiring" | "valid"; validUntil: string; days: number };

/**
 * An instructor's insurance, judged by the latest expiry on file: uploading
 * a renewed policy supersedes the old one without deleting it.
 */
export function insuranceFor(docs: { doc_type: string; valid_until: string | null }[], today = todayInDublin()): Insurance {
  const latest = docs
    .filter((d) => d.doc_type === "insurance" && d.valid_until)
    .map((d) => d.valid_until as string)
    .sort()
    .at(-1);

  if (!latest) return { state: "missing" };
  const days = daysBetween(today, latest);
  if (days < 0) return { state: "expired", validUntil: latest, days };
  if (days <= WARN_DAYS) return { state: "expiring", validUntil: latest, days };
  return { state: "valid", validUntil: latest, days };
}

export function formatDate(iso: string) {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function describeInsurance(i: Insurance) {
  switch (i.state) {
    case "missing":
      return "No insurance on file";
    case "expired":
      return `Expired ${formatDate(i.validUntil)}`;
    case "expiring":
      return i.days === 0
        ? "Expires today"
        : `Expires in ${i.days} day${i.days === 1 ? "" : "s"} · ${formatDate(i.validUntil)}`;
    case "valid":
      return `Valid until ${formatDate(i.validUntil)}`;
  }
}

/** Expired first, then soonest to expire, then missing. */
export function urgency(i: Insurance) {
  if (i.state === "expired") return i.days;
  if (i.state === "expiring") return 1_000 + i.days;
  if (i.state === "missing") return 10_000;
  return 100_000 + i.days;
}

export function formatBytes(n: number | null) {
  if (!n) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
