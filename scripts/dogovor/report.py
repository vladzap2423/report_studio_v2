# -*- coding: utf-8 -*-
"""
Плагин формирует Excel‑отчёт с группировкой по профилю ИЗ БАЗЫ data.db.
Медикаменты и Профиль берутся из таблицы services по полю Код_ОК_МУ.
"""
import argparse
import os
import sqlite3
from typing import Tuple, Dict

import openpyxl
import pandas as pd
from openpyxl.styles import Alignment, Border, Font, Side
from openpyxl.utils import get_column_letter


# ====================== НАСТРОЙКИ ======================
DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data.db")
# Если база лежит прямо рядом со скриптом — раскомментируй строку ниже:
# DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data.db")

SHEET_MEDCOM = "Медкомиссии"
SHEET_OTHER = "Остальное"

# Входные колонки из Excel
VID_COL = "Вид поступления"
VID_PROF = "профосмотр"

COL_CODE = "Код ОКМУ"          # в твоём файле
COL_SERVICE = "Услуга"
COL_STATE = "Состояние"
COL_DATE = "Дата"
COL_SUM = "Сумма"
COL_FIO = "ФИО"
COL_SPEC = "Специалист/Ресурс.Выполнение"
COL_EXTRA = "Понятие dopPers"
COL_TARPLAN = "Тар.план"
COL_DOGOVOR = "Договор на оплату"

# Выходные колонки
OUT_HEADERS = [
    "ФИО", "Услуга", "Состояние", "Тар.план", "Договор на оплату",
    "Дата договора", "Количество услуг", "Сумма по тарифу",
    "Медикаменты", "Сумма для распределения",
    "Специалист/Ресурс.Выполнение",
    "Персонал. Дополнительный персонал/ресурсы",
]

COL_WIDTHS = [32, 64, 18, 16, 18, 14, 16, 16, 16, 22, 32, 32]


def get_db_connection():
    if not os.path.exists(DB_PATH):
        raise FileNotFoundError(f"База данных не найдена: {DB_PATH}")
    return sqlite3.connect(DB_PATH)


