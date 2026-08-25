/**
 * Shared by the server page and the client filter bar, so it cannot live in
 * either. A "use client" module's non-component exports become client
 * reference proxies when imported from a Server Component — PERIODS.some
 * would then be undefined at runtime, which is exactly what happened.
 */
export const PERIODS = [
  { key: "7", label: "7 days", days: 7 },
  { key: "28", label: "28 days", days: 28 },
  { key: "90", label: "90 days", days: 90 },
  { key: "365", label: "12 months", days: 365 },
] as const;

export const DEFAULT_PERIOD = "28";
