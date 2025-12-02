import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { folderCreateSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

export async function GET() {
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

  try {
    const folders = await prisma.folder.findMany({
      where: { ownerId: session.user.id },
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: { documentFolders: true }
        }
      },
      take: 100
    });

    return NextResponse.json(
      folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        createdAt: folder.createdAt,
        documentCount: folder._count.documentFolders
      }))
    );
  } catch (error) {
    console.error("[folders][GET] failed", error);
    return NextResponse.json(
      { error: "Unable to load folders." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
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

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = folderCreateSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const name = parsed.data.name.trim();
  if (!name) {
    return NextResponse.json({ error: "Folder name cannot be empty." }, { status: 400 });
  }

  try {
    const folder = await prisma.folder.create({
      data: {
        name,
        ownerId: session.user.id
      }
    });

    return NextResponse.json({
      id: folder.id,
      name: folder.name,
      createdAt: folder.createdAt,
      documentCount: 0
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "You already have a folder with that name." }, { status: 409 });
    }
    console.error("[folders][POST] failed", error);
    return NextResponse.json(
      { error: "Unable to create folder." },
      { status: 500 }
    );
  }
}

