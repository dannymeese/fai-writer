import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { generateStyleMetadata } from "@/lib/style-metadata";
import { Prisma } from "@prisma/client";

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
  let body: any = null;
  
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

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

    // Build update data object
    const updateData: any = {};
    if (body.title !== undefined) updateData.title = body.title;
    if (body.content !== undefined) updateData.content = body.content;
    if (body.tone !== undefined) updateData.tone = body.tone;
    if (body.prompt !== undefined) updateData.prompt = body.prompt;
    if (body.characterLength !== undefined) updateData.characterLength = body.characterLength;
    if (body.wordLength !== undefined) updateData.wordLength = body.wordLength;
    if (body.gradeLevel !== undefined) updateData.gradeLevel = body.gradeLevel;
    if (body.benchmark !== undefined) updateData.benchmark = body.benchmark;
    if (body.avoidWords !== undefined) updateData.avoidWords = body.avoidWords;
    if (body.writingStyle !== undefined) updateData.writingStyle = body.writingStyle;
    if (body.styleSummary !== undefined) updateData.styleSummary = body.styleSummary;
    if (body.styleTitle !== undefined) updateData.styleTitle = body.styleTitle;
    if (body.pinned !== undefined) updateData.pinned = body.pinned;

    const shouldGenerateStyleMetadata =
      body.styleTitle !== undefined || body.writingStyle !== undefined || body.styleSummary !== undefined;

    if (shouldGenerateStyleMetadata) {
      try {
        const metadata = await generateStyleMetadata({
          writingStyle: body.writingStyle ?? existingDoc.writingStyle ?? null,
          content: body.content ?? existingDoc.content ?? null,
          styleTitle: body.styleTitle ?? existingDoc.styleTitle ?? null,
          styleSummary: body.styleSummary ?? existingDoc.styleSummary ?? null,
          fallbackTitle: body.title ?? existingDoc.title
        });
        if (metadata.styleTitle) {
          updateData.styleTitle = metadata.styleTitle;
          if (updateData.title === undefined) {
            updateData.title = metadata.styleTitle;
          }
        }
        if (metadata.styleSummary !== null) {
          updateData.styleSummary = metadata.styleSummary;
        }
      } catch (error) {
        console.error("[documents][PATCH] style metadata generation failed", error);
      }
    }

    // If no fields to update, return the existing document
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(existingDoc);
    }

    // Update document with provided fields
    const updatedDoc = await db.document.update({
      where: { id },
      data: updateData
    });

    return NextResponse.json(updatedDoc);
  } catch (error) {
    // Handle Prisma-specific errors
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // P2025 = Record not found
      if (error.code === "P2025") {
        return NextResponse.json({ error: "Document not found" }, { status: 404 });
      }
      // P2002 = Unique constraint violation
      if (error.code === "P2002") {
        console.error("[documents][PATCH] Unique constraint violation", error.meta);
        return NextResponse.json(
          { error: "A document with this identifier already exists." },
          { status: 409 }
        );
      }
      // Other Prisma errors
      console.error("[documents][PATCH] Prisma error", {
        code: error.code,
        meta: error.meta,
        message: error.message
      });
      return NextResponse.json(
        { error: "Database error occurred.", details: error.message },
        { status: 500 }
      );
    }

    // Handle Prisma connection errors
    if (error instanceof Prisma.PrismaClientInitializationError) {
      console.error("[documents][PATCH] Prisma initialization error", error.message);
      return NextResponse.json(
        { error: "Database connection failed. Please try again." },
        { status: 503 }
      );
    }

    // Handle other errors
    console.error("[documents][PATCH] failed", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error("[documents][PATCH] error details:", {
      message: errorMessage,
      stack: errorStack,
      documentId: id,
      userId: session.user.id,
      bodyKeys: body ? Object.keys(body) : []
    });
    return NextResponse.json(
      { error: "Unable to update document.", details: errorMessage },
      { status: 500 }
    );
  }
}

