import "server-only";
import { headers } from "next/headers";
import { env } from "@/env";
import type { AuditContext } from "@/lib/audit";
import type { RequestMeta } from "@/server/auth/service";

/** Client IP, user agent and request id of the current request. */
export async function requestMeta(): Promise<RequestMeta> {
  const h = await headers();
  const configured = h.get(env().CLIENT_IP_HEADER);
  // x-forwarded-for may hold "client, proxy1, proxy2"; the first entry is the client.
  const ip = configured?.split(",")[0]?.trim() || (env().NODE_ENV === "development" ? "127.0.0.1" : null);
  return {
    ip,
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
    requestId: h.get("x-nf-request-id") ?? crypto.randomUUID(),
  };
}

export async function auditContextFor(user: { id: string; email: string }): Promise<AuditContext> {
  const meta = await requestMeta();
  return { actorId: user.id, actorLabel: user.email, ...meta };
}
