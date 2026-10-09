import { writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { files } from "@/db/schema";
import { withAudit } from "@/lib/audit";
import { FileIntegrityError, LocalDiskStorage, readFileVerified, storeFile } from "@/lib/storage";
import { expectDbError, systemCtx } from "../helpers";

describe("document storage", () => {
  const store = new LocalDiskStorage(process.env.STORAGE_LOCAL_DIR!);

  it("stores a file and reads it back verified", async () => {
    const bytes = new TextEncoder().encode("Bilag 1: kvittering");
    const id = await storeFile(systemCtx, { name: "kvittering.txt", contentType: "text/plain", bytes }, store);
    const read = await readFileVerified(id, store);
    expect(new TextDecoder().decode(read!.bytes)).toBe("Bilag 1: kvittering");
  });

  it("detects a file changed behind the system's back", async () => {
    const id = await storeFile(
      systemCtx,
      { name: "a.txt", contentType: "text/plain", bytes: new TextEncoder().encode("original") },
      store,
    );
    const meta = (await db().select().from(files).where(eq(files.id, id)))[0];
    await writeFile(path.resolve(process.env.STORAGE_LOCAL_DIR!, meta.storageKey), "tampered");
    await expect(readFileVerified(id, store)).rejects.toBeInstanceOf(FileIntegrityError);
  });

  it("does not allow changing a file's fingerprint or deleting it before its retention date", async () => {
    const id = await storeFile(
      systemCtx,
      { name: "b.txt", contentType: "text/plain", bytes: new TextEncoder().encode("keep me") },
      store,
    );
    await expectDbError(
      withAudit(systemCtx, (tx) => tx.update(files).set({ sha256: "0".repeat(64) }).where(eq(files.id, id))),
      /cannot be changed/,
    );
    await expectDbError(withAudit(systemCtx, (tx) => tx.delete(files).where(eq(files.id, id))), /retention date/);
  });
});
