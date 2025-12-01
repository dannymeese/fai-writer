import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { composeRequestSchema } from "@/lib/validators";
import { prisma } from "@/lib/prisma";
import { smartTitleFromPrompt } from "@/lib/utils";
import { getOpenAIClient } from "@/lib/openai";

const TOKEN_LIMIT = Number(process.env.LLM_TOKEN_LIMIT ?? "500000");
type CookieStore = Awaited<ReturnType<typeof cookies>>;
type UsageIdentifier = { userId: string } | { guestId: string };
type UsageContext = { identifier: UsageIdentifier; guestCookie?: string };

const SHORT_RULES =
  "RULES: No em/en dashes, AI clichés, or repeated lines. Every word must earn its place and feel bespoke + human. Missing info stays in [brackets]; never ask follow-ups. Skip emojis unless requested. Vary pacing to avoid tidy triads or recap paragraphs. Favor sensory detail over filler.";
const EXTENDED_RULES = `VITAL RULES FOR ALL OUTPUT:

1. DO NOT USE EM DASHES OR EN DASHES.
2. DO NOT WRITE WITH ANY AI WRITING TELLS OR RED FLAGS, ESPECIALLY NOT "NOT _, but _"-esque phrasing.
3. DO NOT REPEAT SOMETHING THAT MEANS ESSENTIALLY THE SAME THING BUT IN DIFFERENT WORDS. 
4. MAKE SURE THAT EVERY WORD SERVES A PURPOSE AND BRINGS ADDITIONAL MEANING OR DON'T USE IT AT ALL.
5. ONLY PROVIDE TEXT THAT FEELS BESPOKE AND HUMAN.
6. All missing info should be formatted in [] like [brand name], etc. Don't guess product name, service name, business name etc.
7. DO NOT use emojis unless the user EXPLICITLY asks you to.
8. NEVER ask the user for more information—provide the best possible answer immediately.
9. Keep tone sharply specific; inject real-world detail and asymmetric sentence lengths.
10. Avoid recap paragraphs, tidy triads, or BuzzFeed-style bullets.`;

function buildSystemPrompt(brandInfo: string | null, useExtendedRules: boolean): string {
  const base = useExtendedRules ? EXTENDED_RULES : SHORT_RULES;
  if (!brandInfo) {
    return base;
  }
  return `${base}\n\nBRAND GUIDELINES:\n${brandInfo}\n\nAlways follow the brand guidance above.`;
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

  const { prompt, settings, brandSummary, styleGuide, editorContext } = parsed.data;
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
    const guestBrandValue = cookieStore.get("guest_brand_info")?.value ?? null;
    if (guestBrandValue) {
      try {
        const parsed = JSON.parse(guestBrandValue);
        brandInfo = typeof parsed === "string" ? parsed : parsed?.brandInfo ?? null;
      } catch {
        brandInfo = guestBrandValue;
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

  const instructionSection = `\n\nExecution Requirements:\n- Do not ask the user for more details.\n- Produce the final copy immediately.\n- If specific details are missing, infer them from the brand summary and the prompt.\n- When editor context is provided, start precisely after the "before" text and transition into the "after" text without repeating either.\n- Never return placeholder instructions to the user.\n- Output ONLY in markdown format. Use markdown syntax for headings (# for H1, ## for H2, ### for H3), bold (**text**), italic (*text*), lists (- or 1.), etc.\n`;
  const userPrompt = `${prompt}${editorContextSection}${brandSection}${styleSection}${instructionSection}${briefSection}`;
  const wantsExtendedRules = /(?:long|full|detailed|extended)\s+rules?/i.test(prompt);

  try {
    const systemPrompt = buildSystemPrompt(brandInfo, wantsExtendedRules);

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
    let styleTokens = 0;
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
      styleTokens = styleResponse.usage?.total_tokens ?? 0;

      // Generate a 2-4 word title for the style
      if (writingStyle) {
        try {
          const titleResponse = await openai.responses.create({
            model: "gpt-5.1",
            temperature: 0.7,
            max_output_tokens: 20,
            input: [
              {
                role: "system",
                content:
                  "Generate a concise 2-4 word title that captures the essence of this writing style. Return only the title, no explanation."
              },
              {
                role: "user",
                content: `Writing style: ${writingStyle}\n\nGenerate a 2-4 word title:`
              }
            ]
          });
          styleTitle = titleResponse.output_text?.trim() ?? null;
          // Clean up the title - remove quotes, periods, etc.
          if (styleTitle) {
            styleTitle = styleTitle.replace(/^["']|["']$/g, "").replace(/\.$/, "").trim();
            // Ensure it's 2-4 words
            const words = styleTitle.split(/\s+/).filter(Boolean);
            if (words.length > 4) {
              styleTitle = words.slice(0, 4).join(" ");
            } else if (words.length < 2 && words.length > 0) {
              // If only one word, try to make it 2 words
              styleTitle = words[0] + " Style";
            }
          }
        } catch (err) {
          console.error("OpenAI style title generation failed", err);
          // Non-blocking: continue without style title
        }
      }
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
    }

    const totalTokensUsed = contentTokens + styleTokens;

    const jsonResponse = NextResponse.json({
      documentId,
      title,
      content: contentText,
      writingStyle,
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

