/**
 * The weekly digest, as an HTML email.
 *
 * Built with tables and inline styles rather than a framework: Outlook and
 * Gmail between them ignore most of modern CSS, and a digest that renders
 * badly is a digest that gets unsubscribed from.
 *
 * The tone is deliberately plain. This lands on a Monday morning and has a
 * few seconds to say what changed and what needs doing.
 */

export interface Digest {
  week_from: string;
  week_to: string;
  revenue: number;
  revenue_prev: number;
  classes: number;
  attended: number;
  attended_prev: number;
  no_shows: number;
  no_shows_prev: number;
  fill: number | null;
  fill_prev: number | null;
  empty_seats: number;
  quiet_members: number;
  by_location: { name: string; classes: number; attended: number; fill: number | null; prev_fill: number | null }[];
  weak_slots: { slot: string; location: string; classes: number; fill: number }[];
}

const GREEN = "#3f6f5a";
const RED = "#b4593f";
const MUTED = "#77736c";
const BORDER = "#e7e5e1";

function money(v: number, currency: string) {
  return new Intl.NumberFormat("en-IE", {
    style: "currency", currency, maximumFractionDigits: 0,
  }).format(Number(v) || 0);
}

function delta(now: number, before: number) {
  if (!before) return null;
  return Math.round(((now - before) / before) * 100);
}

/** Up is good for most things, bad for no-shows. */
function arrow(change: number | null, inverted = false) {
  if (change === null || change === 0) return "";
  const good = change > 0 !== inverted;
  const colour = good ? GREEN : RED;
  const mark = change > 0 ? "&#9650;" : "&#9660;";
  return `<span style="color:${colour};font-size:13px;white-space:nowrap">&nbsp;${mark} ${Math.abs(change)}%</span>`;
}

function stat(label: string, value: string, change: string) {
  return `
    <td style="padding:0 8px 16px 0;vertical-align:top;width:50%">
      <div style="font:500 11px/1.4 -apple-system,Segoe UI,sans-serif;color:${MUTED};text-transform:uppercase;letter-spacing:.06em">${label}</div>
      <div style="font:600 22px/1.3 -apple-system,Segoe UI,sans-serif;color:#1c1b19;margin-top:2px">${value}${change}</div>
    </td>`;
}

