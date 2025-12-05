-- Create Brand table
CREATE TABLE `Brand` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(100) NULL,
    `info` VARCHAR(400) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Brand_ownerId_idx`(`ownerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Add activeBrandId to User table
ALTER TABLE `User` ADD COLUMN `activeBrandId` VARCHAR(191) NULL;

-- Add foreign key constraint for activeBrandId
ALTER TABLE `User` ADD CONSTRAINT `User_activeBrandId_fkey` FOREIGN KEY (`activeBrandId`) REFERENCES `Brand`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

