// app/api/profiles/route.ts
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET() {
    try {
        const filePath = path.join(process.cwd(), "scripts", "profile.json");
        const data = fs.readFileSync(filePath, "utf-8");
        const profiles = JSON.parse(data);

        return NextResponse.json(profiles);
    } catch (error) {
        console.error("Ошибка чтения profile.json:", error);
        return NextResponse.json(["Терапия", "Хирургия", "Другое"], { status: 500 });
    }
}