import { NextResponse } from "next/server";
import OpenAI from "openai";
import { auth } from "@/auth";
import { z } from "zod";

const rewriteRequestSchema = z.object({
  selectedText: z.string().min(1),
  instruction: z.string().min(1),
  context: z.string().optional(), // Optional: surrounding context for better rewriting
  brandSummary: z.string().optional(),
  styleGuide: z
    .object({
      name: z.string(),
      description: z.string()
    })
    .optional()
});

const SHORT_RULES =
  "RULES: No em/en dashes, AI clichés, or repeated lines. Every word must earn its place and feel bespoke + human. Missing info stays in [brackets]; never ask follow-ups. Skip emojis unless requested. Vary pacing to avoid tidy triads or recap paragraphs. Favor sensory detail over filler.";

export async function POST(request: Request) {
  const session = await auth();
  const isAuthenticated = Boolean(session?.user?.id);

  const json = await request.json().catch(() => null);
  const parsed = rewriteRequestSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { selectedText, instruction, context, brandSummary, styleGuide } = parsed.data;

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY missing" }, { status: 500 });
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Build the rewrite prompt
  const contextSection = context ? `\n\nContext (surrounding text):\n${context}` : "";
  const brandSection = brandSummary
    ? `\n\nBrand Guidelines:\n${brandSummary}\n\nFollow the brand guidance above.`
    : "";
  const styleSection = styleGuide
    ? `\n\nWriting Style (${styleGuide.name}):\n${styleGuide.description}\n\nMirror this style in the rewritten text.`
    : "";

  const systemPrompt = `${SHORT_RULES}\n\nYou are rewriting a selected portion of text based on user instructions. Return ONLY the rewritten text, nothing else. Do not include explanations, quotes, or markdown formatting.`;

  const userPrompt = `Rewrite the following selected text according to this instruction: "${instruction}"\n\nSelected text to rewrite:\n${selectedText}${contextSection}${brandSection}${styleSection}\n\nReturn ONLY the rewritten text that replaces the selected portion.`;

  try {
    const response = await openai.responses.create({
      model: "gpt-5.1",
      temperature: 0.62,
      max_output_tokens: 500,
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

    const rewrittenText = response.output_text?.trim() ?? null;

    if (!rewrittenText) {
      return NextResponse.json({ error: "The model returned an empty response." }, { status: 502 });
    }

    return NextResponse.json({
      rewrittenText
    });
  } catch (error) {
    console.error("rewrite error", error);
    return NextResponse.json({ error: "Rewriting failed" }, { status: 500 });
  }
}

