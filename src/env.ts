import { z } from "zod";

const bool = z
  .enum(["true", "false"])
  .default("true")
  .transform((v) => v === "true");

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_URL: z.url().transform((u) => u.replace(/\/$/, "")),
    DATABASE_URL: z.string().startsWith("postgres"),
    ENCRYPTION_KEY: z
      .string()
      .refine((k) => Buffer.from(k, "base64").length === 32, "must be 32 random bytes, base64-encoded"),
    GOOGLE_CLIENT_ID: z.string().optional().default(""),
    GOOGLE_CLIENT_SECRET: z.string().optional().default(""),
    MAIL_TRANSPORT: z.enum(["smtp", "console"]).default("smtp"),
    SMTP_URL: z.string().optional().default(""),
    MAIL_FROM: z.string().min(3),
    STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
    STORAGE_LOCAL_DIR: z.string().default(".data/files"),
    S3_ENDPOINT: z.string().optional().default(""),
    S3_REGION: z.string().default("auto"),
    S3_BUCKET: z.string().optional().default(""),
    S3_ACCESS_KEY_ID: z.string().optional().default(""),
    S3_SECRET_ACCESS_KEY: z.string().optional().default(""),
    SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(120),
    SESSION_MAX_HOURS: z.coerce.number().int().min(1).max(72).default(12),
    CLIENT_IP_HEADER: z.string().default("x-nf-client-connection-ip"),
    HIBP_ENABLED: bool,
    DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
  })
  .superRefine((e, ctx) => {
    if (e.MAIL_TRANSPORT === "smtp" && !e.SMTP_URL) {
      ctx.addIssue({ code: "custom", path: ["SMTP_URL"], message: "required when MAIL_TRANSPORT=smtp" });
    }
    if (e.STORAGE_DRIVER === "s3") {
      for (const k of ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const) {
        if (!e[k]) ctx.addIssue({ code: "custom", path: [k], message: "required when STORAGE_DRIVER=s3" });
      }
    }
    if (e.NODE_ENV === "production") {
      if (!e.APP_URL.startsWith("https://")) {
        ctx.addIssue({ code: "custom", path: ["APP_URL"], message: "must use https in production" });
      }
      if (e.STORAGE_DRIVER !== "s3") {
        // Netlify functions have no persistent disk; local files would be lost.
        ctx.addIssue({ code: "custom", path: ["STORAGE_DRIVER"], message: "must be s3 in production" });
      }
      if (e.MAIL_TRANSPORT !== "smtp") {
        ctx.addIssue({ code: "custom", path: ["MAIL_TRANSPORT"], message: "must be smtp in production" });
      }
    }
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/**
 * Validated configuration. Parsed lazily so `next build` does not need runtime secrets;
 * `src/instrumentation.ts` calls this at server start so a misconfigured server refuses to boot.
 */
export function env(): Env {
  if (!cached) {
    const result = schema.safeParse(process.env);
    if (!result.success) {
      const problems = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
      throw new Error(`Invalid or missing environment variables:\n${problems}`);
    }
    cached = result.data;
  }
  return cached;
}

export function googleLoginEnabled(): boolean {
  const e = env();
  return Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET);
}
