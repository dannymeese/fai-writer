import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
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

  if (!prisma) {
    return NextResponse.json(
      { error: "Folders are unavailable until the database is configured." },
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
    // Check if folder exists and belongs to user
    const existingFolder = await prisma.folder.findFirst({
      where: {
        id,
        ownerId: session.user.id
      }
    });

    if (!existingFolder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }

    // Build update data object
    const updateData: any = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.pinned !== undefined) {
      // Ensure pinned is a boolean
      updateData.pinned = Boolean(body.pinned);
    }
    
    console.log("[folders][PATCH] Updating folder", {
      folderId: id,
      userId: session.user.id,
      updateData,
      bodyPinned: body.pinned,
      bodyPinnedType: typeof body.pinned
    });

    // If no fields to update, return the existing folder
    if (Object.keys(updateData).length === 0) {
      const folder = await prisma.folder.findUnique({
        where: { id },
        include: {
          _count: {
            select: { documentFolders: true }
          }
        }
      });
      return NextResponse.json({
        id: folder!.id,
        name: folder!.name,
        createdAt: folder!.createdAt,
        documentCount: folder!._count.documentFolders,
        pinned: folder!.pinned
      });
    }

    // Update folder with provided fields
    const updatedFolder = await prisma.folder.update({
      where: { id },
      data: updateData,
      include: {
        _count: {
          select: { documentFolders: true }
        }
      }
    });

    return NextResponse.json({
      id: updatedFolder.id,
      name: updatedFolder.name,
      createdAt: updatedFolder.createdAt,
      documentCount: updatedFolder._count.documentFolders,
      pinned: updatedFolder.pinned
    });
  } catch (error) {
    // Handle Prisma-specific errors
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // P2025 = Record not found
      if (error.code === "P2025") {
        return NextResponse.json({ error: "Folder not found" }, { status: 404 });
      }
      // P2002 = Unique constraint violation
      if (error.code === "P2002") {
        console.error("[folders][PATCH] Unique constraint violation", error.meta);
        return NextResponse.json(
          { error: "A folder with this name already exists." },
          { status: 409 }
        );
      }
      // Other Prisma errors
      console.error("[folders][PATCH] Prisma error", {
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
      console.error("[folders][PATCH] Prisma initialization error", error.message);
      return NextResponse.json(
        { error: "Database connection failed. Please try again." },
        { status: 503 }
      );
    }

    // Handle other errors
    console.error("[folders][PATCH] failed", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error("[folders][PATCH] error details:", {
      message: errorMessage,
      stack: errorStack,
      folderId: id,
      userId: session.user.id,
      bodyKeys: body ? Object.keys(body) : []
    });
    return NextResponse.json(
      { error: `Unable to update folder: ${errorMessage}` },
      { status: 500 }
    );
  }
}

