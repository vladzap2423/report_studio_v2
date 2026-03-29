import { db } from "@/lib/db";
import { NextResponse } from "next/server";

type Service = {
  ID: number;
  price_code: string | null;
  price_service: string | null;
  okmu_code: string | null;
  okmu_service: string | null;
  medicaments: number;
  profile: string | null;
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    const limit = parseInt(url.searchParams.get("limit") || "500", 10);
    const offset = (page - 1) * limit;

    // Получаем страницы данных
    const stmt = db.prepare(`
      SELECT 
        ID,
        "Код_прайса"     AS price_code,
        "Услуга_прайса"  AS price_service,
        "Код_ОК_МУ"      AS okmu_code,
        "Услуга_ОК_МУ"   AS okmu_service,
        Медикаменты      AS medicaments,
        Профиль          AS profile
      FROM services
      ORDER BY ID
      LIMIT ? OFFSET ?
    `);

    const services = stmt.all(limit, offset) as Service[];

    // Подсчет общего количества
    const totalStmt = db.prepare(`SELECT COUNT(*) AS count FROM services`);
    const totalRow = totalStmt.get() as { count: number };
    const total = totalRow.count;

    return NextResponse.json({ services, total });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Ошибка загрузки" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const { id, field, value } = await request.json();

    if (!id || !field) {
      return NextResponse.json({ error: "Нужны id и field" }, { status: 400 });
    }

    const allowedFields: Record<string, string> = {
      price_code: "Код_прайса",
      price_service: "Услуга_прайса",
      okmu_code: "Код_ОК_МУ",
      okmu_service: "Услуга_ОК_МУ",
      medicaments: "Медикаменты",
      profile: "Профиль",
    };

    const dbField = allowedFields[field];
    if (!dbField) {
      return NextResponse.json({ error: "Недопустимое поле" }, { status: 400 });
    }

    const stmt = db.prepare(`
      UPDATE services
      SET "${dbField}" = ?
      WHERE ID = ?
    `);

    const info = stmt.run(value, id);

    return NextResponse.json({ success: info.changes > 0 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Ошибка сохранения" }, { status: 500 });
  }
}