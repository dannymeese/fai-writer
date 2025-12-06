import type OpenAI from "openai";
import { getOpenAIClient } from "./openai";
import { stripMarkdownFromTitle } from "./utils";

export type StyleMetadataInput = {
  writingStyle?: string | null;
  content?: string | null;
  styleTitle?: string | null;
  styleSummary?: string | null;
  fallbackTitle?: string | null;
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
  if (words.length > 4) {
    clean = words.slice(0, 4).join(" ");
  } else if (words.length === 1) {
    clean = `${words[0]} Style`;
  }
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
    if (!styleTitle) {
      try {
        const titleResponse = await openai.responses.create({
          model: "gpt-5.1",
          temperature: 0.6,
          max_output_tokens: 20,
          input: [
            {
              role: "system",
              content: "Generate a concise 2-4 word title that captures the essence of this writing style. Return only the title, no explanations or punctuation."
            },
            {
              role: "user",
              content: `Writing style description:\n${descriptor}\n\nReturn only the title.`
            }
          ]
        });
        tokensUsed += titleResponse.usage?.total_tokens ?? 0;
        styleTitle = sanitizeStyleTitle(titleResponse.output_text ?? null);
      } catch (error) {
        console.error("[style-metadata] Failed to generate style title", error);
      }
    }

    if (!styleSummary) {
      try {
        const summaryResponse = await openai.responses.create({
          model: "gpt-5.1",
          temperature: 0.35,
          max_output_tokens: 120,
          input: [
            {
              role: "system",
              content:
                "You describe writing styles for other LLMs to mimic. Summarize the style in <=200 characters, plain text, no markdown or quotes. Mention tone, cadence, vocabulary, and pacing if possible."
            },
            {
              role: "user",
              content: `Summarize this writing style so another model can mirror it:\n\n${descriptor}`
            }
          ]
        });
        tokensUsed += summaryResponse.usage?.total_tokens ?? 0;
        styleSummary = sanitizeStyleSummary(summaryResponse.output_text ?? null);
      } catch (error) {
        console.error("[style-metadata] Failed to generate style summary", error);
      }
    }
  }

  if (!styleTitle && input.fallbackTitle) {
    styleTitle = sanitizeStyleTitle(input.fallbackTitle);
  }

  if (!styleSummary && input.writingStyle) {
    styleSummary = sanitizeStyleSummary(input.writingStyle);
  }

  return {
    styleTitle: styleTitle ?? null,
    styleSummary: styleSummary ?? null,
    tokensUsed
  };
}
