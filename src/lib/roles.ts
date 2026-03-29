export type UserRole = "user" | "admin" | "god";

const ROLE_PRIORITY: Record<UserRole, number> = {
  user: 1,
  admin: 2,
  god: 3,
};

export function hasRequiredRole(role: UserRole, required: UserRole): boolean {
  return ROLE_PRIORITY[role] >= ROLE_PRIORITY[required];
}
