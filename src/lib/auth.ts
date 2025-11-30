import GoogleProvider from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { compare } from "bcryptjs";
import type { NextAuthConfig } from "next-auth";
import type { Provider } from "next-auth/providers";
import { prisma } from "./prisma";
import { signInSchema } from "./validators";
import { logEvent } from "./logger";

const hasDatabase = Boolean(prisma);

const providers: Provider[] = [
  GoogleProvider({
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? ""
  })
];

if (hasDatabase) {
  providers.push(
    Credentials({
      id: "credentials",
      name: "Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!prisma) {
          return null;
        }
        const parsed = signInSchema.safeParse(credentials);
        if (!parsed.success) {
          // eslint-disable-next-line no-console
          console.warn("[auth] credentials schema failed", parsed.error.flatten());
          return null;
        }
        const { email, password } = parsed.data;
        // eslint-disable-next-line no-console
        console.info("[auth] Attempting sign-in", email);
        const user = await prisma.user.findUnique({
          where: { email }
        });
        if (!user?.password) {
          // eslint-disable-next-line no-console
          console.warn("[auth] No user or password for email", email);
          return null;
        }
        const valid = await compare(password, user.password);
        if (!valid) {
          // eslint-disable-next-line no-console
          console.warn("[auth] Invalid password for", email);
          return null;
        }
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          marketTier: user.marketTier
        };
      }
    })
  );
}

export const authConfig = {
  ...(hasDatabase && prisma ? { adapter: PrismaAdapter(prisma) } : {}),
  session: {
    strategy: "jwt"
  },
  providers,
  callbacks: {
    async session({ session, user, token }) {
      logEvent("session callback", {
        userId: user?.id ?? token?.sub ?? session?.user?.id ?? null
      });
      if (session.user) {
        session.user.id = user?.id ?? (token?.sub ?? session.user.id ?? "");
        session.user.marketTier =
          (user as any)?.marketTier ?? (token as any)?.marketTier ?? session.user.marketTier ?? "MASS";
      }
      return session;
    },
    async jwt({ token, user }) {
      logEvent("jwt callback", { tokenSub: token.sub ?? null, userId: (user as any)?.id ?? null });
      if (user) {
        (token as any).marketTier = (user as any).marketTier ?? "MASS";
      }
      return token;
    }
  },
  pages: {
    signIn: "/sign-in"
  }
} satisfies NextAuthConfig;

