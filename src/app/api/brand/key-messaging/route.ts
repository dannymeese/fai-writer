import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const addKeyMessagingSchema = z.object({
  text: z.string().min(1, "Text must not be empty").max(500, "Text must be 500 characters or less")
});

// GET - Fetch all key messaging items for the user
export async function GET() {
  const session = await auth();
  const isAuthenticated = Boolean(session?.user?.id);

  if (!isAuthenticated || !session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 500 });
  }

  try {
    const items = await prisma.brandKeyMessaging.findMany({
      where: { ownerId: session.user.id },
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

  const { text } = parsed.data;

  try {
    const item = await prisma.brandKeyMessaging.create({
      data: {
        text: text.trim(),
        ownerId: session.user.id
      }
    });

    return NextResponse.json({ success: true, item });
  } catch (error) {
    console.error("Failed to add brand key messaging item", error);
    return NextResponse.json({ error: "Failed to add item" }, { status: 500 });
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

