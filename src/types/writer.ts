import { ComposerSettingsInput } from "@/lib/validators";

export type OutputPlaceholder = {
  id: string;
  label: string;
};

export type DocumentFolderReference = {
  id: string;
  name: string;
};

export type WriterOutput = {
  id: string;
  /**
   * Stable client-side key used to keep the editor mounted even if the server id changes.
   * Defaults to the initial client id.
   */
  instanceKey?: string;
  title: string;
  content: string;
  createdAt: string;
  settings: ComposerSettingsInput;
  prompt: string;
  placeholderValues?: Record<string, string>;
  placeholderMeta?: OutputPlaceholder[];
  isPending?: boolean;
  writingStyle?: string | null;
  styleTitle?: string | null;
  pinned?: boolean;
  folders?: DocumentFolderReference[];
};

export type FolderSummary = {
  id: string;
  name: string;
  createdAt: string;
  documentCount: number;
  pinned?: boolean;
};

