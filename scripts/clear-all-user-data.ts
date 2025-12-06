import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function clearAllUserData() {
  console.log("🚨 Starting to clear all user documents, styles, and brands...\n");

  try {
    // Count before deletion
    const docCount = await prisma.document.count();
    const brandCount = await prisma.brand.count();
    const keyMessagingCount = await prisma.brandKeyMessaging.count();
    const folderCount = await prisma.folder.count();
    const documentFolderCount = await prisma.documentFolder.count();

    console.log(`📊 Current counts:`);
    console.log(`   Documents: ${docCount}`);
    console.log(`   Brands: ${brandCount}`);
    console.log(`   Brand Key Messages: ${keyMessagingCount}`);
    console.log(`   Folders: ${folderCount}`);
    console.log(`   Document-Folder links: ${documentFolderCount}\n`);

    // Delete in order to respect foreign key constraints
    // 1. Delete DocumentFolder links (junction table)
    console.log("🗑️  Deleting document-folder links...");
    const deletedDocFolders = await prisma.documentFolder.deleteMany({});
    console.log(`   ✓ Deleted ${deletedDocFolders.count} document-folder links`);

    // 2. Delete Documents (includes styles - styles are just documents with styleTitle)
    console.log("🗑️  Deleting all documents (including styles)...");
    const deletedDocs = await prisma.document.deleteMany({});
    console.log(`   ✓ Deleted ${deletedDocs.count} documents`);

    // 3. Delete BrandKeyMessaging (cascades with brands, but delete orphaned ones too)
    console.log("🗑️  Deleting brand key messaging...");
    const deletedKeyMessages = await prisma.brandKeyMessaging.deleteMany({});
    console.log(`   ✓ Deleted ${deletedKeyMessages.count} brand key messages`);

    // 4. Delete Brands (this will also clear activeBrandId references via cascade)
    console.log("🗑️  Deleting all brands...");
    const deletedBrands = await prisma.brand.deleteMany({});
    console.log(`   ✓ Deleted ${deletedBrands.count} brands`);

    // 5. Delete Folders
    console.log("🗑️  Deleting all folders...");
    const deletedFolders = await prisma.folder.deleteMany({});
    console.log(`   ✓ Deleted ${deletedFolders.count} folders`);

    // 6. Clear activeBrandId from all users (set to null)
    console.log("🗑️  Clearing activeBrandId from users...");
    const updatedUsers = await prisma.user.updateMany({
      data: { activeBrandId: null }
    });
    console.log(`   ✓ Cleared activeBrandId from ${updatedUsers.count} users`);

    // 7. Clear legacy brand fields from users (optional - for cleanup)
    console.log("🗑️  Clearing legacy brand fields from users...");
    const clearedLegacyBrands = await prisma.user.updateMany({
      data: { brandName: null, brandInfo: null }
    });
    console.log(`   ✓ Cleared legacy brand fields from ${clearedLegacyBrands.count} users`);

    console.log("\n✅ Successfully cleared all user documents, styles, and brands!");
    console.log("\n📊 Summary:");
    console.log(`   Documents deleted: ${deletedDocs.count}`);
    console.log(`   Brands deleted: ${deletedBrands.count}`);
    console.log(`   Brand key messages deleted: ${deletedKeyMessages.count}`);
    console.log(`   Folders deleted: ${deletedFolders.count}`);
    console.log(`   Document-folder links deleted: ${deletedDocFolders.count}`);

  } catch (error) {
    console.error("❌ Error clearing user data:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
clearAllUserData()
  .then(() => {
    console.log("\n✨ Done!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n💥 Script failed:", error);
    process.exit(1);
  });
