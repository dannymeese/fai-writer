import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const db = prisma;
  if (!db) {
    return NextResponse.json(
      { error: "Document storage is disabled until the database is configured." },
      { status: 503 }
    );
  }

  try {
    const body = await request.json().catch(() => null);
    const starred = typeof body?.starred === "boolean" ? body.starred : true;

    // Verify the document belongs to the user
    const document = await db.document.findFirst({
      where: { id, ownerId: session.user.id }
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Update the starred status
    const updated = await db.document.update({
      where: { id },
      data: { starred }
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[documents][star] failed", error);
    return NextResponse.json(
      { error: "Unable to update star status." },
      { status: 500 }
    );
  }
}

