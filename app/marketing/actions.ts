"use server";

import { revalidatePath } from "next/cache";
import { getAccess } from "@/lib/access";
import { isUuid } from "@/lib/instructors";
import { MAX_FLAG_DETAIL, MAX_FLAG_TITLE, MAX_NOTE, isDay, isFlagKind } from "@/lib/marketing";

/**
 * Writes for the marketing calendar.
 *
 * Each runs as the signed-in person, so row level security has the final
 * say (migration 0021): who wrote a note or gave a like is stamped from
 * their session, and only they, or an owner or admin, can delete it. These
 * checks are here for a readable message.
 */

export type Result = { error?: string };

const NO_ACCESS = "Your account can't use the marketing calendar.";
const clean = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const UNIQUE_VIOLATION = "23505";

export async function addNote(input: {
  id: string;
  day: string;
  body: string;
  parentId: string | null;
}): Promise<Result> {
  const { db, canPlan, planStudioId } = await getAccess();
  if (!canPlan || !planStudioId) return { error: NO_ACCESS };

  const body = clean(input.body);
  if (!isUuid(input.id) || !isDay(input.day)) return { error: "That day isn't valid." };
  if (input.parentId !== null && !isUuid(input.parentId)) return { error: "That note no longer exists." };
  if (!body) return { error: "Write something first." };
  if (body.length > MAX_NOTE) return { error: `Keep a note under ${MAX_NOTE} characters.` };

  // The id comes from the browser so the note it already shows keeps its
  // place when the saved one arrives.
  const { error } = await db.from("marketing_notes").insert({
    id: input.id,
    studio_id: planStudioId,
    day: input.day,
    body,
    parent_id: input.parentId,
  });
  if (error) return { error: error.message };

  revalidatePath("/marketing");
  return {};
}

export async function deleteNote(id: string): Promise<Result> {
  const { db, canPlan } = await getAccess();
  if (!canPlan) return { error: NO_ACCESS };
  if (!isUuid(id)) return { error: "That note no longer exists." };

  const { data, error } = await db.from("marketing_notes").delete().eq("id", id).select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Only the person who wrote a note, or an owner, can delete it." };

  revalidatePath("/marketing");
  return {};
}

export async function setLike(noteId: string, liked: boolean): Promise<Result> {
  const { db, user, canPlan } = await getAccess();
  if (!user || !canPlan) return { error: NO_ACCESS };
  if (!isUuid(noteId)) return { error: "That note no longer exists." };

  const { error } = liked
    ? await db.from("marketing_note_likes").insert({ note_id: noteId })
    : await db.from("marketing_note_likes").delete().eq("note_id", noteId).eq("user_id", user.id);
  // Liking twice, from two tabs, is still one like.
  if (error && error.code !== UNIQUE_VIOLATION) return { error: error.message };

  revalidatePath("/marketing");
  return {};
}

export async function addFlag(day: string, form: FormData): Promise<Result> {
  const { db, canPlan, planStudioId } = await getAccess();
  if (!canPlan || !planStudioId) return { error: NO_ACCESS };

  const title = clean(form.get("title"));
  const detail = clean(form.get("detail"));
  const kind = clean(form.get("kind"));
  if (!isDay(day)) return { error: "That day isn't valid." };
  if (!isFlagKind(kind)) return { error: "Choose what kind of date this is." };
  if (!title) return { error: "Give the flag a name." };
  if (title.length > MAX_FLAG_TITLE) return { error: `Keep the name under ${MAX_FLAG_TITLE} characters.` };
  if (detail.length > MAX_FLAG_DETAIL) return { error: `Keep the detail under ${MAX_FLAG_DETAIL} characters.` };

  const { error } = await db.from("marketing_flags").insert({
    studio_id: planStudioId,
    day,
    kind,
    title,
    detail: detail || null,
  });
  if (error?.code === UNIQUE_VIOLATION) return { error: "This day already has a flag with that name." };
  if (error) return { error: error.message };

  // The front page shows the next flagged day.
  revalidatePath("/");
  revalidatePath("/marketing");
  return {};
}

export async function deleteFlag(id: string): Promise<Result> {
  const { db, canPlan } = await getAccess();
  if (!canPlan) return { error: NO_ACCESS };
  if (!isUuid(id)) return { error: "That flag no longer exists." };

  const { data, error } = await db.from("marketing_flags").delete().eq("id", id).select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Only the person who added a flag, or an owner, can remove it." };

  revalidatePath("/");
  revalidatePath("/marketing");
  return {};
}
