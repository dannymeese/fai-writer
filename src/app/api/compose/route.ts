import { NextResponse } from "next/server";
import OpenAI from "openai";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { composeRequestSchema } from "@/lib/validators";
import { prisma } from "@/lib/prisma";
import { smartTitleFromPrompt } from "@/lib/utils";

function buildSystemPrompt(brandInfo: string | null): string {
  let prompt = `VITAL RULES FOR ALL OUTPUT:

1. DO NOT USE EM DASHES OR EN DASHES.
2. DO NOT WRITE WITH ANY AI WRITING TELLS OR RED FLAGS.
3. DO NOT REPEAT SOMETHING THAT MEANS ESSENTIALLY THE SAME THING BUT IN DIFFERENT WORDS. 
4. MAKE SURE THAT EVERY WORD SERVES A PURPOSE AND BRINGS ADDITIONAL MEANING OR DON'T USE IT AT ALL.
5. ONLY PROVIDE TEXT THAT FEELS BESPOKE AND HUMAN.
6. All missing info should be formatted in [] like [brand name], etc. Don't guess product name, service name, business name etc.
7. DO NOT use emojis unless the user EXPLICITLY asks you to.
8. NEVER ask the user for more information—provide the best possible answer immediately.
9. If a brand summary is provided, prioritize it above all other context and keep tone, vocabulary, and claims aligned with that brand.`;

  prompt += `
AVOID THESE COMMON AI TELLS:
- No neutral, generic, or “robotically tidy” tone; inject specific voice, real-world texture, and asymmetric structures.
- Keep sentence length and structure varied; avoid uniform rhythm that triggers burstiness/perplexity detectors.
- Never default to lists-of-three, rigid BuzzFeed-style bullets, or “not X, not Y, but Z” triads.
- Skip over-explaining or recap paragraphs (“in conclusion,” “it is important to note,” etc.).
- Use slang, local idiom, or unexpected phrasing when appropriate; avoid stock AI sincerity or filler.`;

  if (brandInfo) {
    prompt += `\n\nBRAND GUIDELINES:\n${brandInfo}\n\nAlways follow the brand guidelines above. Use the brand vocabulary, tone, and style preferences when writing.`;
  }

  return prompt;
}

export async function POST(request: Request) {
  const session = await auth();
  const isAuthenticated = Boolean(session?.user?.id);
  const enforceGuestLimit = process.env.ENFORCE_GUEST_LIMIT === "true";
  const cookieStore = await cookies();
  const guestCounter = enforceGuestLimit ? Number(cookieStore.get("guest_outputs")?.value ?? "0") : 0;
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

  const { prompt, settings, brandSummary } = parsed.data;
  const effectiveMarketTier = settings.marketTier ?? null;

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY missing" }, { status: 500 });
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Fetch brand info from database or cookie
  let brandInfo: string | null = brandSummary?.trim() || null;
  if (!brandInfo && isAuthenticated && session?.user?.id && prisma) {
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
    brandInfo = cookieStore.get("guest_brand_info")?.value ?? null;
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
  const brandSection = brandInfo
    ? `\n\nBrand Summary (follow this precisely):\n${brandInfo}\n\nUse the brand summary above to fill in any missing context, voice, or positioning.`
    : "";
  const instructionSection = `\n\nExecution Requirements:\n- Do not ask the user for more details.\n- Produce the final copy immediately.\n- If specific details are missing, infer them from the brand summary and the prompt.\n- Never return placeholder instructions to the user.\n`;
  const userPrompt = `${prompt}${brandSection}${instructionSection}${briefSection}`;

  try {
    const systemPrompt = buildSystemPrompt(brandInfo);

    let contentText: string | null = null;
    try {
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
      contentText = contentResponse.output_text?.trim() ?? null;
    } catch (err) {
      console.error("OpenAI content generation failed", err);
      return NextResponse.json({ error: "Unable to generate draft content." }, { status: 502 });
    }

    if (!contentText) {
      return NextResponse.json({ error: "The writing model returned an empty response." }, { status: 502 });
    }

    let writingStyle: string | null = null;
    try {
      const styleResponse = await openai.responses.create({
        model: "gpt-5.1",
        temperature: 0.4,
        max_output_tokens: 200,
        input: [
          {
            role: "system",
            content:
              "You are a writing analyst. Describe the writing style of the given text in 2-3 sentences. Focus on tone, voice, structure, vocabulary choices, and any distinctive characteristics."
          },
          {
            role: "user",
            content: `Analyze and describe the writing style of this text:\n\n${contentText}`
          }
        ]
      });
      writingStyle = styleResponse.output_text?.trim() ?? null;
    } catch (err) {
      console.error("OpenAI style generation failed", err);
      // Non-blocking: continue without style metadata
    }

    const title = smartTitleFromPrompt(prompt);
    let documentId: string | null = null;
    let timestamp = new Date().toISOString();

    if (isAuthenticated && session?.user?.id && prisma) {
      try {
        const document = await prisma.document.create({
          data: {
            title,
            content: contentText,
            tone: effectiveMarketTier ?? undefined,
            prompt,
            characterLength: settings.characterLength ?? undefined,
            wordLength: settings.wordLength ?? undefined,
            gradeLevel: settings.gradeLevel ?? undefined,
            benchmark: settings.benchmark ?? undefined,
            avoidWords: settings.avoidWords ?? undefined,
            writingStyle: writingStyle ?? undefined,
            ownerId: session.user.id
          } as any
        });
        documentId = document.id;
        timestamp = document.createdAt.toISOString();
      } catch (err) {
        console.error("Failed to persist composed document", err);
      }
    }

    const jsonResponse = NextResponse.json({
      documentId,
      title,
      content: contentText,
      writingStyle,
      createdAt: timestamp,
      prompt,
      settings: {
        ...settings,
        marketTier: settings.marketTier ?? null
      }
    });

    if (enforceGuestLimit && !isAuthenticated) {
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

