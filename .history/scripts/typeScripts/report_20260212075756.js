#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");

const MEDICAMENTS_JSON_FILENAME = "medicaments.json";

const VID_COL = "Вид поступления";
const VID_PROF = "профосмотр";

const SHEET_MEDCOM = "Медкомиссии";
const SHEET_OTHER = "Остальное";

// Входные колонки
const COL_CODE = "Код ОКМУ";
const COL_SERVICE = "Услуга";
const COL_STATE = "Состояние";
const COL_DATE = "Дата";
const COL_SUM = "Сумма";
const COL_FIO = "ФИО";
const COL_SPEC = "Специалист/Ресурс.Выполнение";
const COL_EXTRA = "Персонал. Дополнительный персонал/ресурсы";
const COL_PROFILE = "Наименование специализации/профиля на текущую дату";

// Выходные колонки
const OUT_HEADERS = [
  "ФИО",
  "Услуга",
  "Состояние",
  "Дата",
  "Количество услуг",
  "Сумма по тарифу",
  "Медикаменты",
  "Сумма для распределения",
  "Специалист/Ресурс.Выполнение",
  "Персонал. Дополнительный персонал/ресурсы",
];

const COL_WIDTHS = [34, 65, 20, 16, 16, 16, 22, 28, 34, 34];

function pluginDir() {
  return __dirname;
}

function medicamentsJsonPath() {
  return path.join(pluginDir(), MEDICAMENTS_JSON_FILENAME);
}

function loadMedicamentsMap() {
  const p = medicamentsJsonPath();
  if (!fs.existsSync(p)) return {};
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) {
    const code = String(k || "").trim();
    const num = Number(v);
    out[code] = Number.isFinite(num) ? num : 0;
  }
  return out;
}

function normalizeStr(x) {
  if (x === null || x === undefined) return "";
  return String(x).trim().toLowerCase();
}

function cleanText(x) {
  if (x === null || x === undefined) return null;
  const s = String(x).trim();
  if (!s || s === "nan" || s === "None") return null;
  return s;
}

function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function isRowEmpty(obj) {
  return Object.values(obj).every((v) => v === null || v === undefined || v === "");
}

function excelCellToJSDate(v) {
  // ExcelJS обычно возвращает Date для ячейки-даты, но иногда number/string
  if (v instanceof Date) return v;
  if (typeof v === "number") {
    // Excel serial date -> JS date (Excel epoch 1899-12-30)
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const ms = v * 24 * 60 * 60 * 1000;
    return new Date(epoch.getTime() + ms);
  }
  return v; // пусть останется как есть (string/null)
}

async function loadInputXlsx(inputPath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(inputPath);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("Входной файл не содержит листов.");

  // ищем строку заголовков (в первых 50 строках) по наличию COL_CODE
  let headerRow = null;
  const maxScan = Math.min(50, ws.rowCount || 0);
  for (let r = 1; r <= maxScan; r++) {
    const row = ws.getRow(r);
    const vals = row.values || [];
    if (vals.some((v) => v === COL_CODE)) {
      headerRow = r;
      break;
    }
  }
  if (!headerRow) {
    throw new Error(`Не найдена строка заголовков (ожидался столбец '${COL_CODE}').`);
  }

  const headerValues = ws.getRow(headerRow).values;
  // row.values: [ , c1, c2, ...]
  const headers = [];
  for (let c = 1; c < headerValues.length; c++) {
    headers.push(headerValues[c]);
  }

  const data = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    // пропускаем полностью пустые строки
    if (!row || row.cellCount === 0) continue;

    const obj = {};
    for (let c = 1; c <= headers.length; c++) {
      const key = headers[c - 1];
      if (!key) continue;
      const cell = row.getCell(c);
      let v = cell.value;

      // ExcelJS может возвращать объект {richText}, {formula}, {result} и т.п.
      if (v && typeof v === "object") {
        if (v.text) v = v.text;
        else if (v.richText) v = v.richText.map((t) => t.text).join("");
        else if (v.result !== undefined) v = v.result;
      }

      obj[String(key)] = v;
    }

    if (isRowEmpty(obj)) continue;
    data.push(obj);
  }

  // валидация обязательных колонок
  const cols = new Set(headers.map((h) => String(h || "")));
  for (const c of [COL_CODE, COL_SERVICE, COL_SUM]) {
    if (!cols.has(c)) throw new Error(`В исходном файле нет нужного столбца: '${c}'`);
  }

  // нормализация
  for (const row of data) {
    // сумма
    row[COL_SUM] = toNumber(row[COL_SUM]);

    // чистим текстовые
    for (const col of [VID_COL, COL_PROFILE, COL_STATE, COL_FIO, COL_SERVICE, COL_CODE, COL_SPEC, COL_EXTRA]) {
      if (col in row) row[col] = cleanText(row[col]);
    }

    // дата
    if (COL_DATE in row) row[COL_DATE] = excelCellToJSDate(row[COL_DATE]);
  }

  // фильтр: код и услуга должны быть не пустые
  const filtered = data.filter((row) => row[COL_CODE] != null && row[COL_SERVICE] != null);
  return filtered;
}

