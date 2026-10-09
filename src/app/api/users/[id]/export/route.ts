import { z } from "zod";
import { requirePermission } from "@/server/auth/dal";
import { jsonDownload } from "@/server/download";
import { auditContextFor } from "@/server/request";
import { exportUserData } from "@/server/users/service";

/** GDPR: the owner exports the data of another (possibly former) user on request. */
export async function GET(_: Request, { params }: RouteContext<"/api/users/[id]/export">) {
  const user = await requirePermission("gdpr:manage");
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return new Response("Not found", { status: 404 });
  const data = await exportUserData(await auditContextFor(user), id.data);
  if (!data) return new Response("Not found", { status: 404 });
  return jsonDownload(data, `brukerdata-${id.data.slice(0, 8)}`);
}
