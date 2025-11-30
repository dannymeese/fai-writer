import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import WriterWorkspace from "@/components/panels/WriterWorkspace";

export default async function HomePage() {
  const session = await auth();
  const sanitizeTier = (value: string | null | undefined) =>
    value && ["MASS", "PREMIUM", "LUXURY", "UHNW"].includes(value) ? (value as "MASS" | "PREMIUM" | "LUXURY" | "UHNW") : "MASS";

  if (!session?.user?.id || !prisma) {
    return (
      <WriterWorkspace
        isGuest
        user={{
          name: session?.user?.name ?? "Guest",
          marketTier: session?.user?.marketTier ?? "MASS"
        }}
      />
    );
  }

  const user = session.user;
  const documents = await prisma.document.findMany({
    where: { ownerId: user.id },
    orderBy: { createdAt: "desc" },
    take: 5
  });

  return (
    <WriterWorkspace
      user={{
        name: user.name ?? "Creator",
        marketTier: user.marketTier ?? "MASS"
      }}
      initialOutputs={documents.map((doc) => ({
        id: doc.id,
        title: doc.title,
        content: doc.content,
        createdAt: doc.createdAt.toISOString(),
        settings: {
          marketTier: doc.tone ? sanitizeTier(doc.tone) : null,
          characterLength: doc.characterLength ?? null,
          wordLength: doc.wordLength ?? null,
          gradeLevel: doc.gradeLevel ?? null,
          benchmark: doc.benchmark ?? null,
          avoidWords: doc.avoidWords ?? null
        },
        prompt: doc.prompt ?? ""
      }))}
    />
  );
}