function splitByVid(rows) {
  const prof = [];
  const other = [];
  for (const r of rows) {
    if (!(VID_COL in r) || r[VID_COL] == null) {
      other.push(r);
      continue;
    }
    const v = normalizeStr(r[VID_COL]);
    if (v === VID_PROF) prof.push(r);
    else other.push(r);
  }
  return { prof, other };
}

function dateKey(v) {
  if (!v) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10); // YYYY-MM-DD
  return String(v);
}

function addMedicamentsAndDistribution(aggRows, medicamentsMap) {
  for (const r of aggRows) {
    const code = (r[COL_CODE] ?? "").toString().trim();
    const perOne = Number(medicamentsMap[code] ?? 0);
    const qty = Number(r["Количество услуг"] || 0);
    const sum = Number(r["Сумма по тарифу"] || 0);
    const meds = Math.round((perOne * qty) * 100) / 100;
    r["Медикаменты"] = meds;
    r["Сумма для распределения"] = Math.round((sum - meds) * 100) / 100;
  }
  return aggRows;
}

function aggregateForPatientStyle(rows, medicamentsMap) {
  // гарантируем колонки как в pandas-версии
  const safe = rows.map((r) => {
    const x = { ...r };
    if (!(COL_PROFILE in x)) x[COL_PROFILE] = "";
    if (!(COL_FIO in x)) x[COL_FIO] = "";
    if (!(COL_SPEC in x)) x[COL_SPEC] = "";
    if (!(COL_EXTRA in x)) x[COL_EXTRA] = "";
    if (!(COL_STATE in x)) x[COL_STATE] = "";
    if (!(COL_DATE in x)) x[COL_DATE] = null;

    x[COL_PROFILE] = x[COL_PROFILE] ?? "";
    x[COL_FIO] = x[COL_FIO] ?? "";
    x[COL_SPEC] = x[COL_SPEC] ?? "";
    x[COL_EXTRA] = x[COL_EXTRA] ?? "";
    x[COL_STATE] = x[COL_STATE] ?? "";

    return x;
  });

  // group key: Профиль + ФИО + Код + Услуга + Состояние + Дата + Спец + Доп
  const map = new Map();

  for (const r of safe) {
    const k = [
      r[COL_PROFILE] ?? "",
      r[COL_FIO] ?? "",
      r[COL_CODE] ?? "",
      r[COL_SERVICE] ?? "",
      r[COL_STATE] ?? "",
      dateKey(r[COL_DATE]),
      r[COL_SPEC] ?? "",
      r[COL_EXTRA] ?? "",
    ].join("||");

    const prev = map.get(k);
    if (!prev) {
      map.set(k, {
        [COL_PROFILE]: r[COL_PROFILE] ?? "",
        [COL_FIO]: r[COL_FIO] ?? "",
        [COL_CODE]: r[COL_CODE] ?? "",
        [COL_SERVICE]: r[COL_SERVICE] ?? "",
        [COL_STATE]: r[COL_STATE] ?? "",
        [COL_DATE]: r[COL_DATE] instanceof Date ? r[COL_DATE] : (r[COL_DATE] ?? null),
        [COL_SPEC]: r[COL_SPEC] ?? "",
        [COL_EXTRA]: r[COL_EXTRA] ?? "",
        "Количество услуг": 1,
        "Сумма по тарифу": Number(r[COL_SUM] || 0),
      });
    } else {
      prev["Количество услуг"] += 1;
      prev["Сумма по тарифу"] += Number(r[COL_SUM] || 0);
    }
  }

  let agg = Array.from(map.values());

  // округление суммы
  for (const r of agg) {
    r["Сумма по тарифу"] = Math.round((Number(r["Сумма по тарифу"] || 0)) * 100) / 100;
  }

  agg = addMedicamentsAndDistribution(agg, medicamentsMap);

  // приводим к “выходной таблице” (как в python)
  const out = agg.map((g) => ({
    [COL_PROFILE]: g[COL_PROFILE],
    "ФИО": g[COL_FIO],
    "Услуга": g[COL_SERVICE],
    "Состояние": g[COL_STATE],
    "Дата": g[COL_DATE],
    "Количество услуг": Number(g["Количество услуг"] || 0),
    "Сумма по тарифу": Math.round(Number(g["Сумма по тарифу"] || 0) * 100) / 100,
    "Медикаменты": Math.round(Number(g["Медикаменты"] || 0) * 100) / 100,
    "Сумма для распределения": Math.round(Number(g["Сумма для распределения"] || 0) * 100) / 100,
    "Специалист/Ресурс.Выполнение": g[COL_SPEC],
    "Персонал. Дополнительный персонал/ресурсы": g[COL_EXTRA],
  }));

  // сортировка: профиль, ФИО, дата, услуга, специалист
  out.sort((a, b) => {
    const keysA = [
      a[COL_PROFILE] || "",
      a["ФИО"] || "",
      a["Дата"] instanceof Date ? a["Дата"].toISOString() : String(a["Дата"] || ""),
      a["Услуга"] || "",
      a["Специалист/Ресурс.Выполнение"] || "",
    ];
    const keysB = [
      b[COL_PROFILE] || "",
      b["ФИО"] || "",
      b["Дата"] instanceof Date ? b["Дата"].toISOString() : String(b["Дата"] || ""),
      b["Услуга"] || "",
      b["Специалист/Ресурс.Выполнение"] || "",
    ];
    for (let i = 0; i < keysA.length; i++) {
      const aa = keysA[i];
      const bb = keysB[i];
      if (aa < bb) return -1;
      if (aa > bb) return 1;
    }
    return 0;
  });

  return out;
}

