import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { requireApiRole } from "@/lib/require-api-role";

type ServiceRow = {
  id: number;
  code: string | null;
  name: string | null;
  med: number;
  profile: string | null;
};

const editableColumns = {
  code: "code",
  name: "name",
  med: "med",
  profile: "profile",
} as const;

export async function GET(request: NextRequest) {
  const auth = await requireApiRole(request, "admin");
  if (auth.response) return auth.response;

  try {
    const url = new URL(request.url);
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10));
    const rawLimit = Number.parseInt(url.searchParams.get("limit") || "500", 10);
    const limit = Math.min(Math.max(rawLimit, 1), 2000);
    const offset = (page - 1) * limit;

    const servicesRes = await dbQuery<ServiceRow>(
      `
        SELECT id, code, name, med, profile
        FROM services
        ORDER BY id
        LIMIT $1 OFFSET $2
      `,
      [limit, offset]
    );

    const totalRes = await dbQuery<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM services`
    );

    return NextResponse.json({
      services: servicesRes.rows,
      total: Number(totalRes.rows[0]?.count || "0"),
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to load services" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireApiRole(request, "admin");
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const id = Number(body?.id);
    const field = String(body?.field || "") as keyof typeof editableColumns;

    if (!Number.isFinite(id) || !editableColumns[field]) {
      return NextResponse.json({ error: "id and field are required" }, { status: 400 });
    }

    let value: string | number | null = body?.value ?? null;
    if (field === "med") {
      const numeric = Number(value);
      value = Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
    } else {
      const normalized = String(value ?? "").trim();
      value = normalized || null;
    }

    if (field === "profile" && value) {
      await dbQuery(
        `
          INSERT INTO profiles(name)
          VALUES ($1)
          ON CONFLICT (name) DO NOTHING
        `,
        [value]
      );
    }

    const column = editableColumns[field];
    const updateRes = await dbQuery(
      `
        UPDATE services
        SET ${column} = $1
        WHERE id = $2
      `,
      [value, id]
    );

    return NextResponse.json({ success: (updateRes.rowCount || 0) > 0 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to save service" }, { status: 500 });
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
        DELETE FROM services
        WHERE id = $1
      `,
      [id]
    );

    return NextResponse.json({ success: (result.rowCount || 0) > 0 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to delete service" }, { status: 500 });
  }
}
