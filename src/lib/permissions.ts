import type { Role } from "@/db/schema";

export const ROLES = ["owner", "employee", "accountant"] as const satisfies readonly Role[];

export type Permission =
  | "data:read" // see customers, products, invoices, accounts...
  | "data:write" // create and change business data
  | "export:download" // download exports and attachments (everyone, as decided)
  | "audit:read"
  | "users:manage"
  | "settings:manage"
  | "gdpr:manage"; // export/anonymise other people's personal data

const MATRIX: Record<Role, readonly Permission[]> = {
  owner: ["data:read", "data:write", "export:download", "audit:read", "users:manage", "settings:manage", "gdpr:manage"],
  employee: ["data:read", "data:write", "export:download"],
  accountant: ["data:read", "export:download", "audit:read"],
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

export function permissionsFor(role: Role): readonly Permission[] {
  return MATRIX[role];
}
