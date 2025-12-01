import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import type OpenAI from "openai";
import { getOpenAIClient } from "@/lib/openai";
import { z } from "zod";

const brandProcessSchema = z.object({
  brandName: z.string().max(100, "Brand name must be 100 characters or less").optional(),
  brandInfo: z.string().min(10, "Brand info must be at least 10 characters")
});

export async function POST(request: Request) {
  const session = await auth();
  const isAuthenticated = Boolean(session?.user?.id);

  let json: any = null;
  try {
    json = await request.json();
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  const parsed = brandProcessSchema.safeParse(json);

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

  const { brandName, brandInfo } = parsed.data;
  const trimmedBrandName = brandName?.trim() || null;
  const fallbackBrandInfo = brandInfo.trim().substring(0, 400);
  let openai: OpenAI | null = null;

  try {
    openai = getOpenAIClient();
  } catch (error) {
    console.warn("OPENAI_API_KEY missing for brand processing. Using fallback summary.", error);
  }

  let processedBrandInfo = fallbackBrandInfo;

  if (openai) {
    try {
      // Process and compact the brand information
      const response = await openai.responses.create({
        model: "gpt-5.1",
        temperature: 0.3,
        max_output_tokens: 200, // Reduced to help stay under 400 chars
        input: [
          {
            role: "system",
            content: `You are a brand strategist. Your task is to digest and compact brand information into a comprehensive brand guide that includes:
1. Brand identity and values
2. Brand voice and tone
3. Key vocabulary and preferred terminology
4. Style preferences
5. Target audience characteristics
6. Any other relevant brand details

Create a concise but complete brand guide that captures all essential information. Focus on actionable details that can guide future writing. IMPORTANT: Keep your response to 400 characters or less. Be extremely concise while maintaining all critical information.`
          },
          {
            role: "user",
            content: `Process and compact the following brand information:\n\n${brandInfo}`
          }
        ]
      });

      const aiSummary = response.output_text?.trim();
      if (aiSummary) {
        processedBrandInfo = aiSummary.substring(0, 400);
      } else {
        console.warn("Brand processing returned empty response. Falling back to raw input.");
      }
    } catch (error) {
      console.error("Brand processing error", error);
      // Fall back to the raw/truncated user input so the workflow still succeeds offline.
      processedBrandInfo = fallbackBrandInfo;
    }
  } else {
    console.warn("OPENAI_API_KEY missing. Using raw brand info without AI processing.");
  }

  const jsonResponse = NextResponse.json({ 
    success: true, 
    brandName: trimmedBrandName,
    brandInfo: processedBrandInfo 
  });

  // Save to database for authenticated users
  if (isAuthenticated && session?.user?.id && prisma) {
    try {
      await prisma.user.update({
        where: { id: session.user.id },
        data: {
          brandName: trimmedBrandName,
          brandInfo: processedBrandInfo
        } as any
      });
    } catch (error) {
      console.error("Failed to save brand to database", error);
      const errorMessage = error instanceof Error ? error.message : "Database error";
      return NextResponse.json({ 
        error: "Failed to save brand to database", 
        details: errorMessage 
      }, { status: 500 });
    }
  } else {
    // Store in cookie for guests (combine name and info)
    try {
      const guestBrandData = JSON.stringify({
        brandName: trimmedBrandName,
        brandInfo: processedBrandInfo
      });
      jsonResponse.cookies.set("guest_brand_info", guestBrandData, {
        maxAge: 60 * 60 * 24 * 365, // 1 year
        path: "/"
      });
    } catch (cookieError) {
      console.error("Failed to store brand info in cookie", cookieError);
      return NextResponse.json(
        { error: "Unable to store brand info for guest users." },
        { status: 500 }
      );
    }
  }

  return jsonResponse;
}

export async function GET() {
  const session = await auth();
  const isAuthenticated = Boolean(session?.user?.id);
  const cookieStore = await cookies();

  // Try to get from database for authenticated users
  if (isAuthenticated && session?.user?.id && prisma) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { brandName: true, brandInfo: true }
      });

      const brandName = (user as any)?.brandName ?? null;
      const brandInfo = (user as any)?.brandInfo ?? null;
      if (brandInfo || brandName) {
        return NextResponse.json({ brandName, brandInfo });
      }
    } catch (error) {
      console.error("Failed to fetch brand info from database", error);
    }
  }

  // Fall back to cookie for guests or if DB lookup failed
  const guestBrandData = cookieStore.get("guest_brand_info")?.value;
  if (guestBrandData) {
    try {
      const parsed = JSON.parse(guestBrandData);
      return NextResponse.json({ 
        brandName: parsed.brandName || null, 
        brandInfo: parsed.brandInfo || null 
      });
    } catch {
      // Legacy format - just brandInfo string
      return NextResponse.json({ brandName: null, brandInfo: guestBrandData });
    }
  }
  return NextResponse.json({ brandName: null, brandInfo: null });
}

export async function DELETE() {
  const session = await auth();
  const isAuthenticated = Boolean(session?.user?.id);
  const response = NextResponse.json({ success: true });

  if (isAuthenticated && session?.user?.id && prisma) {
    try {
      await prisma.user.update({
        where: { id: session.user.id },
        data: { brandName: null, brandInfo: null }
      });
    } catch (error) {
      console.error("Failed to clear brand info from database", error);
      return NextResponse.json({ error: "Unable to clear brand information." }, { status: 500 });
    }
  }

  response.cookies.set("guest_brand_info", "", {
    maxAge: 0,
    path: "/"
  });

  return response;
}