function setColumnWidths(ws) {
  ws.columns = OUT_HEADERS.map((h, i) => ({
    header: h,
    key: `c${i + 1}`,
    width: COL_WIDTHS[i] ?? 20,
  }));
}

function borderThin() {
  return {
    top: { style: "thin" },
    left: { style: "thin" },
    bottom: { style: "thin" },
    right: { style: "thin" },
  };
}

function applyBorders(ws, startRow, endRow, startCol, endCol) {
  const b = borderThin();
  for (let r = startRow; r <= endRow; r++) {
    const row = ws.getRow(r);
    for (let c = startCol; c <= endCol; c++) {
      const cell = row.getCell(c);
      cell.border = b;
    }
  }
}

function writeProfileHeader(ws, rowIdx, profileName, ncols) {
  const title = (profileName && String(profileName).trim()) ? String(profileName).trim() : "Без профиля";

  ws.mergeCells(rowIdx, 1, rowIdx, ncols);
  const cell = ws.getCell(rowIdx, 1);
  cell.value = title;
  cell.font = { bold: true, size: 14 };
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  ws.getRow(rowIdx).height = 28;

  return rowIdx + 1;
}

function writePatientLikeSheet(ws, rowsPart, medicamentsMap) {
  const table = aggregateForPatientStyle(rowsPart, medicamentsMap);
  const ncols = OUT_HEADERS.length;

  // Заголовки
  ws.getRow(1).values = ["", ...OUT_HEADERS]; // ExcelJS row.values 1-based
  for (let c = 1; c <= ncols; c++) {
    const cell = ws.getCell(1, c);
    cell.font = { bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  }

  ws.views = [{ state: "frozen", xSplit: 0, ySplit: 1 }];

  let r = 2;

  // Группировка по профилю (как в python)
  // Важно: сохраняем порядок как после сортировки
  let currentProfile = null;
  for (const row of table) {
    const profile = row[COL_PROFILE] ?? "";
    if (currentProfile === null || profile !== currentProfile) {
      currentProfile = profile;
      r = writeProfileHeader(ws, r, profile, ncols);
    }

    const values = [
      row["ФИО"],
      row["Услуга"],
      row["Состояние"],
      row["Дата"],
      row["Количество услуг"],
      row["Сумма по тарифу"],
      row["Медикаменты"],
      row["Сумма для распределения"],
      row["Специалист/Ресурс.Выполнение"],
      row["Персонал. Дополнительный персонал/ресурсы"],
    ];

    ws.getRow(r).values = ["", ...values];

    for (let c = 1; c <= ncols; c++) {
      const cell = ws.getCell(r, c);
      cell.alignment = { vertical: "top", wrapText: true };

      if (c === 4) {
        // Дата
        cell.numFmt = "dd.mm.yyyy";
      }
      if (c === 5) {
        // Кол-во
        cell.numFmt = "0";
      }
      if (c === 6 || c === 7 || c === 8) {
        cell.numFmt = "0.00";
      }
    }

    r += 1;
  }

  // Итоги (по всему листу)
  const totalQty = table.reduce((s, x) => s + Number(x["Количество услуг"] || 0), 0);
  const totalSum = table.reduce((s, x) => s + Number(x["Сумма по тарифу"] || 0), 0);
  const totalMeds = table.reduce((s, x) => s + Number(x["Медикаменты"] || 0), 0);
  const totalDist = table.reduce((s, x) => s + Number(x["Сумма для распределения"] || 0), 0);

  ws.getCell(r, 1).value = "ИТОГО";
  ws.getCell(r, 1).font = { bold: true };

  ws.getCell(r, 5).value = totalQty;
  ws.getCell(r, 5).font = { bold: true };
  ws.getCell(r, 5).numFmt = "0";

  ws.getCell(r, 6).value = Math.round(totalSum * 100) / 100;
  ws.getCell(r, 6).font = { bold: true };
  ws.getCell(r, 6).numFmt = "0.00";

  ws.getCell(r, 7).value = Math.round(totalMeds * 100) / 100;
  ws.getCell(r, 7).font = { bold: true };
  ws.getCell(r, 7).numFmt = "0.00";

  ws.getCell(r, 8).value = Math.round(totalDist * 100) / 100;
  ws.getCell(r, 8).font = { bold: true };
  ws.getCell(r, 8).numFmt = "0.00";

  for (let c = 1; c <= ncols; c++) {
    ws.getCell(r, c).alignment = { vertical: "top", wrapText: true };
  }

  // ширины колонок
  setColumnWidths(ws);

  // границы (включая профили и итог)
  applyBorders(ws, 1, r, 1, ncols);
}

async function buildReport(inputPath, outputPath) {
  const medicamentsMap = loadMedicamentsMap();
  const rows = await loadInputXlsx(inputPath);
  const { prof, other } = splitByVid(rows);

  const outWb = new ExcelJS.Workbook();
  outWb.creator = "report_studio_v2";
  outWb.created = new Date();

  const wsMed = outWb.addWorksheet(SHEET_MEDCOM);
  writePatientLikeSheet(wsMed, prof, medicamentsMap);

  const wsOther = outWb.addWorksheet(SHEET_OTHER);
  writePatientLikeSheet(wsOther, other, medicamentsMap);

  await outWb.xlsx.writeFile(outputPath);
}

// CLI
function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--input") out.input = argv[++i];
    else if (a === "--output") out.output = argv[++i];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.input || !args.output) {
    console.error("Usage: node report.js --input <input.xlsx> --output <output.xlsx>");
    process.exit(2);
  }
  await buildReport(args.input, args.output);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.stack || e?.message || e));
    process.exit(1);
  });
}
