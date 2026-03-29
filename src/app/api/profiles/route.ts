import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { requireApiRole } from "@/lib/require-api-role";

type ProfileRow = {
  id: number;
  name: string;
};

function normalizeName(value: unknown) {
  const name = String(value ?? "").trim();
  return name || null;
}

export async function GET(request: NextRequest) {
  const auth = await requireApiRole(request, "admin");
  if (auth.response) return auth.response;

  try {
    const full = new URL(request.url).searchParams.get("full") === "1";

    const profilesRes = await dbQuery<ProfileRow>(
      `
        SELECT id, name
        FROM profiles
        ORDER BY id
      `
    );

    if (full) {
      return NextResponse.json({ profiles: profilesRes.rows });
    }

    return NextResponse.json(profilesRes.rows.map((row) => row.name));
  } catch (error) {
    console.error("Failed to read profiles:", error);
    if (new URL(request.url).searchParams.get("full") === "1") {
      return NextResponse.json({ profiles: [] }, { status: 500 });
    }
    return NextResponse.json(["Терапия", "Хирургия", "Другое"], { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireApiRole(request, "admin");
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const name = normalizeName(body?.name);

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    await dbQuery(
      `
        INSERT INTO profiles(name)
        VALUES ($1)
        ON CONFLICT (name) DO NOTHING
      `,
      [name]
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to create profile" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireApiRole(request, "admin");
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const id = Number(body?.id);
    const name = normalizeName(body?.name);

    if (!Number.isFinite(id) || !name) {
      return NextResponse.json({ error: "id and name are required" }, { status: 400 });
    }

    const result = await dbQuery(
      `
        UPDATE profiles
        SET name = $1
        WHERE id = $2
      `,
      [name, id]
    );

    return NextResponse.json({ success: (result.rowCount || 0) > 0 });
  } catch (error: any) {
    if (error?.code === "23505") {
      return NextResponse.json({ error: "Profile with this name already exists" }, { status: 409 });
    }
    console.error(error);
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireApiRole(request, "admin");
  if (auth.response) return auth.response;

  try {
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const result = await dbQuery(
      `
        DELETE FROM profiles
        WHERE id = $1
      `,
      [id]
    );

    return NextResponse.json({ success: (result.rowCount || 0) > 0 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to delete profile" }, { status: 500 });
  }
}
