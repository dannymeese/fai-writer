import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { composeRequestSchema } from "@/lib/validators";
import { prisma } from "@/lib/prisma";
import { smartTitleFromPrompt } from "@/lib/utils";
import { getOpenAIClient } from "@/lib/openai";
import { generateStyleMetadata } from "@/lib/style-metadata";

const TOKEN_LIMIT = Number(process.env.LLM_TOKEN_LIMIT ?? "500000");
type CookieStore = Awaited<ReturnType<typeof cookies>>;
type UsageIdentifier = { userId: string } | { guestId: string };
type UsageContext = { identifier: UsageIdentifier; guestCookie?: string };

const SHORT_RULES =
  "RULES: No em/en dashes, AI clichés, or repeated lines. Every word must earn its place and feel bespoke + human. Missing info stays in [brackets]; never ask follow-ups. Skip emojis unless requested. Vary pacing to avoid tidy triads or recap paragraphs. Never use 'X instead of Y' phrasing patterns. Vary list lengths—avoid always defaulting to exactly 3 bullet points. Favor sensory detail over filler.";
const EXTENDED_RULES = `VITAL RULES FOR ALL OUTPUT:

1. DO NOT USE EM DASHES OR EN DASHES.
2. DO NOT WRITE WITH ANY AI WRITING TELLS OR RED FLAGS, ESPECIALLY NOT "NOT _, but _"-esque phrasing OR "X instead of Y" patterns (e.g., "Clicking instead of crafting", "Supervising instead of doing", "Approving instead of owning").
3. DO NOT REPEAT SOMETHING THAT MEANS ESSENTIALLY THE SAME THING BUT IN DIFFERENT WORDS. 
4. MAKE SURE THAT EVERY WORD SERVES A PURPOSE AND BRINGS ADDITIONAL MEANING OR DON'T USE IT AT ALL.
5. ONLY PROVIDE TEXT THAT FEELS BESPOKE AND HUMAN.
6. All missing info should be formatted in [] like [persona name], etc. Don't guess product name, service name, business name etc.
7. DO NOT use emojis unless the user EXPLICITLY asks you to.
8. NEVER ask the user for more information—provide the best possible answer immediately.
9. Keep tone sharply specific; inject real-world detail and asymmetric sentence lengths.
10. Avoid recap paragraphs, tidy triads, or BuzzFeed-style bullets. Vary list lengths—never default to exactly 3 bullet points. Use 2, 4, 5, or other counts naturally based on content needs.`;

