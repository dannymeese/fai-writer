import { NextResponse } from "next/server";
import OpenAI from "openai";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { composeRequestSchema } from "@/lib/validators";
import { prisma } from "@/lib/prisma";
import { smartTitleFromPrompt } from "@/lib/utils";

const systemPrompt = `VITAL RULES FOR ALL OUTPUT:

1. DO NOT USE EM DASHES OR EN DASHES.
2. DO NOT WRITE WITH ANY AI WRITING TELLS OR RED FLAGS.

Respond with confident luxury copy that feels bespoke and human.`;

export async function POST(request: Request) {
  const session = await auth();
  const isAuthenticated = Boolean(session?.user?.id);
  const cookieStore = await cookies();
  const guestCounter = Number(cookieStore.get("guest_outputs")?.value ?? "0");
  if (!isAuthenticated && guestCounter >= 5) {
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

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY missing" }, { status: 500 });
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const directiveLines = [
    `Target market: ${settings.marketTier}`,
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

  const userPrompt = `${prompt}\n\nBrief:\n- ${directiveLines.join("\n- ")}`;

  try {
    const response = await openai.responses.create({
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

    const content = response.output_text?.trim();

    if (!content) {
      return NextResponse.json({ error: "No content returned" }, { status: 502 });
    }

    const title = smartTitleFromPrompt(prompt);
    let documentId: string | null = null;
    let timestamp = new Date().toISOString();

    if (isAuthenticated && session?.user?.id && prisma) {
      const document = await prisma.document.create({
        data: {
          title,
          content,
          tone: settings.marketTier,
          ownerId: session.user.id
        }
      });
      documentId = document.id;
      timestamp = document.createdAt.toISOString();
    }

    const jsonResponse = NextResponse.json({
      documentId,
      title,
      content,
      createdAt: timestamp,
      settings
    });

    if (!isAuthenticated) {
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

