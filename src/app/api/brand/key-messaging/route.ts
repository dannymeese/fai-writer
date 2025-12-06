import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const addKeyMessagingSchema = z.object({
  text: z.string().min(1, "Text must not be empty").max(500, "Text must be 500 characters or less"),
  brandId: z.string().optional()
});

// GET - Fetch key messaging items for the user, optionally filtered by brandId
export async function GET(request: Request) {
  const session = await auth();
  const isAuthenticated = Boolean(session?.user?.id);

  if (!isAuthenticated || !session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 500 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const brandId = searchParams.get("brandId");

    const where: any = { ownerId: session.user.id };
    if (brandId) {
      where.brandId = brandId;
    }

    const items = await prisma.brandKeyMessaging.findMany({
      where,
      orderBy: { createdAt: "desc" }
    });

    return NextResponse.json({ items });
  } catch (error) {
    console.error("Failed to fetch brand key messaging items", error);
    return NextResponse.json({ error: "Failed to fetch items" }, { status: 500 });
  }
}

// POST - Add a new key messaging item
export async function POST(request: Request) {
  const session = await auth();
  const isAuthenticated = Boolean(session?.user?.id);

  if (!isAuthenticated || !session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 500 });
  }

  const json = await request.json().catch(() => null);
  const parsed = addKeyMessagingSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { text, brandId } = parsed.data;

  try {
    // If brandId is provided, verify it belongs to the user
    if (brandId && brandId.trim()) {
      const brand = await prisma.brand.findUnique({
        where: { id: brandId }
      });
      if (!brand || brand.ownerId !== session.user.id) {
        return NextResponse.json({ error: "Brand not found or unauthorized" }, { status: 403 });
      }
    }

    const createData: {
      text: string;
      ownerId: string;
      brandId?: string | null;
    } = {
      text: text.trim(),
      ownerId: session.user.id
    };

    // Only include brandId if it's provided, otherwise set to null explicitly
    if (brandId && brandId.trim()) {
      createData.brandId = brandId;
    } else {
      createData.brandId = null;
    }

    const item = await prisma.brandKeyMessaging.create({
      data: createData
    });

    return NextResponse.json({ success: true, item });
  } catch (error: any) {
    console.error("Failed to add brand key messaging item", error);
    // Return more detailed error information for debugging
    const errorMessage = error?.message || "Failed to add item";
    const errorCode = error?.code || "UNKNOWN_ERROR";
    return NextResponse.json({ 
      error: "Failed to add item", 
      details: errorMessage,
      code: errorCode
    }, { status: 500 });
  }
}

// DELETE - Remove a key messaging item
export async function DELETE(request: Request) {
  const session = await auth();
  const isAuthenticated = Boolean(session?.user?.id);

  if (!isAuthenticated || !session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Item ID is required" }, { status: 400 });
  }

  try {
    // Verify the item belongs to the user before deleting
    const item = await prisma.brandKeyMessaging.findUnique({
      where: { id }
    });

    if (!item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    if (item.ownerId !== session.user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    await prisma.brandKeyMessaging.delete({
      where: { id }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete brand key messaging item", error);
    return NextResponse.json({ error: "Failed to delete item" }, { status: 500 });
  }
}