function buildSystemPrompt(personaInfo: string | null, useExtendedRules: boolean): string {
  const base = useExtendedRules ? EXTENDED_RULES : SHORT_RULES;
  if (!personaInfo) {
    return base;
  }
  return `${base}\n\nPERSONA GUIDELINES:\n${personaInfo}\n\nAlways follow the persona guidance above.`;
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

  const { prompt, settings, personaSummary, styleGuide, editorContext } = parsed.data;
  const effectiveMarketTier = settings.marketTier ?? null;

  let openai;
  try {
    openai = getOpenAIClient();
  } catch (error) {
    console.error("compose openai init failed", error);
    return NextResponse.json({ error: "OPENAI_API_KEY missing" }, { status: 500 });
  }

  let usageContext: UsageContext | null = null;
  if (prisma && TOKEN_LIMIT > 0) {
    try {
      usageContext = resolveUsageContext(session, cookieStore);
      if (usageContext) {
        const existingUsage = await findTokenUsage(usageContext.identifier);
        const consumed = existingUsage?.tokens ?? 0;
        if (consumed >= TOKEN_LIMIT) {
          const limitResponse = NextResponse.json(
            { error: "Token allowance reached. Please upgrade to continue.", requireUpgrade: true },
            { status: 403 }
          );
          attachGuestUsageCookie(limitResponse, usageContext);
          return limitResponse;
        }
      }
    } catch (error) {
      usageContext = null;
      console.error("token usage check failed", error);
    }
  }

  // Fetch persona info from database or cookie
  let personaInfo: string | null = personaSummary?.trim() || null;
  if (!personaInfo && isAuthenticated && session?.user?.id && prisma) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: session.user.id }
      }) as any;
      personaInfo = user?.personaInfo ?? null;
    } catch (error) {
      console.error("Failed to fetch persona info from database", error);
    }
  }
  
  // Fall back to cookie for guests or if DB lookup failed
  if (!personaInfo) {
    const guestPersonaValue = cookieStore.get("guest_persona_info")?.value ?? null;
    if (guestPersonaValue) {
      try {
        const parsed = JSON.parse(guestPersonaValue);
        personaInfo = typeof parsed === "string" ? parsed : parsed?.personaInfo ?? null;
      } catch {
        personaInfo = guestPersonaValue;
      }
    }
  }

  const wantsLongForm = /\b(long|longer|lengthy|detailed|essay|story|paragraphs?|pages?|novella|novel)\b/i.test(prompt);
  const conciseDirective =
    !wantsLongForm && !settings.wordLength && !settings.characterLength
      ? "Keep the full response under ~180 words (roughly 12 lines) unless the user explicitly demands more length."
      : null;

  const directiveLines = [
    conciseDirective,
    effectiveMarketTier ? `Target market: ${effectiveMarketTier}.` : null,
    settings.gradeLevel 
      ? settings.gradeLevel === "ESL (English as Second Language)"
        ? `Write for ESL (English as a Second Language) readers: Use literal, direct language. Avoid colloquialisms, idioms, slang, and figurative expressions. Prefer straightforward, concrete words over abstract or metaphorical language. Use clear, simple sentence structures.`
        : `Write at approximately a ${settings.gradeLevel} reading level.`
      : null,
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
  const personaSection = personaInfo
    ? `\n\nPersona Summary (follow this precisely):\n${personaInfo}\n\nUse the persona summary above to fill in any missing context, voice, or positioning.`
    : "";
  const styleSection = styleGuide
    ? `\n\nWriting Style (${styleGuide.name}):\n${styleGuide.description}\n\nMirror the cadence, vocabulary, and structure of the style described above in every sentence.`
    : "";
  const editorContextLines: string[] = [];
  if (editorContext?.before) {
    editorContextLines.push(`Text before cursor:\n${editorContext.before}`);
  }
  if (editorContext?.selection) {
    editorContextLines.push(`Selected text (if any):\n${editorContext.selection}`);
  }
  if (editorContext?.after) {
    editorContextLines.push(`Text after cursor:\n${editorContext.after}`);
  }
  const editorContextSection = editorContextLines.length
    ? `\n\nEditor Cursor Context:\n${editorContextLines.join("\n\n")}\n\nUse this context to understand what surrounds the cursor so that instructions like "fill in the blank" or "finish the sentence" align with the existing copy. Continue directly after the "before" text without repeating or paraphrasing it, and flow cleanly into the "after" text if it exists. Only produce the missing connective copy.`
    : "";

  const instructionSection = `\n\nExecution Requirements:\n- Do not ask the user for more details.\n- Produce the final copy immediately.\n- If specific details are missing, infer them from the persona summary and the prompt.\n- When editor context is provided, start precisely after the "before" text and transition into the "after" text without repeating either.\n- Never return placeholder instructions to the user.\n- Output ONLY in markdown format. Use markdown syntax for headings (# for H1, ## for H2, ### for H3), bold (**text**), italic (*text*), lists (- or 1.), etc.\n`;
  const userPrompt = `${prompt}${editorContextSection}${personaSection}${styleSection}${instructionSection}${briefSection}`;
  const wantsExtendedRules = /(?:long|full|detailed|extended)\s+rules?/i.test(prompt);

  try {
    const systemPrompt = buildSystemPrompt(personaInfo, wantsExtendedRules);

    let contentText: string | null = null;
    let contentTokens = 0;
    const maxOutputTokens = conciseDirective ? 600 : 900;
    try {
      const contentResponse = await openai.responses.create({
        model: "gpt-5.1",
        temperature: 0.62,
        max_output_tokens: maxOutputTokens,
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
      contentTokens = contentResponse.usage?.total_tokens ?? 0;
    } catch (err) {
      console.error("OpenAI content generation failed", err);
      return NextResponse.json({ error: "Unable to generate draft content." }, { status: 502 });
    }

    if (!contentText) {
      return NextResponse.json({ error: "The writing model returned an empty response." }, { status: 502 });
    }

    let writingStyle: string | null = null;
    let styleTitle: string | null = null;
    let styleSummary: string | null = null;
    let styleTokens = 0;
    try {
      const styleResponse = await openai.responses.create({
        model: "gpt-5.1",
        temperature: 0.4,
        max_output_tokens: 200,
        response_format: { type: "json_object" },
        input: [
          {
            role: "system",
            content: `You are a writing analyst. Analyze the writing style of the given text and return a JSON object with exactly this field:
- "description": A 2-3 sentence description of the writing style focusing on tone, voice, structure, vocabulary choices, and any distinctive characteristics.

Return ONLY valid JSON with the "description" field, no other text.`
          },
          {
            role: "user",
            content: `Analyze the writing style of this text:\n\n${contentText}\n\nReturn JSON with "description" field.`
          }
        ]
      });
      
      try {
        const jsonText = styleResponse.output_text?.trim() ?? null;
        if (jsonText) {
          const parsed = JSON.parse(jsonText);
          writingStyle = parsed.description?.trim() ?? null;
        }
      } catch (parseError) {
        console.error("OpenAI style generation JSON parse failed", parseError, styleResponse.output_text);
        // Fallback to raw text if JSON parsing fails
        writingStyle = styleResponse.output_text?.trim() ?? null;
      }
      styleTokens = styleResponse.usage?.total_tokens ?? 0;
    } catch (err) {
      console.error("OpenAI style generation failed", err);
      // Non-blocking: continue without style metadata
    }

    try {
      const generatedMetadata = await generateStyleMetadata(
        {
          writingStyle,
          content: contentText,
          styleTitle,
          styleSummary
        },
        { openai }
      );
      styleTitle = generatedMetadata.styleTitle;
      styleSummary = generatedMetadata.styleSummary;
      styleTokens += generatedMetadata.tokensUsed;
    } catch (err) {
      console.error("Style metadata generation failed", err);
    }

    const title = smartTitleFromPrompt(prompt);
    let documentId: string | null = null;
    let timestamp = new Date().toISOString();

    // Check if we should update an existing document instead of creating a new one
    const existingDocumentId = (editorContext as any)?.documentId;

    // If there's an existing documentId, don't create/update here - let client handle saving via autosave
    // This prevents creating duplicate documents when AI writes to an untitled doc
    if (!existingDocumentId && isAuthenticated && session?.user?.id && prisma) {
      try {
        // Create new document only if no existing documentId was provided
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
            styleSummary: styleSummary ?? undefined,
            styleTitle: styleTitle ?? undefined,
            ownerId: session.user.id
          } as any
        });
        documentId = document.id;
        timestamp = document.createdAt.toISOString();
        console.log("[compose] Document saved:", documentId, "title:", title);
      } catch (err) {
        console.error("[compose] Failed to persist composed document", err);
        // Log more details about the error
        if (err instanceof Error) {
          console.error("[compose] Error message:", err.message);
          console.error("[compose] Error stack:", err.stack);
        }
      }
    } else if (existingDocumentId) {
      // Return the existing documentId so client knows which document to update
      documentId = existingDocumentId;
      console.log("[compose] Using existing document (content will be saved via autosave):", documentId);
    }

    const totalTokensUsed = contentTokens + styleTokens;

    const jsonResponse = NextResponse.json({
      documentId,
      title,
      content: contentText,
      writingStyle,
      styleSummary,
      styleTitle,
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
    if (usageContext?.guestCookie) {
      jsonResponse.cookies.set("guest_usage_id", usageContext.guestCookie, {
        maxAge: 60 * 60 * 24 * 30,
        path: "/"
      });
    }
    if (prisma && usageContext && totalTokensUsed > 0) {
      try {
        await incrementTokenUsage(usageContext.identifier, totalTokensUsed);
      } catch (error) {
        console.error("token usage increment failed", error);
      }
    }

    return jsonResponse;
  } catch (error) {
    console.error("compose error", error);
    return NextResponse.json({ error: "Generation failed" }, { status: 500 });
  }
}

function resolveUsageContext(session: any, cookieStore: CookieStore): UsageContext | null {
  if (session?.user?.id) {
    return { identifier: { userId: session.user.id } };
  }
  let guestId = cookieStore.get("guest_usage_id")?.value;
  let guestCookie: string | undefined;
  if (!guestId) {
    guestId = crypto.randomUUID();
    guestCookie = guestId;
  }
  return { identifier: { guestId }, guestCookie };
}

async function findTokenUsage(identifier: UsageIdentifier) {
  if (!prisma) return null;
  if ("userId" in identifier) {
    return prisma.tokenUsage.findUnique({ where: { userId: identifier.userId } });
  }
  return prisma.tokenUsage.findUnique({ where: { guestId: identifier.guestId } });
}

async function incrementTokenUsage(identifier: UsageIdentifier, amount: number) {
  if (!prisma || amount <= 0) return;
  if ("userId" in identifier) {
    await prisma.tokenUsage.upsert({
      where: { userId: identifier.userId },
      update: { tokens: { increment: amount } },
      create: { userId: identifier.userId, tokens: amount }
    });
    return;
  }
  await prisma.tokenUsage.upsert({
    where: { guestId: identifier.guestId },
    update: { tokens: { increment: amount } },
    create: { guestId: identifier.guestId, tokens: amount }
  });
}

function attachGuestUsageCookie(response: NextResponse, context?: UsageContext | null) {
  if (!context?.guestCookie) return;
  response.cookies.set("guest_usage_id", context.guestCookie, {
    maxAge: 60 * 60 * 24 * 30,
    path: "/"
  });
}

