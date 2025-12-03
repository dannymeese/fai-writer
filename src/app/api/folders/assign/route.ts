import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { folderAssignSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json(
      { error: "Folder assignments require the database to be configured." },
      { status: 503 }
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = folderAssignSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { folderId, documentId } = parsed.data;

  try {
    const [folder, document] = await Promise.all([
      prisma.folder.findFirst({
        where: {
          id: folderId,
          ownerId: session.user.id
        }
      }),
      prisma.document.findFirst({
        where: {
          id: documentId,
          ownerId: session.user.id
        }
      })
    ]);

    if (!folder) {
      return NextResponse.json({ error: "Folder not found." }, { status: 404 });
    }

    if (!document) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }

    // Check if the assignment already exists
    const existingAssignment = await prisma.documentFolder.findFirst({
      where: {
        documentId,
        folderId
      }
    });

    // Only create if it doesn't exist
    if (!existingAssignment) {
      try {
        await prisma.documentFolder.create({
          data: {
            documentId,
            folderId
          }
        });
      } catch (createError) {
        // Handle race condition where assignment was created between check and create
        if (createError instanceof Prisma.PrismaClientKnownRequestError) {
          // P2002 = Unique constraint violation (shouldn't happen with composite PK, but handle anyway)
          // P2003 = Foreign key constraint violation
          if (createError.code === "P2002" || createError.code === "P2003") {
            // Assignment might already exist or foreign key issue - verify it exists
            const verifyAssignment = await prisma.documentFolder.findFirst({
              where: {
                documentId,
                folderId
              }
            });
            if (!verifyAssignment) {
              throw createError; // Re-throw if it's a real error
            }
            // Otherwise, assignment exists now, which is fine
          } else {
            throw createError; // Re-throw other errors
          }
        } else {
          throw createError; // Re-throw non-Prisma errors
        }
      }
    }

    return NextResponse.json({
      documentId,
      folder: {
        id: folder.id,
        name: folder.name
      },
      assigned: true
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Unable to assign folder." }, { status: 404 });
    }
    console.error("[folders][assign][POST] failed", error);
    return NextResponse.json({ error: "Unable to add document to folder." }, { status: 500 });
  }
}

