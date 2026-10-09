// Verifies the audit log hash chain. Exit code 1 if it has been tampered with.
import "./lib/load-env";
import { closeDb } from "@/db";
import { verifyAuditChain } from "@/lib/audit";

const r = await verifyAuditChain();
await closeDb();
if (r.ok) {
  console.log(`Audit log intact: ${r.checked} entries. Head hash: ${r.headHash}`);
} else {
  console.error(`AUDIT LOG BROKEN at entry #${r.firstBadSeq} (${r.checked} entries checked).`);
  process.exit(1);
}
