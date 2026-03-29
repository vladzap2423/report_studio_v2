import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { ensureDatabaseReady, pool } from "@/lib/db";
import { requireApiRole } from "@/lib/require-api-role";

export const runtime = "nodejs";

const CODE_HEADERS = [
  "code",
  "код услуги",
  "код",
  "код прайса",
  "код ок му",
  "код_ок_му",
  "код окму",
];

const NAME_HEADERS = [
  "name",
  "service",
  "service name",
  "наименование услуги",
  "услуга",
  "услуги",
];

const MED_HEADERS = ["med", "мед", "медикаменты", "медикамент"];
const PROFILE_HEADERS = ["profile", "профиль", "терапия"];

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function findColumnIndex(headers: unknown[], aliases: string[]) {
  const normalized = headers.map((h) => normalizeHeader(h));
  return normalized.findIndex((h) => aliases.includes(h));
}

function findProfileColumnFallback(
  totalColumns: number,
  usedIndexes: number[]
): number {
  for (let i = 0; i < totalColumns; i += 1) {
    if (!usedIndexes.includes(i)) return i;
  }
  return -1;
}

function parseMed(raw: unknown): number | null {
  const text = String(raw ?? "").trim();
  if (!text) return 0;
  const parsed = Number(text.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed);
}

export async function POST(request: NextRequest) {
  const auth = await requireApiRole(request, "admin");
  if (auth.response) return auth.response;

  await ensureDatabaseReady();

  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const lowerName = String(file.name || "").toLowerCase();
  if (!lowerName.endsWith(".xlsx") && !lowerName.endsWith(".xls")) {
    return NextResponse.json(
      { error: "Only .xlsx or .xls file is supported" },
      { status: 400 }
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];

    if (!firstSheetName) {
      return NextResponse.json({ error: "Workbook is empty" }, { status: 400 });
    }

    const sheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: "",
    });

    if (rows.length < 2) {
      return NextResponse.json(
        { error: "Need header row and at least one data row" },
        { status: 400 }
      );
    }

    const headerRow = rows[0] || [];
    const codeIndex = findColumnIndex(headerRow, CODE_HEADERS);
    const nameIndex = findColumnIndex(headerRow, NAME_HEADERS);
    const medIndex = findColumnIndex(headerRow, MED_HEADERS);

    let profileIndex = findColumnIndex(headerRow, PROFILE_HEADERS);
    if (profileIndex < 0) {
      profileIndex = findProfileColumnFallback(headerRow.length, [codeIndex, nameIndex, medIndex]);
    }

    if (codeIndex < 0 || nameIndex < 0 || medIndex < 0 || profileIndex < 0) {
      return NextResponse.json(
        {
          error:
            "Required headers are missing. Use: code, name, med, profile (or: Код прайса, Услуга, Медикаменты, Профиль).",
        },
        { status: 400 }
      );
    }

    const parsedRows: Array<{
      code: string;
      name: string;
      med: number;
      profile: string | null;
    }> = [];
    const errors: string[] = [];

    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] || [];
      const humanRow = rowIndex + 1;

      const codeRaw = String(row[codeIndex] ?? "").trim();
      const nameRaw = String(row[nameIndex] ?? "").trim();
      const medRaw = row[medIndex];
      const profileRaw = String(row[profileIndex] ?? "").trim();

      const isEmptyRow =
        !codeRaw &&
        !nameRaw &&
        String(medRaw ?? "").trim() === "" &&
        !profileRaw;

      if (isEmptyRow) continue;

      if (!codeRaw) {
        errors.push(`Row ${humanRow}: code is empty`);
        continue;
      }

      if (!nameRaw) {
        errors.push(`Row ${humanRow}: service name is empty`);
        continue;
      }

      const med = parseMed(medRaw);
      if (med === null) {
        errors.push(`Row ${humanRow}: med must be a non-negative number`);
        continue;
      }

      parsedRows.push({
        code: codeRaw,
        name: nameRaw,
        med,
        profile: profileRaw || null,
      });
    }

    if (!parsedRows.length) {
      return NextResponse.json({ error: "No valid rows found in file" }, { status: 400 });
    }

    if (errors.length) {
      return NextResponse.json(
        {
          error: `Validation failed: ${errors.slice(0, 10).join("; ")}`,
        },
        { status: 400 }
      );
    }

    const profileNames = Array.from(
      new Set(
        parsedRows
          .map((row) => row.profile)
          .filter((profile): profile is string => Boolean(profile))
      )
    );

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      if (profileNames.length) {
        await client.query(
          `
            INSERT INTO profiles(name)
            SELECT DISTINCT profile_name
            FROM unnest($1::text[]) AS profile_name
            WHERE btrim(profile_name) <> ''
            ON CONFLICT (name) DO NOTHING
          `,
          [profileNames]
        );
      }

      await client.query("TRUNCATE TABLE services RESTART IDENTITY");

      for (const row of parsedRows) {
        await client.query(
          `
            INSERT INTO services(code, name, med, profile)
            VALUES ($1, $2, $3, $4)
          `,
          [row.code, row.name, row.med, row.profile]
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return NextResponse.json({ ok: true, inserted: parsedRows.length });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json(
      { error: error?.message || "Import failed" },
      { status: 500 }
    );
  }
}

