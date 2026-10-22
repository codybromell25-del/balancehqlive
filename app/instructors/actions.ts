"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAccess } from "@/lib/access";
import { BUCKET, isDocType, isIsoDate, isUuid } from "@/lib/instructors";

/**
 * Writes for the instructor documents section.
 *
 * Every action goes through the signed-in user's client, so row level
 * security has the final say: these checks exist to give a readable
 * message, not to hold the line on their own.
 */

export type FormState = { error?: string; ok?: boolean };

const text = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
const NO_ACCESS = "Your account can't change instructor documents.";

function refresh(instructorId?: string) {
  revalidatePath("/");
  revalidatePath("/instructors");
  if (instructorId) revalidatePath(`/instructors/${instructorId}`);
}

export async function addInstructor(_prev: FormState, form: FormData): Promise<FormState> {
  const { db, canManageDocs, docStudioId } = await getAccess();
  if (!canManageDocs || !docStudioId) return { error: NO_ACCESS };

  const fullName = text(form.get("full_name"));
  if (!fullName) return { error: "Add the instructor's name." };

  const { data, error } = await db
    .from("instructors")
    .insert({
      studio_id: docStudioId,
      full_name: fullName,
      email: text(form.get("email")) || null,
      phone: text(form.get("phone")) || null,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  refresh();
  // Straight to their page: adding someone is nearly always followed by
  // uploading their insurance.
  redirect(`/instructors/${data.id}`);
}

export async function updateInstructor(_prev: FormState, form: FormData): Promise<FormState> {
  const { db, canManageDocs } = await getAccess();
  if (!canManageDocs) return { error: NO_ACCESS };

  const id = text(form.get("id"));
  const fullName = text(form.get("full_name"));
  if (!isUuid(id)) return { error: "That instructor no longer exists." };
  if (!fullName) return { error: "The name can't be empty." };

  const { error } = await db
    .from("instructors")
    .update({
      full_name: fullName,
      email: text(form.get("email")) || null,
      phone: text(form.get("phone")) || null,
      notes: text(form.get("notes")) || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return { error: error.message };
  refresh(id);
  return { ok: true };
}

/** Archiving keeps the documents but takes the instructor out of the warnings. */
export async function setInstructorActive(id: string, active: boolean): Promise<FormState> {
  const { db, canManageDocs } = await getAccess();
  if (!canManageDocs) return { error: NO_ACCESS };
  if (!isUuid(id)) return { error: "That instructor no longer exists." };

  const { error } = await db
    .from("instructors")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { error: error.message };
  refresh(id);
  return { ok: true };
}

/**
 * Records a file the browser has already put in storage. The upload goes
 * straight from the browser to Supabase because a phone photo of an
 * insurance certificate is often bigger than a server action will accept.
 */
export async function recordDocument(input: {
  instructorId: string;
  docType: string;
  title: string;
  validUntil: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}): Promise<FormState> {
  const { db, canManageDocs, docStudioId } = await getAccess();
  if (!canManageDocs || !docStudioId) return { error: NO_ACCESS };

  const { instructorId, docType, validUntil, filePath } = input;
  if (!isUuid(instructorId)) return { error: "That instructor no longer exists." };
  if (!isDocType(docType)) return { error: "Pick what kind of document this is." };
  if (docType === "insurance" && !isIsoDate(validUntil)) {
    return { error: "Insurance needs the date it's valid until, so we can warn before it runs out." };
  }
  if (validUntil && !isIsoDate(validUntil)) return { error: "That date doesn't look right." };
  if (!filePath.startsWith(`${docStudioId}/${instructorId}/`)) return { error: "The upload went to the wrong folder." };

  const { error } = await db.from("instructor_documents").insert({
    studio_id: docStudioId,
    instructor_id: instructorId,
    doc_type: docType,
    title: input.title.trim() || null,
    valid_until: validUntil || null,
    file_path: filePath,
    file_name: input.fileName.slice(0, 200),
    file_size: input.fileSize,
    mime_type: input.mimeType || null,
  });

  if (error) return { error: error.message };
  refresh(instructorId);
  return { ok: true };
}

export async function deleteDocument(id: string): Promise<FormState> {
  const { db, canManageDocs } = await getAccess();
  if (!canManageDocs) return { error: NO_ACCESS };
  if (!isUuid(id)) return { error: "That document no longer exists." };

  const { data: doc } = await db
    .from("instructor_documents")
    .select("file_path, instructor_id")
    .eq("id", id)
    .maybeSingle();
  if (!doc) return { error: "That document no longer exists." };

  // Row first, then file. A file left behind is invisible and harmless; a
  // row whose file is gone is a broken link on the page.
  const { error } = await db.from("instructor_documents").delete().eq("id", id);
  if (error) return { error: error.message };
  await db.storage.from(BUCKET).remove([doc.file_path as string]);

  refresh(doc.instructor_id as string);
  return { ok: true };
}
