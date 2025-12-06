-- AlterTable
ALTER TABLE `BrandKeyMessaging` ADD COLUMN `brandId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `BrandKeyMessaging_brandId_idx` ON `BrandKeyMessaging`(`brandId`);

-- AddForeignKey
ALTER TABLE `BrandKeyMessaging` ADD CONSTRAINT `BrandKeyMessaging_brandId_fkey` FOREIGN KEY (`brandId`) REFERENCES `Brand`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


