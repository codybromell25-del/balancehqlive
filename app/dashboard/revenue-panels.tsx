/** Server components — static, no client bundle. */

export interface RevenueMix {
  total: number; membership: number; intro: number; other: number;
  avg_sale: number; customers: number; per_customer: number;
}

export function MixBar({ data, currency }: { data: RevenueMix; currency: string }) {
  const fmt = (v: number) =>
    new Intl.NumberFormat("en-IE", { style: "currency", currency, maximumFractionDigits: 0 }).format(v);

  const total = Number(data.total) || 1;
  const parts = [
    { key: "membership", label: "Memberships", value: Number(data.membership), opacity: 1,
      hint: "recurring — the predictable part" },
    { key: "intro", label: "Intro offers", value: Number(data.intro), opacity: 0.6,
      hint: "new customers coming in" },
    { key: "other", label: "Everything else", value: Number(data.other), opacity: 0.32,
      hint: "packs, drop-ins, retail" },
  ];

  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-[var(--chip)]">
        {parts.map((p) => (
          <div
            key={p.key}
            style={{ width: `${(p.value / total) * 100}%`, background: "var(--accent)", opacity: p.opacity }}
            title={`${p.label}: ${fmt(p.value)}`}
          />
        ))}
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {parts.map((p) => (
          <div key={p.key}>
            <dt className="text-[0.68rem] uppercase tracking-wider text-[var(--text-muted)]">{p.label}</dt>
            <dd className="mt-0.5 font-mono text-lg tabular-nums">{fmt(p.value)}</dd>
            <dd className="text-[0.65rem] text-[var(--text-muted)]">
              {Math.round((p.value / total) * 100)}% · {p.hint}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export interface IntroOffers {
  intros: number; converted: number; conversion: number | null;
  pending: number; mature_days: number; median_days: number | null;
  value_after: number;
  by_location: { name: string; intros: number; converted: number; conversion: number }[];
}

export function IntroFunnel({ data, currency }: { data: IntroOffers; currency: string }) {
  const fmt = (v: number) =>
    new Intl.NumberFormat("en-IE", { style: "currency", currency, maximumFractionDigits: 0 }).format(v);

  const best = Math.max(...data.by_location.map((l) => l.conversion), 1);

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Intro offers" value={data.intros.toLocaleString()} note={`older than ${data.mature_days} days`} />
        <Stat label="Bought again" value={`${data.conversion ?? "—"}%`} note={`${data.converted.toLocaleString()} people`} />
        <Stat label="Typical wait" value={data.median_days ? `${Math.round(data.median_days)} days` : "—"} note="to the next purchase" />
        <Stat label="They then spent" value={fmt(Number(data.value_after))} note="after the intro" />
      </div>

      {data.pending > 0 && (
        <p className="mt-3 text-xs text-[var(--text-muted)]">
          A further {data.pending.toLocaleString()} intro offers were bought in the last{" "}
          {data.mature_days} days and are excluded — most conversions happen around day{" "}
          {Math.round(data.median_days ?? 23)}, so counting them yet would read as failure.
        </p>
      )}

      {data.by_location.length > 0 && (
        <table className="mt-5 w-full text-sm">
          <thead>
            <tr className="text-left text-[0.68rem] uppercase tracking-wider text-[var(--text-muted)]">
              <th className="pb-2 font-medium">Location</th>
              <th className="pb-2 pl-3 text-right font-medium">Sold</th>
              <th className="pb-2 pl-3 font-medium">Converted</th>
            </tr>
          </thead>
          <tbody>
            {data.by_location.map((l) => (
              <tr key={l.name} className="border-t border-[var(--border)]">
                <td className="py-2 pr-3">{l.name.replace(/^balance\s*-\s*/i, "")}</td>
                <td className="py-2 pl-3 text-right tabular-nums text-[var(--text-muted)]">{l.intros}</td>
                <td className="py-2 pl-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-[var(--chip)]">
                      <div className="h-full rounded-full"
                        style={{ width: `${(l.conversion / best) * 100}%`, background: "var(--accent)" }} />
                    </div>
                    <span className="tabular-nums">{l.conversion}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      <div className="text-[0.68rem] uppercase tracking-wider text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 font-mono text-xl tabular-nums">{value}</div>
      {note && <div className="mt-0.5 text-[0.65rem] text-[var(--text-muted)]">{note}</div>}
    </div>
  );
}
