-- Check if Brand table exists, if so rename it to Persona
SET @brand_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Brand');
SET @sql_brand = IF(@brand_exists > 0, 'RENAME TABLE `Brand` TO `Persona`', 'SELECT 1');
PREPARE stmt_brand FROM @sql_brand;
EXECUTE stmt_brand;
DEALLOCATE PREPARE stmt_brand;

-- Check if BrandKeyMessaging table exists, if so rename it to PersonaKeyMessaging
SET @bkm_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'BrandKeyMessaging');
SET @sql_bkm = IF(@bkm_exists > 0, 'RENAME TABLE `BrandKeyMessaging` TO `PersonaKeyMessaging`', 'SELECT 1');
PREPARE stmt_bkm FROM @sql_bkm;
EXECUTE stmt_bkm;
DEALLOCATE PREPARE stmt_bkm;

-- Rename User table columns (only if they exist)
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'User' AND COLUMN_NAME = 'brandName');
SET @sql_col1 = IF(@col_exists > 0, 'ALTER TABLE `User` CHANGE COLUMN `brandName` `personaName` VARCHAR(100) NULL', 'SELECT 1');
PREPARE stmt_col1 FROM @sql_col1;
EXECUTE stmt_col1;
DEALLOCATE PREPARE stmt_col1;

SET @col_exists2 = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'User' AND COLUMN_NAME = 'brandInfo');
SET @sql_col2 = IF(@col_exists2 > 0, 'ALTER TABLE `User` CHANGE COLUMN `brandInfo` `personaInfo` VARCHAR(400) NULL', 'SELECT 1');
PREPARE stmt_col2 FROM @sql_col2;
EXECUTE stmt_col2;
DEALLOCATE PREPARE stmt_col2;

SET @col_exists3 = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'User' AND COLUMN_NAME = 'activeBrandId');
SET @sql_col3 = IF(@col_exists3 > 0, 'ALTER TABLE `User` CHANGE COLUMN `activeBrandId` `activePersonaId` VARCHAR(191) NULL', 'SELECT 1');
PREPARE stmt_col3 FROM @sql_col3;
EXECUTE stmt_col3;
DEALLOCATE PREPARE stmt_col3;

-- Drop and recreate foreign key constraint for activePersonaId (only if it exists)
SET @fk_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'User' AND COLUMN_NAME = 'activeBrandId' AND CONSTRAINT_NAME = 'User_activeBrandId_fkey');
SET @sql_fk1 = IF(@fk_exists > 0, 'ALTER TABLE `User` DROP FOREIGN KEY `User_activeBrandId_fkey`', 'SELECT 1');
PREPARE stmt_fk1 FROM @sql_fk1;
EXECUTE stmt_fk1;
DEALLOCATE PREPARE stmt_fk1;

-- Add new foreign key constraint (only if it doesn't exist)
SET @fk_exists_new = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'User' AND COLUMN_NAME = 'activePersonaId' AND CONSTRAINT_NAME = 'User_activePersonaId_fkey');
SET @sql_fk1_new = IF(@fk_exists_new = 0, 'ALTER TABLE `User` ADD CONSTRAINT `User_activePersonaId_fkey` FOREIGN KEY (`activePersonaId`) REFERENCES `Persona`(`id`) ON DELETE SET NULL ON UPDATE CASCADE', 'SELECT 1');
PREPARE stmt_fk1_new FROM @sql_fk1_new;
EXECUTE stmt_fk1_new;
DEALLOCATE PREPARE stmt_fk1_new;

-- For PersonaKeyMessaging: Find the actual FK constraint name and drop it
-- Create a temporary table to store the constraint name
CREATE TEMPORARY TABLE IF NOT EXISTS temp_fk_name (constraint_name VARCHAR(255));
DELETE FROM temp_fk_name;
INSERT INTO temp_fk_name SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PersonaKeyMessaging' AND COLUMN_NAME = 'brandId' AND REFERENCED_TABLE_NAME IS NOT NULL LIMIT 1;
SET @fk_name_var = (SELECT constraint_name FROM temp_fk_name LIMIT 1);
SET @drop_fk_sql = IF(@fk_name_var IS NOT NULL, CONCAT('ALTER TABLE `PersonaKeyMessaging` DROP FOREIGN KEY `', @fk_name_var, '`'), 'SELECT 1');
PREPARE drop_fk_stmt FROM @drop_fk_sql;
EXECUTE drop_fk_stmt;
DEALLOCATE PREPARE drop_fk_stmt;
DROP TEMPORARY TABLE IF EXISTS temp_fk_name;

