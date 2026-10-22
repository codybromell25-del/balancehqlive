/**
 * Add instructors in bulk from a text file, one name per line.
 *
 *   npm run instructors:add -- --file ~/instructors.txt
 *
 * Names already on the list (ignoring case) are skipped, so running it twice
 * is harmless. Keep the file out of the repository: it holds staff names.
 */

import { readFileSync } from "node:fs";
import { serviceClient } from "../lib/db";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(`--${flag}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const file = arg("file");
  const slug = arg("studio") ?? "balance";
  if (!file) {
    console.error("Usage: --file <path to a text file with one name per line>");
    process.exit(1);
  }

  const names = [...new Set(
    readFileSync(file, "utf8").split("\n").map((n) => n.trim().replace(/\s+/g, " ")).filter(Boolean),
  )];

  const db = serviceClient();
  const { data: studio, error: studioError } = await db.from("studios").select("id").eq("slug", slug).single();
  if (studioError || !studio) throw new Error(`No studio with slug "${slug}"`);

  const { data: existing, error } = await db.from("instructors").select("full_name").eq("studio_id", studio.id);
  if (error) throw error;
  const have = new Set((existing ?? []).map((r) => (r.full_name as string).toLowerCase()));

  const fresh = names.filter((n) => !have.has(n.toLowerCase()));
  if (fresh.length) {
    const { error: insertError } = await db
      .from("instructors")
      .insert(fresh.map((full_name) => ({ studio_id: studio.id, full_name })));
    if (insertError) throw insertError;
  }

  console.log(`Added ${fresh.length} instructor${fresh.length === 1 ? "" : "s"}; ${names.length - fresh.length} already there.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