export function renderDigest(d: Digest, opts: { studio: string; currency: string; url: string }): string {
  const revChange = delta(Number(d.revenue), Number(d.revenue_prev));
  const attChange = delta(Number(d.attended), Number(d.attended_prev));
  const nsChange = delta(Number(d.no_shows), Number(d.no_shows_prev));
  const fillPts =
    d.fill !== null && d.fill_prev !== null ? Math.round(Number(d.fill) - Number(d.fill_prev)) : null;

  const range = `${new Date(d.week_from).toLocaleDateString("en-IE", { day: "numeric", month: "short" })} – ${new Date(d.week_to).toLocaleDateString("en-IE", { day: "numeric", month: "short" })}`;

  const locations = d.by_location
    .map((l) => {
      const shift =
        l.fill !== null && l.prev_fill !== null ? Math.round(Number(l.fill) - Number(l.prev_fill)) : null;
      const shiftText =
        shift === null || shift === 0
          ? ""
          : `<span style="color:${shift > 0 ? GREEN : RED}">&nbsp;${shift > 0 ? "+" : ""}${shift}pt</span>`;
      return `
      <tr>
        <td style="padding:7px 0;border-top:1px solid ${BORDER};font:14px -apple-system,Segoe UI,sans-serif">${l.name.replace(/^balance\s*-\s*/i, "")}</td>
        <td style="padding:7px 0;border-top:1px solid ${BORDER};font:14px -apple-system,Segoe UI,sans-serif;color:${MUTED};text-align:right">${l.classes}</td>
        <td style="padding:7px 0 7px 14px;border-top:1px solid ${BORDER};font:14px -apple-system,Segoe UI,sans-serif;text-align:right">${l.fill ?? "—"}%${shiftText}</td>
      </tr>`;
    })
    .join("");

  const slots = d.weak_slots.length
    ? d.weak_slots
        .map(
          (s) => `
      <tr>
        <td style="padding:6px 0;border-top:1px solid ${BORDER};font:14px -apple-system,Segoe UI,sans-serif">${s.slot} &middot; <span style="color:${MUTED}">${s.location.replace(/^balance\s*-\s*/i, "")}</span></td>
        <td style="padding:6px 0;border-top:1px solid ${BORDER};font:14px -apple-system,Segoe UI,sans-serif;text-align:right;color:${RED}">${s.fill}%</td>
      </tr>`,
        )
        .join("")
    : `<tr><td style="padding:6px 0;font:14px -apple-system,Segoe UI,sans-serif;color:${MUTED}">Nothing notably weak this week.</td></tr>`;

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${opts.studio} — week to ${range}</title></head>
<body style="margin:0;padding:0;background:#fbfbfa">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbfbfa">
<tr><td align="center" style="padding:28px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:#fff;border:1px solid ${BORDER};border-radius:12px">
  <tr><td style="padding:26px 26px 8px">
    <div style="font:600 18px/1.3 -apple-system,Segoe UI,sans-serif;color:#1c1b19">${opts.studio}</div>
    <div style="font:14px/1.4 -apple-system,Segoe UI,sans-serif;color:${MUTED};margin-top:2px">Week of ${range}</div>
  </td></tr>

  <tr><td style="padding:18px 26px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        ${stat("Revenue", money(Number(d.revenue), opts.currency), arrow(revChange))}
        ${stat("Attended", Number(d.attended).toLocaleString(), arrow(attChange))}
      </tr>
      <tr>
        ${stat("Average fill", d.fill === null ? "—" : `${Math.round(Number(d.fill))}%`,
               fillPts === null || fillPts === 0 ? "" : `<span style="color:${fillPts > 0 ? GREEN : RED};font-size:13px">&nbsp;${fillPts > 0 ? "+" : ""}${fillPts}pt</span>`)}
        ${stat("No-shows", Number(d.no_shows).toLocaleString(), arrow(nsChange, true))}
      </tr>
    </table>
  </td></tr>

  <tr><td style="padding:6px 26px 0">
    <div style="font:14px/1.5 -apple-system,Segoe UI,sans-serif;color:#1c1b19;background:#f6f5f3;border-radius:8px;padding:12px 14px">
      <strong>${Number(d.empty_seats).toLocaleString()}</strong> seats went unsold across ${d.classes} classes, and
      <strong>${d.quiet_members}</strong> regulars have not booked in three weeks or more.
    </div>
  </td></tr>

  <tr><td style="padding:22px 26px 0">
    <div style="font:600 13px/1.4 -apple-system,Segoe UI,sans-serif;color:#1c1b19;margin-bottom:2px">By location</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="font:500 11px -apple-system,Segoe UI,sans-serif;color:${MUTED};text-transform:uppercase;letter-spacing:.06em;padding-bottom:2px">Site</td>
        <td style="font:500 11px -apple-system,Segoe UI,sans-serif;color:${MUTED};text-transform:uppercase;letter-spacing:.06em;text-align:right;padding-bottom:2px">Classes</td>
        <td style="font:500 11px -apple-system,Segoe UI,sans-serif;color:${MUTED};text-transform:uppercase;letter-spacing:.06em;text-align:right;padding-bottom:2px">Fill</td>
      </tr>
      ${locations}
    </table>
  </td></tr>

  <tr><td style="padding:22px 26px 0">
    <div style="font:600 13px/1.4 -apple-system,Segoe UI,sans-serif;color:#1c1b19;margin-bottom:2px">Weakest slots this week</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${slots}</table>
  </td></tr>

  <tr><td style="padding:24px 26px 28px">
    <a href="${opts.url}/dashboard" style="display:inline-block;background:${GREEN};color:#fff;font:500 14px -apple-system,Segoe UI,sans-serif;text-decoration:none;padding:10px 18px;border-radius:8px">Open the dashboard</a>
    <div style="font:12px/1.5 -apple-system,Segoe UI,sans-serif;color:${MUTED};margin-top:14px">
      Figures cover the seven days to ${new Date(d.week_to).toLocaleDateString("en-IE", { day: "numeric", month: "long" })},
      compared with the seven before. Fill counts seats used, not seats sold.
    </div>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}
