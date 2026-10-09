import { requireUser } from "@/server/auth/dal";
import { auditContextFor } from "@/server/request";
import { exportUserData } from "@/server/users/service";
import { jsonDownload } from "@/server/download";

/** GDPR: a user downloads everything stored about themselves. */
export async function GET() {
  const user = await requireUser();
  const data = await exportUserData(await auditContextFor(user), user.id);
  return jsonDownload(data, "mine-data");
}
