-- Add a concise style summary to documents (used for saved styles)
ALTER TABLE `Document`
ADD COLUMN `styleSummary` VARCHAR(200) NULL;

