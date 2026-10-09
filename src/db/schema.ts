import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const userRole = pgEnum("user_role", ["owner", "employee", "accountant"]);
export const userStatus = pgEnum("user_status", ["active", "deactivated", "anonymized"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(), // always stored lower-case
  name: text("name").notNull(),
  role: userRole("role").notNull(),
  status: userStatus("status").notNull().default("active"),
  passwordHash: text("password_hash"),
  passwordChangedAt: ts("password_changed_at"),
  googleSub: text("google_sub").unique(),
  // AES-256-GCM encrypted TOTP secret. Set but not enabled = enrolment in progress.
  totpSecretEnc: text("totp_secret_enc"),
  totpEnabledAt: ts("totp_enabled_at"),
  // Last accepted TOTP time step; codes for this step or earlier are rejected (replay protection).
  totpLastStep: bigint("totp_last_step", { mode: "number" }),
  locale: text("locale").notNull().default("nb"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  deactivatedAt: ts("deactivated_at"),
});

export const recoveryCodes = pgTable(
  "recovery_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: ts("used_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("recovery_codes_user_idx").on(t.userId)],
);

export const sessions = pgTable(
  "sessions",
  {
    // SHA-256 of the token in the cookie. The raw token is never stored.
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
    // Null until the second factor has been verified. Unverified sessions can only reach the 2FA pages.
    mfaVerifiedAt: ts("mfa_verified_at"),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    role: userRole("role").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: uuid("invited_by").references(() => users.id),
    expiresAt: ts("expires_at").notNull(),
    acceptedAt: ts("accepted_at"),
    revokedAt: ts("revoked_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("invitations_email_idx").on(t.email)],
);

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: text("id").primaryKey(), // SHA-256 of the emailed token
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  windowStart: ts("window_start").notNull(),
});

export const company = pgTable(
  "company",
  {
    id: smallint("id").primaryKey().default(1),
    name: text("name").notNull().default(""),
    orgNumber: text("org_number").notNull().default(""),
    legalForm: text("legal_form"), // 'ENK' | 'AS', used from phase 4 onwards
    addressLine: text("address_line").notNull().default(""),
    postalCode: text("postal_code").notNull().default(""),
    city: text("city").notNull().default(""),
    country: text("country").notNull().default("NO"),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [check("company_single_row", sql`${t.id} = 1`)],
);

/** Rules that may change or that I am not certain about live here, never hard-coded. */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  description: text("description").notNull().default(""),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const files = pgTable("files", {
  id: uuid("id").primaryKey().defaultRandom(),
  storageKey: text("storage_key").notNull().unique(),
  originalName: text("original_name").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  sha256: text("sha256").notNull(),
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  createdAt: ts("created_at").notNull().defaultNow(),
  // Earliest date the file may be deleted (bookkeeping retention). Null = keep.
  retainUntil: date("retain_until", { mode: "string" }),
});

/**
 * Append-only, hash-chained audit trail. Rows are written by database triggers
 * (row changes) or by recordEvent() (logins, exports...). The columns `seq`,
 * `occurred_at`, `prev_hash` and `hash` are always overwritten by the
 * `audit_log_chain` trigger, so the defaults below are placeholders.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    seq: bigint("seq", { mode: "number" }).primaryKey().default(0),
    occurredAt: ts("occurred_at").notNull().defaultNow(),
    actorUserId: uuid("actor_user_id"),
    actorLabel: text("actor_label").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    requestId: text("request_id"),
    prevHash: text("prev_hash").notNull().default(""),
    hash: text("hash").notNull().default(""),
  },
  (t) => [
    index("audit_log_actor_idx").on(t.actorUserId),
    index("audit_log_entity_idx").on(t.entityType, t.entityId),
    index("audit_log_occurred_idx").on(t.occurredAt),
  ],
);

export type User = typeof users.$inferSelect;
export type Role = (typeof userRole.enumValues)[number];
export type AuditRow = typeof auditLog.$inferSelect;
