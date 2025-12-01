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

    console.log("[documents][GET] Found", docs.length, "documents for user", session.user.id);
    return NextResponse.json(docs);
  } catch (error) {
    console.error("[documents][GET] failed", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[documents][GET] error details:", errorMessage);
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
    // Validate required fields for style documents
    if (!parsed.data.title || !parsed.data.content) {
      return NextResponse.json(
        { error: "Title and content are required." },
        { status: 400 }
      );
    }

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
        styleTitle: parsed.data.styleTitle ?? undefined,
        starred: parsed.data.starred ?? false,
        ownerId: session.user.id
      } as any
    });

    console.log("[documents][POST] Successfully saved document:", {
      id: doc.id,
      title: doc.title,
      hasStyleTitle: !!doc.styleTitle,
      hasWritingStyle: !!doc.writingStyle
    });

    return NextResponse.json(doc);
  } catch (error) {
    console.error("[documents][POST] failed", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[documents][POST] error details:", {
      message: errorMessage,
      title: parsed.data.title,
      styleTitle: parsed.data.styleTitle,
      contentLength: parsed.data.content?.length,
      hasWritingStyle: !!parsed.data.writingStyle,
      writingStyleLength: parsed.data.writingStyle?.length
    });
    
    // Check if it's a database constraint error
    if (errorMessage.includes("Unique constraint") || errorMessage.includes("duplicate")) {
      return NextResponse.json(
        { error: "A style with this name already exists." },
        { status: 409 }
      );
    }
    
    return NextResponse.json(
      { error: "Unable to save writing style.", details: errorMessage },
      { status: 500 }
    );
  }
}