-- Drop the index (only if it exists)
SET @idx_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PersonaKeyMessaging' AND INDEX_NAME = 'BrandKeyMessaging_brandId_idx');
SET @sql_idx = IF(@idx_exists > 0, 'ALTER TABLE `PersonaKeyMessaging` DROP INDEX `BrandKeyMessaging_brandId_idx`', 'SELECT 1');
PREPARE stmt_idx FROM @sql_idx;
EXECUTE stmt_idx;
DEALLOCATE PREPARE stmt_idx;

-- Rename PersonaKeyMessaging column (only if brandId exists)
SET @col_exists_bkm = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PersonaKeyMessaging' AND COLUMN_NAME = 'brandId');
SET @sql_col_bkm = IF(@col_exists_bkm > 0, 'ALTER TABLE `PersonaKeyMessaging` CHANGE COLUMN `brandId` `personaId` VARCHAR(191) NULL', 'SELECT 1');
PREPARE stmt_col_bkm FROM @sql_col_bkm;
EXECUTE stmt_col_bkm;
DEALLOCATE PREPARE stmt_col_bkm;

-- Recreate index with new name (only if it doesn't exist)
SET @idx_exists_new = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PersonaKeyMessaging' AND INDEX_NAME = 'PersonaKeyMessaging_personaId_idx');
SET @sql_idx_new = IF(@idx_exists_new = 0, 'ALTER TABLE `PersonaKeyMessaging` ADD INDEX `PersonaKeyMessaging_personaId_idx`(`personaId`)', 'SELECT 1');
PREPARE stmt_idx_new FROM @sql_idx_new;
EXECUTE stmt_idx_new;
DEALLOCATE PREPARE stmt_idx_new;

-- Recreate foreign key constraint for personaId (only if it doesn't exist)
SET @fk_exists_bkm_new = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PersonaKeyMessaging' AND CONSTRAINT_NAME = 'PersonaKeyMessaging_personaId_fkey');
SET @sql_fk_bkm_new = IF(@fk_exists_bkm_new = 0, 'ALTER TABLE `PersonaKeyMessaging` ADD CONSTRAINT `PersonaKeyMessaging_personaId_fkey` FOREIGN KEY (`personaId`) REFERENCES `Persona`(`id`) ON DELETE CASCADE ON UPDATE CASCADE', 'SELECT 1');
PREPARE stmt_fk_bkm_new FROM @sql_fk_bkm_new;
EXECUTE stmt_fk_bkm_new;
DEALLOCATE PREPARE stmt_fk_bkm_new;

-- Drop and recreate foreign key constraint for ownerId in Persona (if it exists with Brand prefix)
SET @fk_name_owner = (SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Persona' AND COLUMN_NAME = 'ownerId' AND REFERENCED_TABLE_NAME = 'User' LIMIT 1);
SET @sql_owner = IF(@fk_name_owner IS NOT NULL AND @fk_name_owner LIKE '%Brand%', CONCAT('ALTER TABLE `Persona` DROP FOREIGN KEY `', @fk_name_owner, '`'), 'SELECT 1');
PREPARE stmt_owner FROM @sql_owner;
EXECUTE stmt_owner;
DEALLOCATE PREPARE stmt_owner;

-- Add new foreign key constraint for ownerId (only if it doesn't already exist)
SET @fk_exists_owner_after = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Persona' AND COLUMN_NAME = 'ownerId' AND CONSTRAINT_NAME = 'Persona_ownerId_fkey');
SET @sql_owner_new = IF(@fk_exists_owner_after = 0, 'ALTER TABLE `Persona` ADD CONSTRAINT `Persona_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE', 'SELECT 1');
PREPARE stmt_owner_new FROM @sql_owner_new;
EXECUTE stmt_owner_new;
DEALLOCATE PREPARE stmt_owner_new;