def load_medicaments_and_profiles() -> Tuple[Dict[str, float], Dict[str, str]]:
    """Загружает Медикаменты и Профиль из data.db"""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT "Код_ОК_МУ", "Медикаменты", "Профиль"
        FROM services
        WHERE "Код_ОК_МУ" IS NOT NULL
    """)
    rows = cursor.fetchall()
    conn.close()

    medicaments_map: Dict[str, float] = {}
    profile_map: Dict[str, str] = {}

    for code, meds, profile in rows:
        code = str(code).strip()
        if code:
            medicaments_map[code] = float(meds) if meds is not None else 0.0
            profile_map[code] = str(profile).strip() if profile else "Без профиля"

    return medicaments_map, profile_map


def clean_text_series(s: pd.Series) -> pd.Series:
    s = s.astype("string")
    s = s.str.strip()
    s = s.replace({"nan": pd.NA, "None": pd.NA, "": pd.NA})
    return s


def normalize_str(x) -> str:
    if pd.isna(x) or x is None:
        return ""
    return str(x).strip().lower()


def load_input(path: str) -> pd.DataFrame:
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb[wb.sheetnames[0]]

    # Поиск строки заголовков
    header_row = None
    for r in range(1, min(50, ws.max_row) + 1):
        vals = [ws.cell(r, c).value for c in range(1, ws.max_column + 1)]
        if any(v == COL_CODE for v in vals if v):
            header_row = r
            break

    if header_row is None:
        raise RuntimeError(f"Не найдена строка с колонкой '{COL_CODE}'")

    headers = [ws.cell(header_row, c).value for c in range(1, ws.max_column + 1)]
    data = []
    for r in range(header_row + 1, ws.max_row + 1):
        row = {headers[c-1]: ws.cell(r, c).value for c in range(1, ws.max_column + 1)}
        if all(v is None for v in row.values()):
            continue
        data.append(row)

    wb.close()
    df = pd.DataFrame(data)

    df[COL_SUM] = pd.to_numeric(df.get(COL_SUM), errors="coerce").fillna(0)

    for col in [VID_COL, COL_FIO, COL_SERVICE, COL_CODE, COL_STATE,
                COL_SPEC, COL_EXTRA, COL_TARPLAN, COL_DOGOVOR]:
        if col in df.columns:
            df[col] = clean_text_series(df[col])

    if COL_DATE in df.columns:
        df[COL_DATE] = pd.to_datetime(df[COL_DATE], errors="coerce")

    return df[df[COL_CODE].notna()].copy()


def aggregate_for_patient_style(df: pd.DataFrame, medicaments_map: dict, profile_map: dict) -> pd.DataFrame:
    df = df.copy()

    # Добавляем профиль из базы
    df["Профиль_из_БД"] = df[COL_CODE].astype(str).str.strip().map(profile_map).fillna("Без профиля")

    g = (
        df.groupby(
            ["Профиль_из_БД", COL_FIO, COL_CODE, COL_SERVICE, COL_STATE,
             COL_DATE, COL_TARPLAN, COL_DOGOVOR, COL_SPEC, COL_EXTRA],
            as_index=False,
            dropna=False,
        )
        .agg(
            **{
                "Количество услуг": (COL_CODE, "size"),
                "Сумма по тарифу": (COL_SUM, "sum"),
            }
        )
    )

    # Добавляем медикаменты из базы
    per_one = g[COL_CODE].astype(str).str.strip().map(medicaments_map).fillna(0.0)
    g["Медикаменты"] = (per_one * g["Количество услуг"]).round(2)
    g["Сумма для распределения"] = (g["Сумма по тарифу"] - g["Медикаменты"]).round(2)

    out = pd.DataFrame({
        "Профиль": g["Профиль_из_БД"],
        "ФИО": g[COL_FIO],
        "Услуга": g[COL_SERVICE],
        "Состояние": g[COL_STATE],
        "Тар.план": g[COL_TARPLAN],
        "Договор на оплату": g[COL_DOGOVOR],
        "Дата договора": g[COL_DATE],
        "Количество услуг": g["Количество услуг"].astype(int),
        "Сумма по тарифу": g["Сумма по тарифу"].round(2),
        "Медикаменты": g["Медикаменты"].round(2),
        "Сумма для распределения": g["Сумма для распределения"].round(2),
        "Специалист/Ресурс.Выполнение": g[COL_SPEC],
        "Персонал. Дополнительный персонал/ресурсы": g[COL_EXTRA],
    })

    out.sort_values(["Профиль", "ФИО", "Тар.план", "Договор на оплату", "Дата договора"], inplace=True)
    return out


# ====================== ОСТАЛЬНОЙ КОД БЕЗ ИЗМЕНЕНИЙ ======================
def split_by_vid(df: pd.DataFrame) -> Tuple[pd.DataFrame, pd.DataFrame]:
    if VID_COL not in df.columns:
        return df.iloc[0:0].copy(), df.copy()
    vid_norm = df[VID_COL].apply(normalize_str)
    return df[vid_norm == VID_PROF].copy(), df[vid_norm != VID_PROF].copy()


def write_profile_header(ws, row_idx: int, profile_name: str, ncols: int) -> int:
    title = profile_name.strip() or "Без профиля"
    ws.merge_cells(start_row=row_idx, start_column=1, end_row=row_idx, end_column=ncols)
    cell = ws.cell(row_idx, 1, value=title)
    cell.font = Font(bold=True, size=14)
    cell.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[row_idx].height = 28
    return row_idx + 1


def write_patient_like_sheet(ws, df_part: pd.DataFrame, medicaments_map: dict, profile_map: dict):
    table_df = aggregate_for_patient_style(df_part, medicaments_map, profile_map)
    ncols = len(OUT_HEADERS)

    for c, h in enumerate(OUT_HEADERS, 1):
        cell = ws.cell(1, c, value=h)
        cell.font = Font(bold=True)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

    r = 2
    for profile, df_prof in table_df.groupby("Профиль", sort=False):
        r = write_profile_header(ws, r, profile, ncols)
        for _, row in df_prof.iterrows():
            values = [
                row["ФИО"], row["Услуга"], row["Состояние"],
                row["Тар.план"], row["Договор на оплату"], row["Дата договора"],
                int(row["Количество услуг"]),
                float(row["Сумма по тарифу"]),
                float(row["Медикаменты"]),
                float(row["Сумма для распределения"]),
                row["Специалист/Ресурс.Выполнение"],
                row["Персонал. Дополнительный персонал/ресурсы"],
            ]
            for c, v in enumerate(values, 1):
                cell = ws.cell(r, c, value=v)
                cell.alignment = Alignment(vertical="top", wrap_text=True)
                if c == 6:
                    cell.number_format = "dd.mm.yyyy"
                if c == 7:
                    cell.number_format = "0"
                if c in (8, 9, 10):
                    cell.number_format = "0.00"
            r += 1

    # Итоговая строка
    total_qty = int(table_df["Количество услуг"].sum()) if not table_df.empty else 0
    total_sum = float(table_df["Сумма по тарифу"].sum()) if not table_df.empty else 0.0
    total_meds = float(table_df["Медикаменты"].sum()) if not table_df.empty else 0.0
    total_dist = float(table_df["Сумма для распределения"].sum()) if not table_df.empty else 0.0

    ws.cell(r, 1, "ИТОГО").font = Font(bold=True)
    ws.cell(r, 7, total_qty).font = Font(bold=True)
    ws.cell(r, 8, round(total_sum, 2)).font = Font(bold=True)
    ws.cell(r, 9, round(total_meds, 2)).font = Font(bold=True)
    ws.cell(r, 10, round(total_dist, 2)).font = Font(bold=True)

    # Границы и ширины
    thin = Side(style="thin")
    for rr in range(1, r + 1):
        for cc in range(1, ncols + 1):
            ws.cell(rr, cc).border = Border(left=thin, right=thin, top=thin, bottom=thin)

    for i, w in enumerate(COL_WIDTHS, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A2"


def build_report(df: pd.DataFrame, output_path: str) -> None:
    medicaments_map, profile_map = load_medicaments_and_profiles()

    df_prof, df_other = split_by_vid(df)

    wb = openpyxl.Workbook()
    wb.remove(wb.active)

    ws_med = wb.create_sheet(title=SHEET_MEDCOM)
    write_patient_like_sheet(ws_med, df_prof, medicaments_map, profile_map)

    ws_other = wb.create_sheet(title=SHEET_OTHER)
    write_patient_like_sheet(ws_other, df_other, medicaments_map, profile_map)

    wb.save(output_path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="Входной файл xlsx")
    ap.add_argument("--output", required=True, help="Выходной файл xlsx")
    args = ap.parse_args()

    df = load_input(args.input)
    build_report(df, args.output)
    print(f"Отчёт успешно создан: {args.output}")


if __name__ == "__main__":
    main()