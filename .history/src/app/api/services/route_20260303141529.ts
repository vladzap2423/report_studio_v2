// app/api/services/route.ts
import { db } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET() {
    try {
        const services = db
            .prepare(`
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
      `)
            .all();

        return NextResponse.json(services);
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