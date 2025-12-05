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
  const url = new URL(request.url);
  const activateBrandId = url.searchParams.get("activate");
  
  // Handle brand activation
  if (activateBrandId) {
    const session = await auth();
    const isAuthenticated = Boolean(session?.user?.id);
    
    if (!isAuthenticated || !session?.user?.id || !prisma) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }
    
    try {
      // Verify the brand belongs to the user
      const brand = await prisma.brand.findFirst({
        where: {
          id: activateBrandId,
          ownerId: session.user.id
        }
      });
      
      if (!brand) {
        return NextResponse.json(
          { error: "Brand not found" },
          { status: 404 }
        );
      }
      
      // Activate the brand
      await prisma.user.update({
        where: { id: session.user.id },
        data: { activeBrandId: activateBrandId }
      });
      
      return NextResponse.json({ success: true, activeBrandId: activateBrandId });
    } catch (error) {
      console.error("Failed to activate brand", error);
      return NextResponse.json(
        { error: "Failed to activate brand" },
        { status: 500 }
      );
    }
  }
  
  // Original POST logic for creating/updating brands
  console.log("[brand][POST] Starting brand save request");
  const session = await auth();
  const isAuthenticated = Boolean(session?.user?.id);
  console.log("[brand][POST] Authentication check:", { 
    isAuthenticated, 
    userId: session?.user?.id,
    hasPrisma: !!prisma 
  });

  let json: any = null;
  try {
    json = await request.json();
    console.log("[brand][POST] Request body parsed:", { 
      hasBrandName: !!json.brandName,
      hasBrandInfo: !!json.brandInfo,
      brandInfoLength: json.brandInfo?.length 
    });
  } catch (error) {
    console.error("[brand][POST] Failed to parse JSON", error);
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
      console.log("[brand][POST] Checking for existing active brand for user:", session.user.id);
      // Check if user already has an active brand
      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { activeBrandId: true }
      });
      console.log("[brand][POST] User lookup result:", { 
        userId: session.user.id,
        activeBrandId: user?.activeBrandId 
      });

      if (user?.activeBrandId) {
        console.log("[brand][POST] Updating existing brand:", user.activeBrandId);
        // Update existing brand
        await prisma.brand.update({
          where: { id: user.activeBrandId },
          data: {
            name: trimmedBrandName,
            info: processedBrandInfo
          }
        });
        console.log("[brand][POST] Brand updated successfully");
      } else {
        console.log("[brand][POST] Creating new brand for user:", session.user.id);
        // Create new brand and set it as active
        const brand = await prisma.brand.create({
          data: {
            name: trimmedBrandName,
            info: processedBrandInfo,
            ownerId: session.user.id
          }
        });
        console.log("[brand][POST] Brand created:", brand.id);
        
        console.log("[brand][POST] Updating user with activeBrandId:", brand.id);
        await prisma.user.update({
          where: { id: session.user.id },
          data: {
            activeBrandId: brand.id,
            // Keep legacy fields updated for backward compatibility
            brandName: trimmedBrandName,
            brandInfo: processedBrandInfo
          }
        });
        console.log("[brand][POST] User updated successfully");
      }
    } catch (error) {
      console.error("Failed to save brand to database", error);
      
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
            hint: "The Brand table may not exist. Run database migrations to create it."
          };
        } else if (error.message.includes("Foreign key constraint")) {
          errorMessage = "Invalid user reference";
          errorDetails = {
            ...baseDetails,
            hint: "The user account may not exist or may have been deleted."
          };
        } else if (error.message.includes("Unique constraint")) {
          errorMessage = "Brand already exists";
          errorDetails = {
            ...baseDetails,
            hint: "A brand with this information already exists."
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
    brandName: trimmedBrandName,
    brandInfo: processedBrandInfo 
  });

  // Store in cookie for guests
  if (!isAuthenticated) {
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

export async function GET(request: Request) {
  const session = await auth();
  const isAuthenticated = Boolean(session?.user?.id);
  const cookieStore = await cookies();
  
  // Check if requesting all brands (for brands list)
  const url = new URL(request.url);
  const allBrands = url.searchParams.get("all") === "true";

  // If requesting all brands, return list of all user brands
  if (allBrands && isAuthenticated && session?.user?.id && prisma) {
    try {
      const brands = await prisma.brand.findMany({
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
      
      // Also get active brand ID
      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { activeBrandId: true }
      });
      
      return NextResponse.json({ 
        brands: brands.map(b => ({
          id: b.id,
          name: b.name,
          info: b.info,
          isActive: b.id === user?.activeBrandId,
          createdAt: b.createdAt,
          updatedAt: b.updatedAt
        })),
        activeBrandId: user?.activeBrandId ?? null
      });
    } catch (error) {
      console.error("Failed to fetch all brands from database", error);
      return NextResponse.json({ brands: [], activeBrandId: null });
    }
  }

  // Try to get active brand from database for authenticated users
  if (isAuthenticated && session?.user?.id && prisma) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { 
          activeBrandId: true,
          activeBrand: {
            select: {
              name: true,
              info: true
            }
          },
          // Legacy fields for backward compatibility
          brandName: true,
          brandInfo: true
        }
      });

      // Prefer active brand from Brand table, fall back to legacy fields
      if (user?.activeBrandId && user?.activeBrand) {
        return NextResponse.json({ 
          brandName: user.activeBrand.name ?? null, 
          brandInfo: user.activeBrand.info ?? null 
        });
      } else if ((user as any)?.brandInfo || (user as any)?.brandName) {
        // Fall back to legacy fields
        return NextResponse.json({ 
          brandName: (user as any)?.brandName ?? null, 
          brandInfo: (user as any)?.brandInfo ?? null 
        });
      }
    } catch (error) {
      console.error("Failed to fetch brand info from database", error);
      // Don't return error here, fall through to cookie/guest handling
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
      // Deselect the active brand instead of deleting it
      await prisma.user.update({
        where: { id: session.user.id },
        data: { 
          activeBrandId: null,
          // Keep legacy fields cleared for backward compatibility
          brandName: null, 
          brandInfo: null 
        } as any
      });
    } catch (error) {
      console.error("Failed to deselect brand from database", error);
      
      let errorMessage = "Unable to deselect brand";
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

  response.cookies.set("guest_brand_info", "", {
    maxAge: 0,
    path: "/"
  });

  return response;
}

