import type OpenAI from "openai";
import { getOpenAIClient } from "./openai";
import { stripMarkdownFromTitle } from "./utils";

export type StyleMetadataInput = {
  writingStyle?: string | null;
  content?: string | null;
  styleTitle?: string | null;
  styleSummary?: string | null;
};

export type StyleMetadataResult = {
  styleTitle: string | null;
  styleSummary: string | null;
  tokensUsed: number;
};

function sanitizeStyleTitle(rawTitle: string | null | undefined): string | null {
  if (!rawTitle) return null;
  let clean = stripMarkdownFromTitle(rawTitle)
    .replace(/^["']|["']$/g, "")
    .replace(/\.$/, "")
    .trim();
  if (!clean) return null;
  const words = clean.split(/\s+/).filter(Boolean);
  // For generated titles in "[adjective] [adjective] [noun]" format, preserve exactly 3 words
  // If it's already 3 words, keep it as-is
  if (words.length === 3) {
    return words.join(" ");
  }
  // If more than 3 words, take first 3
  if (words.length > 3) {
    return words.slice(0, 3).join(" ");
  }
  // If less than 3 words, don't modify (let LLM handle it)
  return clean;
}

function sanitizeStyleSummary(rawSummary: string | null | undefined): string | null {
  if (!rawSummary) return null;
  const normalized = rawSummary.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length > 200 ? normalized.slice(0, 200) : normalized;
}

function resolveOpenAIClient(explicitClient?: OpenAI | null): OpenAI | null {
  if (explicitClient !== undefined) return explicitClient;
  try {
    return getOpenAIClient();
  } catch (error) {
    console.warn("[style-metadata] OpenAI unavailable, skipping AI style metadata generation.", error);
    return null;
  }
}

export async function generateStyleMetadata(
  input: StyleMetadataInput,
  options: { openai?: OpenAI | null } = {}
): Promise<StyleMetadataResult> {
  const openai = resolveOpenAIClient(options.openai);
  let tokensUsed = 0;
  let styleTitle = sanitizeStyleTitle(input.styleTitle);
  let styleSummary = sanitizeStyleSummary(input.styleSummary);
  const descriptor = (input.writingStyle ?? input.content ?? "")?.trim();

  if (openai && descriptor) {
    if (!styleTitle || !styleSummary) {
      try {
        const response = await openai.responses.create({
          model: "gpt-5.1",
          temperature: 0.5,
          max_output_tokens: 200,
          response_format: { type: "json_object" },
          input: [
            {
              role: "system",
              content: `You are a writing style analyst. Analyze the given writing style and return a JSON object with exactly these fields:
- "title": A title in the format "[adjective] [adjective] [noun]" that perfectly describes the writing STYLE. Examples: "Professional Concise Tone", "Casual Conversational Voice", "Formal Academic Prose", "Warm Friendly Approach", "Technical Precise Language". Use exactly 3 words: two adjectives followed by one noun that describes the style. No punctuation, no quotes, no "Style" suffix, just the three words.
- "summary": A summary of the style in <=200 characters, plain text, no markdown or quotes. Mention tone, cadence, vocabulary, and pacing if possible.

Return ONLY valid JSON, no other text.`
            },
            {
              role: "user",
              content: `Analyze this writing style:\n\n${descriptor}\n\nReturn JSON with "title" and "summary" fields.`
            }
          ]
        });
        tokensUsed += response.usage?.total_tokens ?? 0;
        
        try {
          const jsonText = response.output_text?.trim() ?? null;
          if (jsonText) {
            const parsed = JSON.parse(jsonText);
            if (!styleTitle && parsed.title) {
              styleTitle = sanitizeStyleTitle(parsed.title);
            }
            if (!styleSummary && parsed.summary) {
              styleSummary = sanitizeStyleSummary(parsed.summary);
            }
          }
        } catch (parseError) {
          console.error("[style-metadata] Failed to parse JSON response", parseError, response.output_text);
        }
      } catch (error) {
        console.error("[style-metadata] Failed to generate style metadata", error);
      }
    }
  }

  return {
    styleTitle: styleTitle ?? null,
    styleSummary: styleSummary ?? null,
    tokensUsed
  };
}

