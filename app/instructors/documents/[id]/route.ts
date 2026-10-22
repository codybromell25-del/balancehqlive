import { NextResponse, type NextRequest } from "next/server";
import { getAccess } from "@/lib/access";
import { BUCKET, isUuid } from "@/lib/instructors";

/**
 * Opens a document through a signed link that expires in a minute.
 *
 * The bucket is private, so there is no permanent URL to forward or
 * bookmark: each open is checked against the viewer's role, and a link
 * copied out of the address bar stops working almost at once.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db, user, canManageDocs } = await getAccess();

  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  if (!canManageDocs || !isUuid(id)) return new NextResponse("Not found", { status: 404 });

  const { data: doc } = await db
    .from("instructor_documents")
    .select("file_path")
    .eq("id", id)
    .maybeSingle();
  if (!doc) return new NextResponse("Not found", { status: 404 });

  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(doc.file_path as string, 60);
  if (error || !data) return new NextResponse("Couldn't open that document", { status: 502 });

  return NextResponse.redirect(data.signedUrl);
}
