/**
 * Fix legacy character asset URLs (.jpg -> .png) after transparent PNG migration.
 * Run: npx tsx scripts/fix-character-urls.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const assets = await prisma.characterAsset.findMany();
  let n = 0;
  for (const a of assets) {
    const url = a.url.replace(/\.jpe?g$/i, ".png");
    const filename = a.filename.replace(/\.jpe?g$/i, ".png");
    if (url !== a.url || a.mimeType !== "image/png") {
      await prisma.characterAsset.update({
        where: { id: a.id },
        data: {
          url,
          filename,
          mimeType: a.type === "VIDEO" ? a.mimeType : "image/png",
          type: a.type === "VIDEO" ? "VIDEO" : "IMAGE",
        },
      });
      n += 1;
      console.log("fixed", a.state, a.url, "->", url);
    }
  }
  console.log(`Done. Updated ${n} asset(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
