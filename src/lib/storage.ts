import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { files } from "@/db/schema";
import { env } from "@/env";
import { withAudit, type AuditContext } from "./audit";
import { sha256Hex } from "./crypto";

/** Where document bytes live. The database only holds metadata and a SHA-256 fingerprint. */
export interface FileStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
}

export class LocalDiskStorage implements FileStorage {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Invalid storage key");
    return full;
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, bytes, { flag: "wx" }); // never overwrite
  }

  async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.resolve(key)));
  }
}

/** Any S3-compatible service: Cloudflare R2 (production), Backblaze B2, MinIO... */
export class S3Storage implements FileStorage {
  private client: S3Client;
  constructor(
    private readonly bucket: string,
    opts: { endpoint: string; region: string; accessKeyId: string; secretAccessKey: string },
  ) {
    this.client = new S3Client({
      endpoint: opts.endpoint,
      region: opts.region,
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
    });
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType, IfNoneMatch: "*" }),
    );
  }

  async get(key: string): Promise<Uint8Array> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`Empty object: ${key}`);
    return res.Body.transformToByteArray();
  }
}

let storage: FileStorage | undefined;
export function getStorage(): FileStorage {
  if (!storage) {
    const e = env();
    storage =
      e.STORAGE_DRIVER === "s3"
        ? new S3Storage(e.S3_BUCKET, {
            endpoint: e.S3_ENDPOINT,
            region: e.S3_REGION,
            accessKeyId: e.S3_ACCESS_KEY_ID,
            secretAccessKey: e.S3_SECRET_ACCESS_KEY,
          })
        : new LocalDiskStorage(e.STORAGE_LOCAL_DIR);
  }
  return storage;
}

export const MAX_FILE_BYTES = 15 * 1024 * 1024;

/** Stores a document and records it (audited). Returns the file id. */
export async function storeFile(
  ctx: AuditContext,
  input: { name: string; contentType: string; bytes: Uint8Array },
  store: FileStorage = getStorage(),
): Promise<string> {
  if (input.bytes.byteLength > MAX_FILE_BYTES) throw new Error("File too large");
  const id = crypto.randomUUID();
  const now = new Date();
  const key = `files/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${id}`;
  // Bytes first: if the database insert then fails, an unreferenced object remains (harmless),
  // never a database row pointing at a missing file.
  await store.put(key, input.bytes, input.contentType);
  await withAudit(ctx, (tx) =>
    tx.insert(files).values({
      id,
      storageKey: key,
      originalName: input.name.slice(0, 255),
      contentType: input.contentType,
      sizeBytes: input.bytes.byteLength,
      sha256: sha256Hex(input.bytes),
      uploadedBy: ctx.actorId,
    }),
  );
  return id;
}

export class FileIntegrityError extends Error {}

/** Reads a document and checks it still matches the fingerprint taken when it was stored. */
export async function readFileVerified(id: string, store: FileStorage = getStorage()) {
  const meta = await db().query.files.findFirst({ where: eq(files.id, id) });
  if (!meta) return null;
  const bytes = await store.get(meta.storageKey);
  if (sha256Hex(bytes) !== meta.sha256) {
    throw new FileIntegrityError(`File ${id} does not match its recorded SHA-256 fingerprint`);
  }
  return { meta, bytes };
}
