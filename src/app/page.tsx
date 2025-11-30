import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import WriterWorkspace from "@/components/panels/WriterWorkspace";

export const dynamic = "force-dynamic";

// Prisma client in this workspace does not surface optional brief fields in its generated types,
// so define the subset we know exists and cast query results to it for now.
type StoredDocument = {
  id: string;
  title: string;
  content: string;
  createdAt: Date;
  tone: string | null;
  prompt: string | null;
  characterLength: number | null;
  wordLength: number | null;
  gradeLevel: string | null;
  benchmark: string | null;
  avoidWords: string | null;
  writingStyle: string | null;
};

export default async function HomePage() {
  const session = await auth();
  const sanitizeTier = (value: string | null | undefined) =>
    value && ["MASS", "PREMIUM", "LUXURY", "UHNW"].includes(value) ? (value as "MASS" | "PREMIUM" | "LUXURY" | "UHNW") : null;

  if (!session?.user?.id || !prisma) {
    return (
      <WriterWorkspace
        isGuest
        user={{
          name: session?.user?.name ?? "Guest"
        }}
      />
    );
  }

  const user = session.user;
  const documents = (await prisma.document.findMany({
    where: { ownerId: user.id },
    orderBy: { createdAt: "desc" },
    take: 5
  })) as unknown as StoredDocument[];

  return (
    <WriterWorkspace
      user={{
        name: user.name ?? "Creator"
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
        prompt: doc.prompt ?? "",
        writingStyle: doc.writingStyle ?? null,
        placeholderValues: {}
      }))}
    />
  );
}

