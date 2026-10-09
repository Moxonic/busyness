"use server";

import { redirect } from "next/navigation";
import { deleteSessionCookie } from "@/server/auth/cookies";
import { getAuth } from "@/server/auth/dal";
import { logout } from "@/server/auth/service";
import { requestMeta } from "@/server/request";

export async function logoutAction(): Promise<void> {
  const auth = await getAuth();
  if (auth) await logout(auth.session.id, auth.user, await requestMeta());
  await deleteSessionCookie();
  redirect("/login");
}
