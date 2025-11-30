import { ComposerSettingsInput } from "@/lib/validators";

export type OutputPlaceholder = {
  id: string;
  label: string;
};

export type WriterOutput = {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  settings: ComposerSettingsInput;
  prompt: string;
  placeholderValues?: Record<string, string>;
  placeholderMeta?: OutputPlaceholder[];
};

