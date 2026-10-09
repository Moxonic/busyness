import { generateCodeVerifier, generateState } from "arctic";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { googleLoginEnabled } from "@/env";
import { GOOGLE_COOKIES, googleClient, oauthCookieOptions } from "@/server/auth/google";

/** Starts "Log in with Google" (OAuth 2.0 authorization code flow with PKCE). */
export async function GET(request: NextRequest) {
  if (!googleLoginEnabled()) return new NextResponse("Not found", { status: 404 });
  const state = generateState();
  const verifier = generateCodeVerifier();
  const url = googleClient().createAuthorizationURL(state, verifier, ["openid", "email", "profile"]);
  url.searchParams.set("prompt", "select_account");

  const jar = await cookies();
  const opts = oauthCookieOptions();
  jar.set(GOOGLE_COOKIES.state, state, opts);
  jar.set(GOOGLE_COOKIES.verifier, verifier, opts);
  const invite = request.nextUrl.searchParams.get("invite");
  if (invite && /^[a-z2-7]{32}$/.test(invite)) jar.set(GOOGLE_COOKIES.invite, invite, opts);
  else jar.delete(GOOGLE_COOKIES.invite);

  return NextResponse.redirect(url);
}
