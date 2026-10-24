"use server";

import { revalidatePath } from "next/cache";
import { getAccess } from "@/lib/access";
import { serviceClient } from "@/lib/db";
import { isStaffRole as isRole } from "./roles";

/**
 * Staff logins, managed by the studio owner.
 *
 * Changing someone's password or creating a login needs the service role,
 * which bypasses row level security, so every action first proves the
 * caller is an owner of the studio, and only ever touches logins that
 * belong to that studio. Passwords pass straight through to Supabase and
 * are never stored or logged here.
 */

export type FormState = { error?: string; ok?: string };

const MIN_PASSWORD = 8;
const text = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");

async function owner() {
  const { user, ownerStudioId } = await getAccess();
  if (!user || !ownerStudioId) return null;
  return { me: user.id, studioId: ownerStudioId };
}

/** The login's role in the owner's studio, or null when it isn't part of it. */
async function roleIn(studioId: string, userId: string) {
  const { data } = await serviceClient()
    .from("studio_users")
    .select("role")
    .eq("studio_id", studioId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.role as string | undefined) ?? null;
}

const inStudio = async (studioId: string, userId: string) => (await roleIn(studioId, userId)) !== null;

export async function addLogin(_prev: FormState, form: FormData): Promise<FormState> {
  const who = await owner();
  if (!who) return { error: "Only the studio owner can add logins." };

  const email = text(form.get("email")).toLowerCase();
  const password = String(form.get("password") ?? "");
  const role = text(form.get("role"));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter their email address." };
  if (password.length < MIN_PASSWORD) return { error: `The password needs at least ${MIN_PASSWORD} characters.` };
  if (!isRole(role)) return { error: "Choose what they can open." };

  const db = serviceClient();
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) {
    return /already|registered|exists/i.test(error.message)
      ? { error: "That email already has a login. Set a new password for it in the list instead." }
      : { error: error.message };
  }

  const { error: roleError } = await db
    .from("studio_users")
    .upsert({ studio_id: who.studioId, user_id: data.user.id, role }, { onConflict: "studio_id,user_id" });
  if (roleError) return { error: roleError.message };

  revalidatePath("/team");
  return { ok: `${email} can now sign in.` };
}

export async function setPassword(_prev: FormState, form: FormData): Promise<FormState> {
  const who = await owner();
  if (!who) return { error: "Only the studio owner can change passwords." };

  const userId = text(form.get("user_id"));
  const password = String(form.get("password") ?? "");
  if (password.length < MIN_PASSWORD) return { error: `At least ${MIN_PASSWORD} characters.` };
  if (!(await inStudio(who.studioId, userId))) return { error: "That login isn't part of your studio." };

  const { error } = await serviceClient().auth.admin.updateUserById(userId, { password });
  if (error) return { error: error.message };
  return { ok: "Password changed. Give them the new one." };
}

export async function setRole(_prev: FormState, form: FormData): Promise<FormState> {
  const who = await owner();
  if (!who) return { error: "Only the studio owner can change access." };

  const userId = text(form.get("user_id"));
  const role = text(form.get("role"));
  if (userId === who.me) return { error: "You can't change your own access." };
  if (!isRole(role)) return { error: "Choose what they can open." };
  const current = await roleIn(who.studioId, userId);
  if (current === null) return { error: "That login isn't part of your studio." };
  if (current === "owner") return { error: "Another owner's access can't be changed here." };

  const { error } = await serviceClient()
    .from("studio_users")
    .update({ role })
    .eq("studio_id", who.studioId)
    .eq("user_id", userId);
  if (error) return { error: error.message };

  revalidatePath("/team");
  return { ok: "Access updated." };
}

/** Takes away everything the login can open. The login itself remains, opening nothing. */
export async function removeAccess(userId: string): Promise<FormState> {
  const who = await owner();
  if (!who) return { error: "Only the studio owner can remove access." };
  if (userId === who.me) return { error: "You can't remove your own access." };
  if ((await roleIn(who.studioId, userId)) === "owner") return { error: "Another owner's access can't be removed here." };

  const { error } = await serviceClient()
    .from("studio_users")
    .delete()
    .eq("studio_id", who.studioId)
    .eq("user_id", userId);
  if (error) return { error: error.message };

  revalidatePath("/team");
  return { ok: "Access removed." };
}
