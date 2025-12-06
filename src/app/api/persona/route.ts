import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import type OpenAI from "openai";
import { getOpenAIClient } from "@/lib/openai";
import { z } from "zod";

const personaProcessSchema = z.object({
  personaName: z.string().max(100, "Persona name must be 100 characters or less").optional(),
  personaInfo: z.string().min(10, "Persona info must be at least 10 characters")
});

export async function POST(request: Request) {
  const url = new URL(request.url);
  const activatePersonaId = url.searchParams.get("activate");
  
  // Handle persona activation
  if (activatePersonaId) {
    const session = await auth();
    const isAuthenticated = Boolean(session?.user?.id);
    
    if (!isAuthenticated || !session?.user?.id || !prisma) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }
    
    try {
      // Verify the persona belongs to the user
      const persona = await prisma.persona.findFirst({
        where: {
          id: activatePersonaId,
          ownerId: session.user.id
        }
      });
      
      if (!persona) {
        return NextResponse.json(
          { error: "Persona not found" },
          { status: 404 }
        );
      }
      
      // Activate the persona
      await prisma.user.update({
        where: { id: session.user.id },
        data: { activePersonaId: activatePersonaId }
      });
      
      return NextResponse.json({ success: true, activePersonaId: activatePersonaId });
    } catch (error) {
      console.error("Failed to activate persona", error);
      return NextResponse.json(
        { error: "Failed to activate persona" },
        { status: 500 }
      );
    }
  }
  
  // Original POST logic for creating/updating personas
  console.log("[persona][POST] Starting persona save request");
  const session = await auth();
  const isAuthenticated = Boolean(session?.user?.id);
  console.log("[persona][POST] Authentication check:", { 
    isAuthenticated, 
    userId: session?.user?.id,
    hasPrisma: !!prisma 
  });

  let json: any = null;
  try {
    json = await request.json();
    console.log("[persona][POST] Request body parsed:", { 
      hasPersonaName: !!json.personaName,
      hasPersonaInfo: !!json.personaInfo,
      personaInfoLength: json.personaInfo?.length 
    });
  } catch (error) {
    console.error("[persona][POST] Failed to parse JSON", error);
    return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  const parsed = personaProcessSchema.safeParse(json);

  if (!parsed.success) {
    const flattened = parsed.error.flatten();
    // Return a more user-friendly error message
    const errorMessages: string[] = [];
    if (flattened.formErrors.length > 0) {
      errorMessages.push(...flattened.formErrors);
    }
    if (flattened.fieldErrors) {
      Object.entries(flattened.fieldErrors).forEach(([field, errors]) => {
        if (Array.isArray(errors)) {
          errors.forEach(err => errorMessages.push(`${field}: ${err}`));
        }
      });
    }
    return NextResponse.json({ 
      error: errorMessages.length > 0 ? errorMessages.join(". ") : "Validation failed",
      details: flattened
    }, { status: 400 });
  }

  const { personaName, personaInfo } = parsed.data;
  const trimmedPersonaName = personaName?.trim() || null;
  const fallbackPersonaInfo = personaInfo.trim().substring(0, 400);
  let openai: OpenAI | null = null;

  try {
    openai = getOpenAIClient();
  } catch (error) {
    console.warn("OPENAI_API_KEY missing for persona processing. Using fallback summary.", error);
  }

  let processedPersonaInfo = fallbackPersonaInfo;

  if (openai) {
    try {
      // Process and compact the persona information
      const response = await openai.responses.create({
        model: "gpt-5.1",
        temperature: 0.3,
        max_output_tokens: 200, // Reduced to help stay under 400 chars
        input: [
          {
            role: "system",
            content: `You are a persona strategist. Your task is to digest and compact persona information into a comprehensive persona guide that includes:
1. Persona identity and values
2. Persona voice and tone
3. Key vocabulary and preferred terminology
4. Style preferences
5. Target audience characteristics
6. Any other relevant persona details

Create a concise but complete persona guide that captures all essential information. Focus on actionable details that can guide future writing. IMPORTANT: Keep your response to 400 characters or less. Be extremely concise while maintaining all critical information.`
          },
          {
            role: "user",
            content: `Process and compact the following persona information:\n\n${personaInfo}`
          }
        ]
      });

      const aiSummary = response.output_text?.trim();
      if (aiSummary) {
        processedPersonaInfo = aiSummary.substring(0, 400);
      } else {
        console.warn("Persona processing returned empty response. Falling back to raw input.");
      }
    } catch (error) {
      console.error("Persona processing error", error);
      // Fall back to the raw/truncated user input so the workflow still succeeds offline.
      processedPersonaInfo = fallbackPersonaInfo;
    }
  } else {
    console.warn("OPENAI_API_KEY missing. Using raw persona info without AI processing.");
  }

  // Save to database for authenticated users FIRST, before creating response
  if (isAuthenticated && session?.user?.id) {
    if (!prisma) {
      console.error("Prisma client not available");
      return NextResponse.json({ 
        error: "Database not available",
        details: "Prisma client is not initialized"
      }, { status: 503 });
    }
    
    try {
      console.log("[persona][POST] Checking for existing active persona for user:", session.user.id);
      // Check if user already has an active persona
      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { activePersonaId: true }
      });
      console.log("[persona][POST] User lookup result:", { 
        userId: session.user.id,
        activePersonaId: user?.activePersonaId 
      });

      if (user?.activePersonaId) {
        console.log("[persona][POST] Updating existing persona:", user.activePersonaId);
        // Update existing persona
        await prisma.persona.update({
          where: { id: user.activePersonaId },
          data: {
            name: trimmedPersonaName,
            info: processedPersonaInfo
          }
        });
        console.log("[persona][POST] Persona updated successfully");
      } else {
        console.log("[persona][POST] Creating new persona for user:", session.user.id);
        // Create new persona and set it as active
        const persona = await prisma.persona.create({
          data: {
            name: trimmedPersonaName,
            info: processedPersonaInfo,
            ownerId: session.user.id
          }
        });
        console.log("[persona][POST] Persona created:", persona.id);
        
        console.log("[persona][POST] Updating user with activePersonaId:", persona.id);
        await prisma.user.update({
          where: { id: session.user.id },
          data: {
            activePersonaId: persona.id,
            personaName: trimmedPersonaName,
            personaInfo: processedPersonaInfo
          }
        });
        console.log("[persona][POST] User updated successfully");
      }
    } catch (error) {
      console.error("Failed to save persona to database", error);
      
      // Provide more detailed error information
      let errorMessage = "Database error";
      let errorDetails: Record<string, unknown> | string | null = null;
      
      if (error instanceof Error) {
        errorMessage = error.message;
        const baseDetails: Record<string, unknown> = {
          name: error.name,
          message: error.message,
          stack: error.stack
        };
        
        // Check for common Prisma errors
        if (error.message.includes("Unknown model") || error.message.includes("does not exist")) {
          errorMessage = "Database migration required. Please run: npx prisma migrate dev";
          errorDetails = {
            ...baseDetails,
            hint: "The Persona table may not exist. Run database migrations to create it."
          };
        } else if (error.message.includes("Foreign key constraint")) {
          errorMessage = "Invalid user reference";
          errorDetails = {
            ...baseDetails,
            hint: "The user account may not exist or may have been deleted."
          };
        } else if (error.message.includes("Unique constraint")) {
          errorMessage = "Persona already exists";
          errorDetails = {
            ...baseDetails,
            hint: "A persona with this information already exists."
          };
        } else {
          errorDetails = baseDetails;
        }
      } else {
        errorDetails = String(error);
      }
      
      return NextResponse.json({ 
        error: errorMessage,
        details: errorDetails
      }, { status: 500 });
    }
  }

  // Create response after successful database save (or if guest user)
  const jsonResponse = NextResponse.json({ 
    success: true, 
    personaName: trimmedPersonaName,
    personaInfo: processedPersonaInfo 
  });

  // Store in cookie for guests
  if (!isAuthenticated) {
    // Store in cookie for guests (combine name and info)
    try {
      const guestPersonaData = JSON.stringify({
        personaName: trimmedPersonaName,
        personaInfo: processedPersonaInfo
      });
      jsonResponse.cookies.set("guest_persona_info", guestPersonaData, {
        maxAge: 60 * 60 * 24 * 365, // 1 year
        path: "/"
      });
    } catch (cookieError) {
      console.error("Failed to store persona info in cookie", cookieError);
      return NextResponse.json(
        { error: "Unable to store persona info for guest users." },
        { status: 500 }
      );
    }
  }

  return jsonResponse;
}

