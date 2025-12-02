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

    await prisma.documentFolder.upsert({
      where: {
        documentId_folderId: {
          documentId,
          folderId
        }
      },
      update: {},
      create: {
        documentId,
        folderId
      }
    });

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

