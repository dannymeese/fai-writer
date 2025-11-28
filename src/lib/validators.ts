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
  marketTier: z.enum(marketTiers),
  characterLength: z.number().int().positive().max(2000).nullable(),
  wordLength: z.number().int().positive().max(1500).nullable(),
  gradeLevel: z.string().max(32).nullable(),
  benchmark: z.string().max(120).nullable(),
  avoidWords: z.string().max(200).nullable()
});

export type ComposerSettingsInput = z.infer<typeof composerSettingsSchema>;

export const composeRequestSchema = z.object({
  prompt: z.string().min(10, "Share more detail"),
  settings: composerSettingsSchema
});

export const documentSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  tone: z.string().optional()
});

