import { z } from "zod";

export const marketTiers = ["MASS", "PREMIUM", "LUXURY", "UHNW"] as const;

export const registerSchema = z.object({
  name: z.string().min(2, "Name is required"),
  email: z.string().email("Valid email required"),
  password: z
    .string()
    .min(8, "Use at least 8 characters")
    .regex(/[0-9]/, "Add at least one number")
    .regex(/[A-Z]/, "Add at least one capital letter")
});

export const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Password required")
});

export const composerSettingsSchema = z.object({
  marketTier: z.enum(marketTiers).nullable(),
  characterLength: z.number().int().positive().max(2000).nullable(),
  wordLength: z.number().int().positive().max(1500).nullable(),
  gradeLevel: z.string().max(32).nullable(),
  benchmark: z.string().max(120).nullable(),
  avoidWords: z.string().max(200).nullable()
});

export type ComposerSettingsInput = z.infer<typeof composerSettingsSchema>;

const editorContextSchema = z.object({
  before: z.string().max(2000).optional().nullable(),
  after: z.string().max(2000).optional().nullable(),
  selection: z.string().max(2000).optional().nullable(),
  documentId: z.string().optional()
});

export const composeRequestSchema = z.object({
  prompt: z.string().min(10, "Share more detail"),
  settings: composerSettingsSchema,
  personaSummary: z.string().max(8000).optional(),
  styleGuide: z
    .object({
      name: z.string().min(1).max(80),
      description: z.string().min(1).max(1500)
    })
    .optional(),
  editorContext: editorContextSchema.optional()
});

export const documentSchema = z.object({
  title: z.string().min(0), // Allow empty titles
  content: z.string().min(0),
  tone: z.string().optional().nullable(),
  prompt: z.string().optional(),
  characterLength: z.number().int().positive().max(2000).nullable().optional(),
  wordLength: z.number().int().positive().max(1500).nullable().optional(),
  gradeLevel: z.string().max(32).nullable().optional(),
  benchmark: z.string().max(120).nullable().optional(),
  avoidWords: z.string().max(200).nullable().optional(),
  writingStyle: z.string().nullable().optional(),
  styleTitle: z.string().max(100).nullable().optional(),
  styleSummary: z.string().max(200).nullable().optional(),
  pinned: z.boolean().optional(),
  folders: z
    .array(z.string().min(1, "Folder id is required."))
    .max(20, "Limit documents to 20 folders.")
    .optional()
});

export const folderCreateSchema = z.object({
  name: z
    .string()
    .min(2, "Folder name needs at least 2 characters.")
    .max(120, "Folder name is too long.")
});

export const folderAssignSchema = z.object({
  folderId: z.string().min(1, "Folder is required."),
  documentId: z.string().min(1, "Document is required.")
});

export type FolderCreateInput = z.infer<typeof folderCreateSchema>;
export type FolderAssignInput = z.infer<typeof folderAssignSchema>;

