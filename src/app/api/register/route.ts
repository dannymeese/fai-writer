import { NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { registerSchema } from "@/lib/validators";

export async function POST(request: Request) {
  const db = prisma;
  if (!db) {
    return NextResponse.json({ message: "Registration is disabled until the database is configured." }, { status: 503 });
  }
  const body = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid fields", details: parsed.error.flatten() }, { status: 400 });
  }

  const { name, email, password } = parsed.data;

  try {
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ message: "Email already registered" }, { status: 409 });
    }

    const hashed = await hash(password, 12);
    const user = await db.user.create({
      data: {
        name,
        email,
        password: hashed
      }
    });

    // Create default "Archive" folder for new user
    try {
      await db.folder.create({
        data: {
          name: "Archive",
          ownerId: user.id
        }
      });
    } catch (folderError) {
      // Log but don't fail registration if folder creation fails
      console.error("Failed to create Archive folder for new user:", folderError);
    }
  } catch (error) {
    console.error("register error", error);
    return NextResponse.json(
      { message: "Registration failed because the database is unavailable in this environment. Use guest mode instead." },
      { status: 503 }
    );
  }

  return NextResponse.json({ ok: true });
}

