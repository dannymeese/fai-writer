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
    await db.user.create({
      data: {
        name,
        email,
        password: hashed
      }
    });
  } catch (error) {
    console.error("register error", error);
    return NextResponse.json(
      { message: "Registration failed because the database is unavailable in this environment. Use guest mode instead." },
      { status: 503 }
    );
  }

  return NextResponse.json({ ok: true });
}

