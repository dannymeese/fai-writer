import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { documentSchema } from "@/lib/validators";
import { deriveTitleFromContent, stripMarkdownFromTitle } from "@/lib/utils";
import { generateStyleMetadata } from "@/lib/style-metadata";
import { Prisma } from "@prisma/client";

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
      take: 25,
      include: {
        documentFolders: {
          include: {
            folder: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      }
    });

    // Transform documents to include folders array
    const docsWithFolders = docs.map((doc) => ({
      ...doc,
      folders: doc.documentFolders.map((df) => ({
        id: df.folder.id,
        name: df.folder.name
      }))
    }));

    console.log("[documents][GET] Found", docs.length, "documents for user", session.user.id);
    return NextResponse.json(docsWithFolders);
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

  let body: any = null;
  try {
    body = await request.json();
    console.log("[documents][POST] Received request body", {
      hasTitle: !!body.title,
      titleLength: body.title?.length,
      contentLength: body.content?.length,
      hasWritingStyle: !!body.writingStyle,
      writingStyleLength: body.writingStyle?.length,
      keys: Object.keys(body)
    });
  } catch (error) {
    console.error("[documents][POST] Failed to parse JSON", error);
    return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  const parsed = documentSchema.safeParse(body);

  if (!parsed.success) {
    console.warn("[documents][POST] validation failed", {
      errors: parsed.error.flatten(),
      receivedData: {
        title: body.title,
        contentLength: body.content?.length,
        hasWritingStyle: !!body.writingStyle
      }
    });
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  let createData: any = null;
  try {
    const isStylePayload =
      Boolean(parsed.data.writingStyle) || Boolean(parsed.data.styleTitle) || Boolean(parsed.data.styleSummary);
    let generatedStyleTitle: string | null = null;
    let generatedStyleSummary: string | null = null;

    if (isStylePayload) {
      try {
        const metadata = await generateStyleMetadata({
          writingStyle: parsed.data.writingStyle ?? null,
          content: parsed.data.content ?? "",
          styleTitle: parsed.data.styleTitle ?? null,
          styleSummary: parsed.data.styleSummary ?? null,
          fallbackTitle: parsed.data.title
        });
        generatedStyleTitle = metadata.styleTitle;
        generatedStyleSummary = metadata.styleSummary;
      } catch (error) {
        console.error("[documents][POST] style metadata generation failed", error);
      }
    }

    const resolvedStyleTitle = generatedStyleTitle ?? parsed.data.styleTitle ?? null;
    const resolvedStyleSummary = generatedStyleSummary ?? parsed.data.styleSummary ?? null;

    const rawStyleTitleValue =
      resolvedStyleTitle !== null && resolvedStyleTitle !== undefined
        ? stripMarkdownFromTitle(resolvedStyleTitle).trim().slice(0, 100)
        : null;
    const styleTitleValue = rawStyleTitleValue && rawStyleTitleValue.trim().length > 0 ? rawStyleTitleValue : null;
    // For styles, prefer the generated title, then the sent title, then derive from content
    const autoTitle = styleTitleValue
      ? styleTitleValue
      : parsed.data.title && parsed.data.title.trim()
      ? parsed.data.title.trim()
      : deriveTitleFromContent(parsed.data.content, parsed.data.title);

    // Ensure title is never empty (shouldn't happen, but safety check)
    if (!autoTitle || autoTitle.trim().length === 0) {
      console.error("[documents][POST] Generated empty title", {
        content: parsed.data.content?.substring(0, 100),
        contentLength: parsed.data.content?.length,
        originalTitle: parsed.data.title,
        styleTitle: parsed.data.styleTitle,
        isStylePayload,
        generatedStyleTitle,
        styleTitleValue,
        resolvedStyleTitle
      });
      return NextResponse.json(
        { error: "Unable to generate document title." },
        { status: 400 }
      );
    }

    // Strip markdown formatting from AI-generated titles
    const cleanedTitle = stripMarkdownFromTitle(autoTitle);
    
    // Ensure title doesn't exceed database limit (255 chars)
    const trimmedTitle = cleanedTitle.trim();
    const finalTitle = trimmedTitle.length > 255 ? trimmedTitle.substring(0, 255) : trimmedTitle;

    // Build data object for Prisma
    createData = {
      title: finalTitle,
      content: parsed.data.content || "",
      ownerId: session.user.id
    };

    // Add optional fields (Prisma accepts null for nullable fields)
    if (parsed.data.tone !== undefined && parsed.data.tone !== null) createData.tone = parsed.data.tone;
    if (parsed.data.prompt !== undefined && parsed.data.prompt !== null) createData.prompt = parsed.data.prompt;
    if (parsed.data.characterLength !== undefined && parsed.data.characterLength !== null) createData.characterLength = parsed.data.characterLength;
    if (parsed.data.wordLength !== undefined && parsed.data.wordLength !== null) createData.wordLength = parsed.data.wordLength;
    if (parsed.data.gradeLevel !== undefined && parsed.data.gradeLevel !== null) createData.gradeLevel = parsed.data.gradeLevel;
    if (parsed.data.benchmark !== undefined && parsed.data.benchmark !== null) createData.benchmark = parsed.data.benchmark;
    if (parsed.data.avoidWords !== undefined && parsed.data.avoidWords !== null) createData.avoidWords = parsed.data.avoidWords;
    if (parsed.data.writingStyle !== undefined && parsed.data.writingStyle !== null) {
      createData.writingStyle = parsed.data.writingStyle;
    }
    if (resolvedStyleSummary !== undefined && resolvedStyleSummary !== null) {
      createData.styleSummary = resolvedStyleSummary;
    }
    if (styleTitleValue !== null) {
      createData.styleTitle = styleTitleValue;
    }
    if (parsed.data.pinned !== undefined) createData.pinned = parsed.data.pinned;

    // Verify user exists before creating document
    const userExists = await db.user.findUnique({
      where: { id: session.user.id },
      select: { id: true }
    });
    
    if (!userExists) {
      console.error("[documents][POST] User not found in database", {
        userId: session.user.id,
        userEmail: session.user.email
      });
      return NextResponse.json(
        { error: "User account not found. Please sign in again." },
        { status: 404 }
      );
    }

    console.log("[documents][POST] Attempting to create document", {
      titleLength: createData.title.length,
      contentLength: createData.content.length,
      hasTone: !!createData.tone,
      hasPrompt: !!createData.prompt,
      hasWritingStyle: !!createData.writingStyle,
      pinned: createData.pinned,
      userId: session.user.id,
      allKeys: Object.keys(createData)
    });

    const doc = await db.document.create({
      data: createData
    });

    console.log("[documents][POST] Successfully saved document:", {
      id: doc.id,
      title: doc.title,
      hasStyleTitle: !!doc.styleTitle,
      hasWritingStyle: !!doc.writingStyle
    });

    return NextResponse.json(doc);
  } catch (error) {
    // Handle Prisma-specific errors
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // P2002 = Unique constraint violation
      if (error.code === "P2002") {
        console.error("[documents][POST] Unique constraint violation", error.meta);
        return NextResponse.json(
          { error: "A document with this identifier already exists." },
          { status: 409 }
        );
      }
      // P2003 = Foreign key constraint violation
      if (error.code === "P2003") {
        console.error("[documents][POST] Foreign key constraint violation", {
          code: error.code,
          meta: error.meta,
          message: error.message,
          userId: session.user.id
        });
        return NextResponse.json(
          { error: "Database constraint violation. Please ensure your account is properly set up.", details: error.message },
          { status: 500 }
        );
      }
      // Other Prisma errors
      console.error("[documents][POST] Prisma error", {
        code: error.code,
        meta: error.meta,
        message: error.message,
        userId: session.user.id,
        createDataKeys: Object.keys(createData || {})
      });
      return NextResponse.json(
        { error: "Database error occurred.", details: error.message },
        { status: 500 }
      );
    }

    // Handle Prisma connection errors
    if (error instanceof Prisma.PrismaClientInitializationError) {
      console.error("[documents][POST] Prisma initialization error", error.message);
      return NextResponse.json(
        { error: "Database connection failed. Please try again." },
        { status: 503 }
      );
    }

    // Handle other errors
    console.error("[documents][POST] failed", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    // Check if it's a database migration issue
    const isMigrationError = errorMessage.includes("Unknown column") || 
                             (errorMessage.includes("Table") && errorMessage.includes("doesn't exist")) ||
                             (errorMessage.includes("relation") && errorMessage.includes("does not exist"));
    
    try {
      console.error("[documents][POST] error details:", {
        message: errorMessage,
        stack: errorStack,
        isMigrationError,
        title: parsed.data?.title,
        styleTitle: parsed.data?.styleTitle,
        contentLength: parsed.data?.content?.length,
        hasWritingStyle: !!parsed.data?.writingStyle,
        writingStyleLength: parsed.data?.writingStyle?.length,
        userId: session.user.id
      });
    } catch (logError) {
      console.error("[documents][POST] Failed to log error details", logError);
    }
    
    // Always return a valid JSON error response
    try {
      const errorResponse = isMigrationError
        ? { 
            error: "Database schema is out of date. Please run database migrations.", 
            details: errorMessage,
            requiresMigration: true
          }
        : { 
            error: "Unable to save document.", 
            details: errorMessage 
          };
      
      return NextResponse.json(errorResponse, { status: 500 });
    } catch (responseError) {
      // Fallback if even the response creation fails
      console.error("[documents][POST] Failed to create error response", responseError);
      return new NextResponse(
        JSON.stringify({ error: "Unable to save document.", details: "Internal server error" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }
}

