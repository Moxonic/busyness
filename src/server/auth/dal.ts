import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Role } from "@/db/schema";
import { can, type Permission } from "@/lib/permissions";
import { getSessionToken } from "./cookies";
import { validateSessionToken } from "./session";

/**
 * Data Access Layer: the only way pages, Server Actions and route handlers learn who is
 * calling. Every one of them must call requireUser() or requirePermission() itself;
 * layouts and hidden buttons are not security.
 */

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  locale: string;
  sessionId: string;
  hasPassword: boolean;
  googleLinked: boolean;
};

export const getAuth = cache(async () => {
  const token = await getSessionToken();
  if (!token) return null;
  return validateSessionToken(token);
});

/** A fully logged-in user (password or Google, plus second factor). Redirects otherwise. */
export async function requireUser(): Promise<CurrentUser> {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const { session, user } = auth;
  if (!user.totpEnabledAt) redirect("/setup-mfa");
  if (!session.mfaVerifiedAt) redirect("/login/mfa");
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    locale: user.locale,
    sessionId: session.id,
    hasPassword: Boolean(user.passwordHash),
    googleLinked: Boolean(user.googleSub),
  };
}

export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) redirect("/forbidden");
  return user;
}

/** For the second-factor pages: a session that has passed step 1 but not step 2. */
export async function requirePendingAuth() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  if (auth.session.mfaVerifiedAt) redirect("/");
  return auth;
}
