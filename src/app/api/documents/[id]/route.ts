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

  const db = prisma;
  if (!db) {
    return NextResponse.json(
      { error: "Document storage is disabled until the database is configured." },
      { status: 503 }
    );
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    // Check if document exists and belongs to user
    const existingDoc = await db.document.findFirst({
      where: {
        id,
        ownerId: session.user.id
      }
    });

    if (!existingDoc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Update document with provided fields
    const updatedDoc = await db.document.update({
      where: { id },
      data: {
        ...(body.title !== undefined && { title: body.title }),
        ...(body.content !== undefined && { content: body.content }),
        ...(body.tone !== undefined && { tone: body.tone }),
        ...(body.prompt !== undefined && { prompt: body.prompt }),
        ...(body.characterLength !== undefined && { characterLength: body.characterLength }),
        ...(body.wordLength !== undefined && { wordLength: body.wordLength }),
        ...(body.gradeLevel !== undefined && { gradeLevel: body.gradeLevel }),
        ...(body.benchmark !== undefined && { benchmark: body.benchmark }),
        ...(body.avoidWords !== undefined && { avoidWords: body.avoidWords }),
        ...(body.writingStyle !== undefined && { writingStyle: body.writingStyle }),
        ...(body.styleTitle !== undefined && { styleTitle: body.styleTitle }),
        ...(body.starred !== undefined && { starred: body.starred })
      } as any
    });

    return NextResponse.json(updatedDoc);
  } catch (error) {
    console.error("[documents][PATCH] failed", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Unable to update document.", details: errorMessage },
      { status: 500 }
    );
  }
}

