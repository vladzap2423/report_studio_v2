import { dbQuery } from "@/lib/db";
import { verifySessionToken, type SessionUser } from "@/lib/session";

type DbUserRow = {
  id: number;
  name: string;
  username: string;
  role: SessionUser["role"];
};

export async function getCurrentUserFromSessionToken(
  token: string
): Promise<SessionUser | null> {
  const sessionUser = await verifySessionToken(token);
  if (!sessionUser) return null;

  const result = await dbQuery<DbUserRow>(
    `
      SELECT id, name, username, role
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [sessionUser.id]
  );

  const dbUser = result.rows[0];
  if (!dbUser) return null;

  // Invalidate session if user identity no longer matches DB record.
  if (dbUser.username !== sessionUser.username) {
    return null;
  }

  return dbUser;
}
