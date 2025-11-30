import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { documentSchema } from "@/lib/validators";
import { logEvent } from "@/lib/logger";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    logEvent("documents GET unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = prisma;
  if (!db) {
    logEvent("documents GET no db");
    return NextResponse.json({ error: "Document storage is disabled until the database is configured." }, { status: 503 });
  }

  logEvent("documents GET", { userId: session.user.id });
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
    logEvent("documents POST unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = prisma;
  if (!db) {
    logEvent("documents POST no db");
    return NextResponse.json({ error: "Document storage is disabled until the database is configured." }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const parsed = documentSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  logEvent("documents POST", { userId: session.user.id, title: parsed.data.title });

  const doc = await db.document.create({
    data: {
      title: parsed.data.title,
      content: parsed.data.content,
      tone: parsed.data.tone,
      prompt: parsed.data.prompt,
      characterLength: parsed.data.characterLength,
      wordLength: parsed.data.wordLength,
      gradeLevel: parsed.data.gradeLevel,
      benchmark: parsed.data.benchmark,
      avoidWords: parsed.data.avoidWords,
      writingStyle: parsed.data.writingStyle,
      ownerId: session.user.id
    } as any
  });

  return NextResponse.json(doc);
}

