-- Add pinned flag to folders for pinning UI
ALTER TABLE `Folder` ADD COLUMN `pinned` BOOLEAN NOT NULL DEFAULT 0;

