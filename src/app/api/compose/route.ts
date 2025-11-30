import { NextResponse } from "next/server";
import OpenAI from "openai";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { composeRequestSchema } from "@/lib/validators";
import { prisma } from "@/lib/prisma";
import { smartTitleFromPrompt } from "@/lib/utils";

function buildSystemPrompt(): string {
  return `VITAL RULES FOR ALL OUTPUT:

1. DO NOT USE EM DASHES OR EN DASHES.
2. DO NOT WRITE WITH ANY AI WRITING TELLS OR RED FLAGS.
3. DO NOT REPEAT SOMETHING THAT MEANS ESSENTIALLY THE SAME THING BUT IN DIFFERENT WORDS. 
4. MAKE SURE THAT EVERY WORD SERVES A PURPOSE AND BRINGS ADDITIONAL MEANING OR DON'T USE IT AT ALL.
5. ONLY PROVIDE TEXT THAT FEELS BESPOKE AND HUMAN.
6. If brand information is provided in the user's prompt, use it directly. DO NOT ask the user for brand details, names, products, services, or other information that has already been provided in the brand context.
7. Only use placeholders [like this] for information that is truly missing and not mentioned anywhere in the brand context or user's request.
8. DO NOT use emojis unless the user EXPLICITLY asks you to.`;
}

export async function POST(request: Request) {
  const session = await auth();
  const isAuthenticated = Boolean(session?.user?.id);
  const enforceGuestLimit = process.env.ENFORCE_GUEST_LIMIT === "true";
  const cookieStore = await cookies(); // Always get cookies for brand info access
  const guestCounter = Number(cookieStore?.get("guest_outputs")?.value ?? "0");
  if (enforceGuestLimit && !isAuthenticated && guestCounter >= 5) {
    return NextResponse.json(
      { error: "Guest limit reached", requireAuth: true },
      { status: 403 }
    );
  }

  const json = await request.json().catch(() => null);
  const parsed = composeRequestSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { prompt, settings } = parsed.data;
  const effectiveMarketTier = settings.marketTier ?? null;

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY missing" }, { status: 500 });
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Fetch brand info from database or cookie
  let brandInfo: string | null = null;
  if (isAuthenticated && session?.user?.id && prisma) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: session.user.id }
      }) as any;
      brandInfo = user?.brandInfo ?? null;
    } catch (error) {
      console.error("Failed to fetch brand info from database", error);
    }
  }
  
  // Fall back to cookie for guests or if DB lookup failed
  if (!brandInfo) {
    brandInfo = cookieStore?.get("guest_brand_info")?.value ?? null;
  }

  const directiveLines = [
    effectiveMarketTier ? `Target market: ${effectiveMarketTier}.` : null,
    settings.gradeLevel ? `Write at approximately a ${settings.gradeLevel} reading level.` : null,
    settings.benchmark ? `Mirror the tone and polish of ${settings.benchmark}.` : null,
    settings.characterLength
      ? `Keep the entire response within ${settings.characterLength} characters. If it exceeds this limit, revise until it fits.`
      : null,
    settings.wordLength
      ? `Aim for roughly ${settings.wordLength} words. Shorten or expand as needed to stay near that count.`
      : null,
    settings.avoidWords
      ? `Do not use any of these words or close variants: ${settings.avoidWords}. If they are unavoidable, replace them with luxury synonyms.`
      : null
  ].filter(Boolean);

  const briefSection = directiveLines.length ? `\n\nBrief:\n- ${directiveLines.join("\n- ")}` : "";
  
  // Append brand info to user prompt if available
  const brandSection = brandInfo ? `\n\nIMPORTANT: The following brand information has already been defined. Use this information directly - DO NOT ask the user for brand details, names, or other information that is already provided below:\n\nBrand Context:\n${brandInfo}\n\nUse the brand guidelines, vocabulary, tone, style preferences, and all details above when writing. If brand name, products, services, or other details are mentioned in the brand context, use them directly without asking the user.` : "";
  const userPrompt = `${prompt}${briefSection}${brandSection}`;

  try {
    const systemPrompt = buildSystemPrompt(); // Brand info is now in user prompt
    
    // Generate the main content
    const contentResponse = await openai.responses.create({
      model: "gpt-5.1",
      temperature: 0.62,
      max_output_tokens: 900,
      input: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: userPrompt
        }
      ]
    });

    const content = contentResponse.output_text?.trim();

    if (!content) {
      return NextResponse.json({ error: "No content returned" }, { status: 502 });
    }

    // Generate writing style description
    const styleResponse = await openai.responses.create({
      model: "gpt-5.1",
      temperature: 0.4,
      max_output_tokens: 200,
      input: [
        {
          role: "system",
          content: "You are a writing analyst. Describe the writing style of the given text in 2-3 sentences. Focus on tone, voice, structure, vocabulary choices, and any distinctive characteristics."
        },
        {
          role: "user",
          content: `Analyze and describe the writing style of this text:\n\n${content}`
        }
      ]
    });

    const writingStyle = styleResponse.output_text?.trim() || null;

    const title = smartTitleFromPrompt(prompt);
    let documentId: string | null = null;
    let timestamp = new Date().toISOString();

    if (isAuthenticated && session?.user?.id && prisma) {
      const document = await prisma.document.create({
        data: {
          title,
          content,
          tone: effectiveMarketTier ?? undefined,
          prompt,
          characterLength: settings.characterLength ?? undefined,
          wordLength: settings.wordLength ?? undefined,
          gradeLevel: settings.gradeLevel ?? undefined,
          benchmark: settings.benchmark ?? undefined,
          avoidWords: settings.avoidWords ?? undefined,
          writingStyle: writingStyle ?? undefined,
          ownerId: session.user.id
        } as any // local Prisma typings omit prompt/meta fields, so cast until schema is regenerated upstream
      });
      documentId = document.id;
      timestamp = document.createdAt.toISOString();
    }

    const jsonResponse = NextResponse.json({
      documentId,
      title,
      content,
      writingStyle,
      createdAt: timestamp,
      prompt,
      settings: {
        ...settings,
        marketTier: settings.marketTier ?? null
      }
    });

    if (enforceGuestLimit && !isAuthenticated && cookieStore) {
      jsonResponse.cookies.set("guest_outputs", String(guestCounter + 1), {
        maxAge: 60 * 60 * 24,
        path: "/"
      });
    }

    return jsonResponse;
  } catch (error) {
    console.error("compose error", error);
    return NextResponse.json({ error: "Generation failed" }, { status: 500 });
  }
}

