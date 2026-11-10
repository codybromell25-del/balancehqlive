/**
 * Load researched leads into the sales dashboard.
 *
 *   npm run leads:import -- --file ~/Documents/balance-sales-leads/leads.json
 *
 * The file is a JSON array of leads with the fields in lib/sales.ts. Each
 * needs a `ref`, a stable key such as a school's roll number, so importing
 * again refreshes contact details without touching a lead's status,
 * follow-up date or history. Keep the file out of the repository: it is a
 * contact list.
 */

import { readFileSync } from "node:fs";
import { serviceClient } from "../lib/db";
import { formatPhone, isArea, isCategory } from "../lib/sales";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(`--${flag}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

type Incoming = Record<string, unknown>;

const text = (v: unknown, max = 500) => {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return t ? t.slice(0, max) : null;
};

async function main() {
  const file = arg("file");
  const slug = arg("studio") ?? "balance";
  if (!file) {
    console.error("Usage: --file <path to a JSON array of leads>");
    process.exit(1);
  }

  const db = serviceClient();
  const { data: studio, error } = await db.from("studios").select("id").eq("slug", slug).single();
  if (error || !studio) throw new Error(`No studio with slug "${slug}"`);

  const incoming = JSON.parse(readFileSync(file, "utf8")) as Incoming[];
  const rows = [];
  const skipped: string[] = [];
  for (const l of incoming) {
    const name = text(l.name, 200);
    const ref = text(l.ref, 300);
    const category = String(l.category ?? "");
    const area = String(l.area ?? "");
    const email = text(l.email, 254)?.toLowerCase() ?? null;
    const phone = formatPhone(text(l.phone, 60));
    if (!name || !ref || !isCategory(category) || !isArea(area) || (!email && !phone)) {
      skipped.push(String(l.name ?? "(no name)"));
      continue;
    }
    rows.push({
      studio_id: studio.id,
      ref,
      name,
      category,
      area,
      town: text(l.town, 120),
      address: text(l.address),
      eircode: text(l.eircode, 10)?.toUpperCase() ?? null,
      phone,
      email,
      website: text(l.website, 300),
      contact_name: text(l.contact_name, 120),
      contact_role: text(l.contact_role, 120),
      size: text(l.size, 120),
      sector: text(l.sector, 120),
      distance_km: typeof l.distance_km === "number" ? Math.round(l.distance_km * 10) / 10 : null,
      source: text(l.source, 500),
      notes: text(l.notes, 1000),
    });
  }

  for (let i = 0; i < rows.length; i += 500) {
    const { error: upsertError } = await db
      .from("sales_leads")
      .upsert(rows.slice(i, i + 500), { onConflict: "studio_id,ref" });
    if (upsertError) throw upsertError;
  }

  console.log(`Imported ${rows.length} lead${rows.length === 1 ? "" : "s"}; skipped ${skipped.length}.`);
  if (skipped.length) console.log(`Skipped (missing name, ref, type, studio, or any contact): ${skipped.slice(0, 20).join(", ")}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
