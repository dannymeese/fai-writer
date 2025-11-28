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

  return NextResponse.json({ ok: true });
}

