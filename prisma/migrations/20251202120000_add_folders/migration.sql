-- CreateTable Folder
CREATE TABLE `Folder` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `ownerId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable DocumentFolder (join table)
CREATE TABLE `DocumentFolder` (
  `documentId` VARCHAR(191) NOT NULL,
  `folderId` VARCHAR(191) NOT NULL,
  `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`documentId`, `folderId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Indexes for Folder
CREATE UNIQUE INDEX `Folder_ownerId_name_key` ON `Folder`(`ownerId`, `name`);
CREATE INDEX `Folder_ownerId_idx` ON `Folder`(`ownerId`);

-- Indexes for DocumentFolder
CREATE INDEX `DocumentFolder_documentId_idx` ON `DocumentFolder`(`documentId`);
CREATE INDEX `DocumentFolder_folderId_idx` ON `DocumentFolder`(`folderId`);

-- Foreign Keys
ALTER TABLE `Folder`
  ADD CONSTRAINT `Folder_ownerId_fkey`
  FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `DocumentFolder`
  ADD CONSTRAINT `DocumentFolder_documentId_fkey`
  FOREIGN KEY (`documentId`) REFERENCES `Document`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `DocumentFolder`
  ADD CONSTRAINT `DocumentFolder_folderId_fkey`
  FOREIGN KEY (`folderId`) REFERENCES `Folder`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

