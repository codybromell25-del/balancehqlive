/**
 * Give someone a balanceHQ sign-in, change what they can open, or remove it.
 *
 *   npm run access:grant -- --email jane@balance.ie --role instructor_admin
 *   npm run access:grant -- --email jane@balance.ie --remove
 *
 * Roles (migration 0018):
 *   owner              reports and instructor documents
 *   admin              reports and instructor documents
 *   viewer             reports only
 *   instructor_admin   instructor documents only
 *
 * New people get an account with no password and nothing is emailed. They
 * sign in with "Email me a link instead" on the login page.
 */

import { serviceClient } from "../lib/db";

const ROLES = ["owner", "admin", "viewer", "instructor_admin"] as const;

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(`--${flag}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email")?.trim().toLowerCase();
  const role = arg("role");
  const remove = process.argv.includes("--remove");
  const slug = arg("studio") ?? "balance";

  if (!email || (!remove && !ROLES.includes(role as (typeof ROLES)[number]))) {
    console.error(`Usage: --email <address> --role <${ROLES.join("|")}>   or   --email <address> --remove`);
    process.exit(1);
  }

  const db = serviceClient();
  const { data: studio, error: studioError } = await db.from("studios").select("id, name").eq("slug", slug).single();
  if (studioError || !studio) throw new Error(`No studio with slug "${slug}"`);

  // listUsers pages; walk them rather than assume one page holds everyone.
  let userId: string | undefined;
  for (let page = 1; !userId; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id;
    if (data.users.length < 1000) break;
  }

  if (remove) {
    if (!userId) return console.log(`${email} has no sign-in. Nothing to remove.`);
    const { error } = await db.from("studio_users").delete().eq("studio_id", studio.id).eq("user_id", userId);
    if (error) throw error;
    return console.log(`Removed ${email}'s access to ${studio.name}. Their sign-in now opens nothing.`);
  }

  if (!userId) {
    const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true });
    if (error) throw error;
    userId = data.user.id;
    console.log(`Created a sign-in for ${email}.`);
  }

  const { error } = await db
    .from("studio_users")
    .upsert({ studio_id: studio.id, user_id: userId, role }, { onConflict: "studio_id,user_id" });
  if (error) throw error;

  console.log(`${email} is now ${role} at ${studio.name}. They sign in with "Email me a link instead".`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
