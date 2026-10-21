import { createHash } from "crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";

function dbPathFromUrl(url: string) {
  const match = url.match(/^file:(.+)$/);
  if (!match?.[1]) return null;
  const raw = match[1];
  if (raw.startsWith("/")) return raw;
  // prisma relative paths are relative to prisma/
  return resolve(process.cwd(), "prisma", raw.replace(/^\.\//, ""));
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? "file:./data/yani.db";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = resolve(process.cwd(), process.env.CRM_BACKUP_DIR ?? "backups/crm");
  mkdirSync(outDir, { recursive: true });

  if (databaseUrl.startsWith("file:")) {
    const dbPath = dbPathFromUrl(databaseUrl);
    if (!dbPath || !existsSync(dbPath)) {
      throw new Error(`SQLite файл не найден: ${dbPath ?? databaseUrl}`);
    }
    const target = join(outDir, `yani-${stamp}.db`);
    copyFileSync(dbPath, target);
    // Also copy WAL/SHM if present for crash-consistent local backups.
    for (const suffix of ["-wal", "-shm"]) {
      const side = `${dbPath}${suffix}`;
      if (existsSync(side)) copyFileSync(side, `${target}${suffix}`);
    }
    const hash = createHash("sha256").update(readFileSync(target)).digest("hex");
    writeFileSync(
      join(outDir, `yani-${stamp}.meta.json`),
      JSON.stringify(
        {
          engine: "sqlite",
          source: dbPath,
          target,
          sha256: hash,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    console.log(`[crm-backup] sqlite -> ${target}`);
    console.log(`[crm-backup] sha256 ${hash}`);
    return;
  }

  if (databaseUrl.startsWith("postgres")) {
    const target = join(outDir, `yani-${stamp}.sql`);
    const { spawnSync } = await import("child_process");
    const result = spawnSync("pg_dump", [databaseUrl, "-f", target], { encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(result.stderr || "pg_dump failed — установите client tools");
    }
    writeFileSync(
      join(outDir, `yani-${stamp}.meta.json`),
      JSON.stringify(
        {
          engine: "postgresql",
          target,
          createdAt: new Date().toISOString(),
          note: "Для production используйте управляемые бэкапы провайдера БД",
        },
        null,
        2,
      ),
    );
    console.log(`[crm-backup] postgres -> ${target}`);
    return;
  }

  throw new Error(`Неподдерживаемый DATABASE_URL: ${databaseUrl.slice(0, 32)}`);
}

main().catch((cause) => {
  console.error("[crm-backup]", cause instanceof Error ? cause.message : cause);
  process.exit(1);
});
