import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { documentSchema } from "@/lib/validators";
import { deriveTitleFromContent, stripMarkdownFromTitle } from "@/lib/utils";
import { getOpenAIClient } from "@/lib/openai";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

// Helper to create SSE message
function createSSEMessage(type: string, data: any): string {
  return `data: ${JSON.stringify({ type, ...data })}\n\n`;
}

export async function POST(request: Request) {
  const encoder = new TextEncoder();
  
  // Create a readable stream for SSE
  const stream = new ReadableStream({
    async start(controller) {
      const sendLog = (step: string, details?: Record<string, any>) => {
        const timestamp = new Date().toISOString();
        controller.enqueue(encoder.encode(createSSEMessage("log", { step, details, timestamp })));
      };
      
      const sendProgress = (progress: number, status: string) => {
        controller.enqueue(encoder.encode(createSSEMessage("progress", { progress, status })));
      };
      
      const sendResult = (success: boolean, data?: any, error?: string) => {
        controller.enqueue(encoder.encode(createSSEMessage("result", { success, data, error })));
        controller.close();
      };

      try {
        // Step 1: Authentication
        sendLog("Authenticating user...");
        sendProgress(5, "Authenticating");
        
        const session = await auth();
        if (!session?.user?.id) {
          sendLog("Authentication failed", { error: "No session found" });
          sendResult(false, null, "Unauthorized");
          return;
        }
        sendLog("User authenticated", { userId: session.user.id.substring(0, 8) + "..." });
        sendProgress(10, "Authenticated");

        // Step 2: Database connection
        sendLog("Connecting to database...");
        const db = prisma;
        if (!db) {
          sendLog("Database connection failed", { error: "Prisma unavailable" });
          sendResult(false, null, "Document storage is disabled until the database is configured.");
          return;
        }
        sendLog("Database connected");
        sendProgress(15, "Database ready");

        // Step 3: Parse request body
        sendLog("Parsing request body...");
        let body: any = null;
        try {
          body = await request.json();
          sendLog(`Request body received: ${body.content?.length || 0} chars of content`);
        } catch (error) {
          sendLog("Failed to parse request body", { error: String(error) });
          sendResult(false, null, "Invalid JSON in request body");
          return;
        }
        sendProgress(20, "Request parsed");

        // Step 4: Validate request
        sendLog("Validating request data...");
        const parsed = documentSchema.safeParse(body);
        if (!parsed.success) {
          sendLog("Validation failed", { errors: parsed.error.flatten() });
          sendResult(false, null, JSON.stringify(parsed.error.flatten()));
          return;
        }
        sendLog("Request validated successfully");
        sendProgress(25, "Validated");

        // Step 5: Detect style payload
        sendLog("Detecting style payload...");
        const titleEndsWithStyle = parsed.data.title?.toLowerCase().endsWith(" style") || parsed.data.title?.endsWith("Style");
        const isStylePayload =
          Boolean(parsed.data.writingStyle) || Boolean(parsed.data.styleTitle) || Boolean(parsed.data.styleSummary) || titleEndsWithStyle;
        sendLog("Style payload detection", { isStylePayload, titleEndsWithStyle });
        sendProgress(30, "Style detected");

        let generatedWritingStyle: string | null = parsed.data.writingStyle ?? null;
        let generatedStyleTitle: string | null = null;
        let generatedStyleSummary: string | null = null;

        if (isStylePayload) {
          // Step 6: Initialize OpenAI
          sendLog("Initializing OpenAI client...");
          let openai;
          try {
            openai = getOpenAIClient();
            sendLog("OpenAI client initialized");
          } catch (error) {
            sendLog("OpenAI unavailable - will skip AI generation", { error: String(error) });
          }
          sendProgress(35, "OpenAI ready");

          // Step 7: Generate writingStyle description
          if (!generatedWritingStyle && parsed.data.content && openai) {
            sendLog("Generating writing style description...");
            sendProgress(40, "Analyzing style");
            
            const contentText = parsed.data.content.trim();
            if (contentText) {
              const contentPreview = contentText.length > 80 
                ? contentText.substring(0, 80) + "..." 
                : contentText;
              sendLog(`Analyzing text (${contentText.length} chars): "${contentPreview}"`);
              
              try {
                sendLog("Calling OpenAI API for style description...");
                const styleResponse = await openai.responses.create({
                  model: "gpt-4.1-mini",
                  temperature: 0.4,
                  max_output_tokens: 200,
                  text: { format: { type: "json_object" } },
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
                
                sendLog(`Received AI response (${styleResponse.output_text?.length || 0} chars)`);
                sendProgress(55, "Style analyzed");
                
                // Parse the response
                sendLog("Parsing AI response...");
                try {
                  const jsonText = styleResponse.output_text?.trim() ?? null;
                  if (jsonText) {
                    const parsedResponse = JSON.parse(jsonText);
                    generatedWritingStyle = parsedResponse.description?.trim() ?? null;
                    if (generatedWritingStyle) {
                      const preview = generatedWritingStyle.length > 100 
                        ? generatedWritingStyle.substring(0, 100) + "..." 
                        : generatedWritingStyle;
                      sendLog(`Writing style analyzed: "${preview}"`);
                    }
                  }
                } catch (parseError) {
                  sendLog("Failed to parse JSON, using raw text", { error: String(parseError) });
                  generatedWritingStyle = styleResponse.output_text?.trim() ?? null;
                }
                sendProgress(60, "Description generated");
              } catch (error: any) {
                const errorMessage = error?.message || error?.error?.message || error?.response?.data?.error?.message || String(error);
                const errorCode = error?.status || error?.code || error?.error?.code || "unknown";
                sendLog(`AI style generation failed [${errorCode}]: ${errorMessage}`);
                console.error("[save-style] AI style generation error:", error);
              }
            }
          } else if (generatedWritingStyle) {
            sendLog("Using provided writing style", { length: generatedWritingStyle.length });
            sendProgress(60, "Using existing style");
          }

          // Step 8: Generate style title and summary
          sendLog("Generating style title and summary...");
          sendProgress(65, "Generating metadata");
          
          if (openai) {
            const descriptor = (generatedWritingStyle ?? parsed.data.content ?? "")?.trim();
            if (descriptor) {
              sendLog(`Generating title & summary from ${descriptor.length} chars of style data...`);
              
              try {
                sendLog("Calling OpenAI API for style metadata...");
                const metadataResponse = await openai.responses.create({
                  model: "gpt-4.1-mini",
                  temperature: 0.5,
                  max_output_tokens: 200,
                  text: { format: { type: "json_object" } },
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
                
                sendLog(`Received title/summary response (${metadataResponse.output_text?.length || 0} chars)`);
                sendProgress(80, "Metadata received");
                
                // Parse the metadata response
                sendLog("Parsing metadata response...");
                try {
                  const jsonText = metadataResponse.output_text?.trim() ?? null;
                  if (jsonText) {
                    const parsedMeta = JSON.parse(jsonText);
                    if (parsedMeta.title) {
                      generatedStyleTitle = sanitizeStyleTitle(parsedMeta.title);
                      sendLog(`Generated style title: "${generatedStyleTitle}"`);
                    }
                    if (parsedMeta.summary) {
                      generatedStyleSummary = sanitizeStyleSummary(parsedMeta.summary);
                      sendLog(`Generated style summary: "${generatedStyleSummary}"`);
                    }
                  }
                } catch (parseError) {
                  sendLog("Failed to parse metadata JSON", { error: String(parseError) });
                }
                sendProgress(85, "Metadata parsed");
              } catch (error: any) {
                const errorMessage = error?.message || error?.error?.message || error?.response?.data?.error?.message || String(error);
                const errorCode = error?.status || error?.code || error?.error?.code || "unknown";
                sendLog(`AI metadata generation failed [${errorCode}]: ${errorMessage}`);
                console.error("[save-style] AI metadata generation error:", error);
              }
            }
          }
        }
        
        // Step 9: Prepare document data
        sendLog("Preparing document data for database...");
        sendProgress(88, "Preparing save");
        
        const resolvedStyleTitle = generatedStyleTitle ?? parsed.data.styleTitle ?? null;
        const resolvedStyleSummary = generatedStyleSummary ?? parsed.data.styleSummary ?? null;

        const rawStyleTitleValue =
          resolvedStyleTitle !== null && resolvedStyleTitle !== undefined
            ? stripMarkdownFromTitle(resolvedStyleTitle).trim().slice(0, 100)
            : null;
        const styleTitleValue = rawStyleTitleValue && rawStyleTitleValue.trim().length > 0 ? rawStyleTitleValue : null;
        
        let autoTitle: string | null = null;
        if (isStylePayload && titleEndsWithStyle) {
          if (styleTitleValue) {
            autoTitle = styleTitleValue;
          } else {
            autoTitle = deriveTitleFromContent(parsed.data.content, "Writing Style");
          }
        } else if (styleTitleValue) {
          autoTitle = styleTitleValue;
        } else if (parsed.data.title && parsed.data.title.trim()) {
          autoTitle = parsed.data.title.trim();
        } else {
          autoTitle = deriveTitleFromContent(parsed.data.content, parsed.data.title);
        }

        if (!autoTitle || autoTitle.trim().length === 0) {
          sendLog("Failed to generate title", { error: "Empty title" });
          sendResult(false, null, "Unable to generate document title.");
          return;
        }

        const cleanedTitle = stripMarkdownFromTitle(autoTitle);
        const trimmedTitle = cleanedTitle.trim();
        const finalTitle = trimmedTitle.length > 255 ? trimmedTitle.substring(0, 255) : trimmedTitle;
        
        sendLog(`Final document title: "${finalTitle}"`);

        const createData: any = {
          title: finalTitle,
          content: parsed.data.content || "",
          ownerId: session.user.id
        };

        if (parsed.data.tone !== undefined && parsed.data.tone !== null) createData.tone = parsed.data.tone;
        if (parsed.data.prompt !== undefined && parsed.data.prompt !== null) createData.prompt = parsed.data.prompt;
        if (parsed.data.characterLength !== undefined && parsed.data.characterLength !== null) createData.characterLength = parsed.data.characterLength;
        if (parsed.data.wordLength !== undefined && parsed.data.wordLength !== null) createData.wordLength = parsed.data.wordLength;
        if (parsed.data.gradeLevel !== undefined && parsed.data.gradeLevel !== null) createData.gradeLevel = parsed.data.gradeLevel;
        if (parsed.data.benchmark !== undefined && parsed.data.benchmark !== null) createData.benchmark = parsed.data.benchmark;
        if (parsed.data.avoidWords !== undefined && parsed.data.avoidWords !== null) createData.avoidWords = parsed.data.avoidWords;
        
        const resolvedWritingStyle = generatedWritingStyle ?? parsed.data.writingStyle ?? null;
        if (resolvedWritingStyle !== null && resolvedWritingStyle !== undefined) {
          createData.writingStyle = resolvedWritingStyle;
        }
        if (resolvedStyleSummary !== undefined && resolvedStyleSummary !== null && resolvedStyleSummary.trim().length > 0) {
          createData.styleSummary = resolvedStyleSummary;
        }
        if (isStylePayload) {
          createData.styleTitle = finalTitle;
        } else if (styleTitleValue !== null) {
          createData.styleTitle = styleTitleValue;
        }
        if (parsed.data.pinned !== undefined) createData.pinned = parsed.data.pinned;

        const dataStats = [
          createData.writingStyle ? "style description" : null,
          createData.styleTitle ? "title" : null,
          createData.styleSummary ? "summary" : null
        ].filter(Boolean).join(", ");
        sendLog(`Document data prepared with: ${dataStats || "content only"}`);
        sendProgress(90, "Data ready");

        // Step 10: Verify user exists
        sendLog("Verifying user exists in database...");
        const userExists = await db.user.findUnique({
          where: { id: session.user.id },
          select: { id: true }
        });
        
        if (!userExists) {
          sendLog("User not found in database", { error: "User does not exist" });
          sendResult(false, null, "User account not found. Please sign in again.");
          return;
        }
        sendLog("User verified");
        sendProgress(92, "User verified");

        // Step 11: Save to database
        sendLog("Saving document to database...");
        sendProgress(95, "Saving");
        
        let doc;
        try {
          doc = await db.document.create({
            data: createData
          });
          sendLog(`Document saved to database (ID: ${doc.id.substring(0, 8)}...)`);
        } catch (createError) {
          sendLog("Database save failed", { error: String(createError) });
          throw createError;
        }
        sendProgress(100, "Complete");

        // Final step: Send success result
        sendLog(`✨ Style generation complete! Title: "${doc.styleTitle || doc.title}"`);
        
        sendResult(true, doc);
        
      } catch (error) {
        // Handle Prisma-specific errors
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (error.code === "P2002") {
            controller.enqueue(encoder.encode(createSSEMessage("log", { 
              step: "Database error: duplicate entry", 
              details: { code: error.code },
              timestamp: new Date().toISOString()
            })));
            controller.enqueue(encoder.encode(createSSEMessage("result", { 
              success: false, 
              error: "A document with this identifier already exists." 
            })));
            controller.close();
            return;
          }
          if (error.code === "P2003") {
            controller.enqueue(encoder.encode(createSSEMessage("log", { 
              step: "Database error: foreign key violation", 
              details: { code: error.code },
              timestamp: new Date().toISOString()
            })));
            controller.enqueue(encoder.encode(createSSEMessage("result", { 
              success: false, 
              error: "Database constraint violation. Please ensure your account is properly set up." 
            })));
            controller.close();
            return;
          }
        }

        controller.enqueue(encoder.encode(createSSEMessage("log", { 
          step: "Unexpected error occurred", 
          details: { error: error instanceof Error ? error.message : String(error) },
          timestamp: new Date().toISOString()
        })));
        controller.enqueue(encoder.encode(createSSEMessage("result", { 
          success: false, 
          error: error instanceof Error ? error.message : "Unable to save document." 
        })));
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    }
  });
}

// Helper functions (duplicated from style-metadata.ts to avoid import issues with streaming)
function sanitizeStyleTitle(rawTitle: string | null | undefined): string | null {
  if (!rawTitle) return null;
  let clean = stripMarkdownFromTitle(rawTitle)
    .replace(/^["']|["']$/g, "")
    .replace(/\.$/, "")
    .trim();
  if (!clean) return null;
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 3) {
    return words.join(" ");
  }
  if (words.length > 3) {
    return words.slice(0, 3).join(" ");
  }
  return clean;
}

function sanitizeStyleSummary(rawSummary: string | null | undefined): string | null {
  if (!rawSummary) return null;
  const normalized = rawSummary.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length > 200 ? normalized.slice(0, 200) : normalized;
}
