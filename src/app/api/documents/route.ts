import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { documentSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    console.warn("[documents][GET] unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = prisma;
  if (!db) {
    console.error("[documents][GET] prisma unavailable");
    return NextResponse.json({ error: "Document storage is disabled until the database is configured." }, { status: 503 });
  }

  try {
    const docs = await db.document.findMany({
      where: { ownerId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 25
    });

    return NextResponse.json(docs);
  } catch (error) {
    console.error("[documents][GET] failed", error);
    return NextResponse.json({ error: "Unable to load saved documents." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    console.warn("[documents][POST] unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = prisma;
  if (!db) {
    console.error("[documents][POST] prisma unavailable");
    return NextResponse.json({ error: "Document storage is disabled until the database is configured." }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const parsed = documentSchema.safeParse(body);

  if (!parsed.success) {
    console.warn("[documents][POST] validation failed", parsed.error.flatten());
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const doc = await db.document.create({
      data: {
        title: parsed.data.title,
        content: parsed.data.content,
        tone: parsed.data.tone ?? undefined,
        prompt: parsed.data.prompt ?? undefined,
        characterLength: parsed.data.characterLength ?? undefined,
        wordLength: parsed.data.wordLength ?? undefined,
        gradeLevel: parsed.data.gradeLevel ?? undefined,
        benchmark: parsed.data.benchmark ?? undefined,
        avoidWords: parsed.data.avoidWords ?? undefined,
        writingStyle: parsed.data.writingStyle ?? undefined,
        ownerId: session.user.id
      } as any
    });

    return NextResponse.json(doc);
  } catch (error) {
    console.error("[documents][POST] failed", error);
    return NextResponse.json({ error: "Unable to save writing style." }, { status: 500 });
  }
}

