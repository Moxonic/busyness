import { decodeIdToken } from "arctic";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { env, googleLoginEnabled } from "@/env";
import { setSessionCookie } from "@/server/auth/cookies";
import { GOOGLE_COOKIES, googleClient } from "@/server/auth/google";
import { loginWithGoogle } from "@/server/auth/service";
import { requestMeta } from "@/server/request";

type IdTokenClaims = { iss?: string; aud?: string; sub?: string; email?: string; email_verified?: boolean; name?: string };

function to(path: string) {
  return NextResponse.redirect(new URL(path, env().APP_URL));
}

export async function GET(request: NextRequest) {
  if (!googleLoginEnabled()) return new NextResponse("Not found", { status: 404 });
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const jar = await cookies();
  const storedState = jar.get(GOOGLE_COOKIES.state)?.value;
  const verifier = jar.get(GOOGLE_COOKIES.verifier)?.value;
  const invite = jar.get(GOOGLE_COOKIES.invite)?.value ?? null;
  for (const name of Object.values(GOOGLE_COOKIES)) jar.delete(name);

  // The state check stops an attacker from logging the victim into the attacker's account (login CSRF).
  if (!code || !state || !storedState || state !== storedState || !verifier) return to("/login?error=googleFailed");

  let claims: IdTokenClaims;
  try {
    const tokens = await googleClient().validateAuthorizationCode(code, verifier);
    // The ID token came straight from Google's token endpoint over TLS, so its signature
    // need not be re-verified (OpenID Connect Core 3.1.3.7); we still check who it is for.
    claims = decodeIdToken(tokens.idToken()) as IdTokenClaims;
  } catch {
    return to("/login?error=googleFailed");
  }
  const validIssuer = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  if (!validIssuer || claims.aud !== env().GOOGLE_CLIENT_ID || !claims.sub || !claims.email) {
    return to("/login?error=googleFailed");
  }

  const r = await loginWithGoogle(
    { sub: claims.sub, email: claims.email, emailVerified: claims.email_verified === true, name: claims.name ?? null },
    invite,
    await requestMeta(),
  );
  if (!r.ok) return to(`/login?error=${r.error}`);
  await setSessionCookie(r.session.token, r.session.expiresAt);
  return to(r.next === "mfa" ? "/login/mfa" : "/setup-mfa");
}