export async function GET(request: Request) {
  const session = await auth();
  const isAuthenticated = Boolean(session?.user?.id);
  const cookieStore = await cookies();
  
  // Check if requesting all personas (for personas list)
  const url = new URL(request.url);
  const allPersonas = url.searchParams.get("all") === "true";

  // If requesting all personas, return list of all user personas
  if (allPersonas && isAuthenticated && session?.user?.id && prisma) {
    try {
      const personas = await prisma.persona.findMany({
        where: { ownerId: session.user.id },
        select: {
          id: true,
          name: true,
          info: true,
          createdAt: true,
          updatedAt: true
        },
        orderBy: { createdAt: "desc" }
      });
      
      // Also get active persona ID
      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { activePersonaId: true }
      });
      
      return NextResponse.json({ 
        brands: personas.map(p => ({
          id: p.id,
          name: p.name,
          info: p.info,
          isActive: p.id === user?.activePersonaId,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt
        })),
        activeBrandId: user?.activePersonaId ?? null
      });
    } catch (error) {
      console.error("Failed to fetch all personas from database", error);
      return NextResponse.json({ brands: [], activeBrandId: null });
    }
  }

  // Try to get active persona from database for authenticated users
  if (isAuthenticated && session?.user?.id && prisma) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { 
          activePersonaId: true,
          activePersona: {
            select: {
              name: true,
              info: true
            }
          },
          personaName: true,
          personaInfo: true
        }
      });

      // Prefer active persona from Persona table, fall back to legacy fields
      if (user?.activePersonaId && user?.activePersona) {
      return NextResponse.json({ 
        personaName: user.activePersona.name ?? null, 
        personaInfo: user.activePersona.info ?? null 
      });
      } else if (user?.personaInfo || user?.personaName) {
        // Fall back to legacy fields
        return NextResponse.json({ 
          personaName: user.personaName ?? null, 
          personaInfo: user.personaInfo ?? null 
        });
      }
    } catch (error) {
      console.error("Failed to fetch persona info from database", error);
      // Don't return error here, fall through to cookie/guest handling
    }
  }

  // Fall back to cookie for guests or if DB lookup failed
  const guestPersonaData = cookieStore.get("guest_persona_info")?.value;
  if (guestPersonaData) {
    try {
      const parsed = JSON.parse(guestPersonaData);
      return NextResponse.json({ 
        personaName: parsed.personaName || null, 
        personaInfo: parsed.personaInfo || null 
      });
    } catch {
      // Legacy format - just personaInfo string
      return NextResponse.json({ personaName: null, personaInfo: guestPersonaData });
    }
  }
  return NextResponse.json({ personaName: null, personaInfo: null });
}

export async function DELETE() {
  const session = await auth();
  const isAuthenticated = Boolean(session?.user?.id);
  const response = NextResponse.json({ success: true });

  if (isAuthenticated && session?.user?.id && prisma) {
    try {
      // Deselect the active persona instead of deleting it
      await prisma.user.update({
        where: { id: session.user.id },
        data: { 
          activePersonaId: null,
          personaName: null, 
          personaInfo: null 
        }
      });
    } catch (error) {
      console.error("Failed to deselect persona from database", error);
      
      let errorMessage = "Unable to deselect persona";
      let errorDetails: string | unknown = null;
      
      if (error instanceof Error) {
        errorMessage = error.message;
        errorDetails = {
          name: error.name,
          message: error.message,
          stack: error.stack
        };
      } else {
        errorDetails = String(error);
      }
      
      return NextResponse.json({ 
        error: errorMessage,
        details: errorDetails
      }, { status: 500 });
    }
  }

  response.cookies.set("guest_persona_info", "", {
    maxAge: 0,
    path: "/"
  });

  return response;
}

