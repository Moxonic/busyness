import "server-only";
import { cookies } from "next/headers";
import { env } from "@/env";

// "__Host-" cookies are only accepted over HTTPS, for this exact host, with path "/":
// they cannot be set by a subdomain or over plain HTTP.
export function sessionCookieName(): string {
  return env().NODE_ENV === "production" ? "__Host-session" : "session";
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(sessionCookieName(), token, {
    httpOnly: true,
    secure: env().NODE_ENV === "production",
    // Lax (not Strict) so the cookie survives the redirect back from Google and links in emails.
    // CSRF is still blocked: every state change is a POST, and Next.js rejects Server Actions
    // whose Origin header does not match the host.
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function getSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(sessionCookieName())?.value;
}

export async function deleteSessionCookie(): Promise<void> {
  (await cookies()).delete(sessionCookieName());
}
