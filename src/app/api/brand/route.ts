import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import OpenAI from "openai";
import { z } from "zod";

const brandProcessSchema = z.object({
  brandInfo: z.string().min(10, "Brand info must be at least 10 characters")
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = brandProcessSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { brandInfo } = parsed.data;

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY missing" }, { status: 500 });
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    // Process and compact the brand information
    const response = await openai.responses.create({
      model: "gpt-5.1",
      temperature: 0.3,
      max_output_tokens: 800,
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

Create a concise but complete brand guide that captures all essential information. Focus on actionable details that can guide future writing.`
        },
        {
          role: "user",
          content: `Process and compact the following brand information:\n\n${brandInfo}`
        }
      ]
    });

    const processedBrandInfo = response.output_text?.trim();

    if (!processedBrandInfo) {
      return NextResponse.json({ error: "Failed to process brand information" }, { status: 502 });
    }

    // Save to database
    if (prisma) {
      await prisma.user.update({
        where: { id: session.user.id },
        data: {
          brandInfo: processedBrandInfo
        } as any
      });
    }

    return NextResponse.json({ success: true, brandInfo: processedBrandInfo });
  } catch (error) {
    console.error("Brand processing error", error);
    return NextResponse.json({ error: "Failed to process brand information" }, { status: 500 });
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ brandInfo: null });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { brandInfo: true }
    });

    return NextResponse.json({ brandInfo: (user as any)?.brandInfo ?? null });
  } catch (error) {
    console.error("Failed to fetch brand info", error);
    return NextResponse.json({ brandInfo: null });
  }
}

