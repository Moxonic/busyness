import { desc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLog, company, settings } from "@/db/schema";
import { recordEvent, verifyAuditChain, withAudit } from "@/lib/audit";
import { expectDbError, ownerSql, systemCtx } from "../helpers";

async function latestAudit() {
  return (await db().select().from(auditLog).orderBy(desc(auditLog.seq)).limit(1))[0];
}

describe("audit log", () => {
  it("records every change made through withAudit, with the actor", async () => {
    const ctx = { actorId: null, actorLabel: "kari@example.test", ip: "10.1.1.1", requestId: "req-1" };
    await withAudit(ctx, (tx) => tx.update(company).set({ name: "Audit Test AS" }).where(eq(company.id, 1)));
    const row = await latestAudit();
    expect(row.action).toBe("update");
    expect(row.entityType).toBe("company");
    expect(row.actorLabel).toBe("kari@example.test");
    expect(row.ip).toBe("10.1.1.1");
    expect((row.before as { name: string }).name).not.toBe("Audit Test AS");
    expect((row.after as { name: string }).name).toBe("Audit Test AS");
  });

  it("rejects changes to audited tables made without an audit context", async () => {
    await expectDbError(db().update(company).set({ name: "Sneaky" }).where(eq(company.id, 1)), /Audit context missing/);
  });

  it("rolls back the audit row together with a failed change", async () => {
    const before = (await latestAudit()).seq;
    await expect(
      withAudit(systemCtx, async (tx) => {
        await tx.insert(settings).values({ key: "rollback.test", value: 1 });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect((await latestAudit()).seq).toBe(before);
  });

  it("is append-only for the application role", async () => {
    await recordEvent(db(), systemCtx, { action: "test.event" });
    await expectDbError(db().update(auditLog).set({ action: "changed" }), /permission denied/);
    await expectDbError(db().delete(auditLog), /permission denied/);
  });

  it("is append-only even for the database owner (trigger)", async () => {
    const sql = ownerSql();
    try {
      await expect(sql`update audit_log set action = 'x'`).rejects.toThrow(/append-only/);
      await expect(sql`delete from audit_log`).rejects.toThrow(/append-only/);
      await expect(sql`truncate audit_log`).rejects.toThrow(/append-only/);
    } finally {
      await sql.end();
    }
  });

  it("keeps an intact hash chain under concurrent writes", async () => {
    await Promise.all(
      Array.from({ length: 25 }, (_, i) => recordEvent(db(), systemCtx, { action: "test.concurrent", details: { i } })),
    );
    const result = await verifyAuditChain();
    expect(result.ok).toBe(true);
    expect(result.checked).toBeGreaterThan(25);
  });

  it("detects tampering by someone who bypasses the triggers", async () => {
    const sql = ownerSql();
    try {
      const outcome = await sql
        .begin(async (tx) => {
          await tx`alter table audit_log disable trigger audit_log_no_update`;
          await tx`update audit_log set action = 'forged' where seq = (select min(seq) from audit_log)`;
          const [r] = await tx`select * from audit_verify_chain()`;
          throw Object.assign(new Error("rollback"), { r });
        })
        .catch((e: { r?: { first_bad_seq: string | null } }) => e.r);
      expect(outcome?.first_bad_seq).not.toBeNull();
    } finally {
      await sql.end();
    }
    expect((await verifyAuditChain()).ok).toBe(true); // the tampering was rolled back
  });

  it("never copies secret columns into the log", async () => {
    const rows = await db().select().from(auditLog).where(eq(auditLog.entityType, "users")).limit(50);
    for (const r of rows) {
      for (const j of [r.before, r.after] as (Record<string, unknown> | null)[]) {
        if (!j) continue;
        expect(j).not.toHaveProperty("password_hash");
        expect(j).not.toHaveProperty("totp_secret_enc");
      }
    }
  });
});
