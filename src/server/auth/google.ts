import "server-only";
import { Google } from "arctic";
import { env } from "@/env";

export const GOOGLE_COOKIES = { state: "g_state", verifier: "g_verifier", invite: "g_invite" } as const;

export function googleClient(): Google {
  const e = env();
  return new Google(e.GOOGLE_CLIENT_ID, e.GOOGLE_CLIENT_SECRET, `${e.APP_URL}/api/auth/google/callback`);
}

export function oauthCookieOptions() {
  return {
    httpOnly: true,
    secure: env().NODE_ENV === "production",
    sameSite: "lax" as const, // must survive the top-level redirect back from Google
    path: "/",
    maxAge: 600,
  };
}
