import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { documentSchema } from "@/lib/validators";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = prisma;
  if (!db) {
    return NextResponse.json({ error: "Document storage is disabled until the database is configured." }, { status: 503 });
  }

  const docs = await db.document.findMany({
    where: { ownerId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 25
  });

  return NextResponse.json(docs);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = prisma;
  if (!db) {
    return NextResponse.json({ error: "Document storage is disabled until the database is configured." }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const parsed = documentSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const doc = await db.document.create({
    data: {
      title: parsed.data.title,
      content: parsed.data.content,
      tone: parsed.data.tone,
      prompt: parsed.data.prompt,
      characterLength: parsed.data.characterLength ?? undefined,
      wordLength: parsed.data.wordLength ?? undefined,
      gradeLevel: parsed.data.gradeLevel ?? undefined,
      benchmark: parsed.data.benchmark ?? undefined,
      avoidWords: parsed.data.avoidWords ?? undefined,
      ownerId: session.user.id
    }
  });

  return NextResponse.json(doc);
}

