# -*- coding: utf-8 -*-
"""
Плагин формирует Excel‑отчёт с группировкой по профилю (Наименование специализации/профиля на текущую дату).
Логика аналогична примеру из папки primer, но добавлены столбцы "Тар.план", "Договор на оплату" и "Дата".
"""
import argparse
import json
import os
from typing import Tuple

import openpyxl
import pandas as pd
from openpyxl.styles import Alignment, Border, Font, Side
from openpyxl.utils import get_column_letter


MEDICAMENTS_JSON_FILENAME = "medicaments.json"

# Входные колонки
VID_COL = "Вид поступления"
VID_PROF = "профосмотр"  # сравнение через lower().strip()

SHEET_MEDCOM = "Медкомиссии"
SHEET_OTHER = "Остальное"

COL_CODE = "Код ОКМУ"
COL_SERVICE = "Услуга"
COL_STATE = "Состояние"
COL_DATE = "Дата"  # отдельная колонка в исходнике, пока пустая, но появится в будущих выгрузках
COL_SUM = "Сумма"
COL_FIO = "ФИО"
COL_SPEC = "Специалист/Ресурс.Выполнение"
COL_EXTRA = "Понятие dopPers"
COL_PROFILE = "Наименование специализации/профиля на текущую дату"
COL_TARPLAN = "Тар.план"
COL_DOGOVOR = "Договор на оплату"

# Выходные колонки (порядок отображения)
OUT_HEADERS = [
    "ФИО",
    "Услуга",
    "Состояние",
    "Тар.план",
    "Договор на оплату",
    "Дата договора",
    "Количество услуг",
    "Сумма по тарифу",
    "Медикаменты",
    "Сумма для распределения",
    "Специалист/Ресурс.Выполнение",
    "Персонал. Дополнительный персонал/ресурсы",
]

# Ширины столбцов под выбранные заголовки (подогнаны после перестановки даты)
COL_WIDTHS = [32, 64, 18, 16, 18, 14, 16, 16, 16, 22, 32, 32]


def plugin_dir() -> str:
    return os.path.dirname(os.path.abspath(__file__))


def medicaments_json_path() -> str:
    return os.path.join(plugin_dir(), MEDICAMENTS_JSON_FILENAME)


def load_medicaments_map(json_path: str) -> dict:
    if not os.path.exists(json_path):
        return {}
    with open(json_path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    out = {}
    for k, v in (raw or {}).items():
        code = str(k).strip()
        try:
            out[code] = float(v)
        except (TypeError, ValueError):
            out[code] = 0.0
    return out


def clean_text_series(s: pd.Series) -> pd.Series:
    if s is None:
        return s
    s = s.astype("string")
    s = s.str.strip()
    s = s.replace({"nan": pd.NA, "None": pd.NA, "": pd.NA})
    return s


def normalize_str(x) -> str:
    if x is None or (isinstance(x, float) and pd.isna(x)) or (x is pd.NA):
        return ""
    return str(x).strip().lower()


def load_input(path: str) -> pd.DataFrame:
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb[wb.sheetnames[0]]

    header_row = None
    for r in range(1, min(50, ws.max_row) + 1):
        vals = [ws.cell(r, c).value for c in range(1, ws.max_column + 1)]
        if any(v == COL_CODE for v in vals):
            header_row = r
            break
    if header_row is None:
        raise RuntimeError(f"Не найдена строка заголовков (ожидался столбец '{COL_CODE}').")

    headers = [ws.cell(header_row, c).value for c in range(1, ws.max_column + 1)]
    data = []
    for r in range(header_row + 1, ws.max_row + 1):
        row = {headers[c - 1]: ws.cell(r, c).value for c in range(1, ws.max_column + 1)}
        if all(v is None for v in row.values()):
            continue
        data.append(row)

    wb.close()

    df = pd.DataFrame(data)

    for c in [COL_CODE, COL_SERVICE, COL_SUM]:
        if c not in df.columns:
            raise RuntimeError(f"В исходном файле нет нужного столбца: '{c}'")

    df[COL_SUM] = pd.to_numeric(df.get(COL_SUM), errors="coerce").fillna(0)

    for col in [
        VID_COL,
        COL_PROFILE,
        COL_STATE,
        COL_FIO,
        COL_SERVICE,
        COL_CODE,
        COL_SPEC,
        COL_EXTRA,
        COL_TARPLAN,
        COL_DOGOVOR,
    ]:
        if col in df.columns:
            df[col] = clean_text_series(df[col])

    if COL_DATE in df.columns:
        df[COL_DATE] = pd.to_datetime(df[COL_DATE], errors="coerce")

    df = df[df[COL_CODE].notna() & df[COL_SERVICE].notna()].copy()
    return df


def split_by_vid(df: pd.DataFrame) -> Tuple[pd.DataFrame, pd.DataFrame]:
    if VID_COL not in df.columns:
        return df.iloc[0:0].copy(), df.copy()

    vid_norm = df[VID_COL].apply(normalize_str)
    df_prof = df[vid_norm == VID_PROF].copy()
    df_other = df[vid_norm != VID_PROF].copy()
    return df_prof, df_other


def add_medicaments_and_distribution(g: pd.DataFrame, medicaments_map: dict) -> pd.DataFrame:
    per_one = g[COL_CODE].astype("string").str.strip().map(medicaments_map).fillna(0.0)
    g["Медикаменты"] = (per_one * g["Количество услуг"]).round(2)
    g["Сумма для распределения"] = (g["Сумма по тарифу"] - g["Медикаменты"]).round(2)
    return g


def aggregate_for_patient_style(df: pd.DataFrame, medicaments_map: dict) -> pd.DataFrame:
    df = df.copy()

    for c in [
        COL_PROFILE,
        COL_FIO,
        COL_SPEC,
        COL_EXTRA,
        COL_STATE,
        COL_DATE,
        COL_TARPLAN,
        COL_DOGOVOR,
    ]:
        if c not in df.columns:
            if c == COL_DATE:
                df[c] = pd.Series([pd.NaT] * len(df))
            else:
                df[c] = pd.Series([pd.NA] * len(df), dtype="string")

    df[COL_PROFILE] = df[COL_PROFILE].fillna("")
    df[COL_FIO] = df[COL_FIO].fillna("")
    df[COL_SPEC] = df[COL_SPEC].fillna("")
    df[COL_EXTRA] = df[COL_EXTRA].fillna("")
    df[COL_STATE] = df[COL_STATE].fillna("")
    df[COL_TARPLAN] = df[COL_TARPLAN].fillna("")
    df[COL_DOGOVOR] = df[COL_DOGOVOR].fillna("")

    g = (
        df.groupby(
            [
                COL_PROFILE,
                COL_FIO,
                COL_CODE,
                COL_SERVICE,
                COL_STATE,
                COL_DATE,
                COL_TARPLAN,
                COL_DOGOVOR,
                COL_SPEC,
                COL_EXTRA,
            ],
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

    g = add_medicaments_and_distribution(g, medicaments_map)

    out = pd.DataFrame(
        {
            COL_PROFILE: g[COL_PROFILE],
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
        }
    )

    sort_cols = [
        COL_PROFILE,
        "ФИО",
        "Тар.план",
        "Договор на оплату",
        "Дата договора",
        "Услуга",
        "Специалист/Ресурс.Выполнение",
    ]
    out.sort_values(sort_cols, inplace=True, kind="mergesort")
    return out


def apply_borders(ws, start_row: int, end_row: int, start_col: int, end_col: int):
    thin = Side(style="thin")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    for rr in range(start_row, end_row + 1):
        for cc in range(start_col, end_col + 1):
            ws.cell(rr, cc).border = border


def format_sheet(ws):
    for i, w in enumerate(COL_WIDTHS, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A2"


def write_profile_header(ws, row_idx: int, profile_name: str, ncols: int) -> int:
    title = profile_name.strip() if profile_name and str(profile_name).strip() else "Без профиля"
    ws.merge_cells(start_row=row_idx, start_column=1, end_row=row_idx, end_column=ncols)
    cell = ws.cell(row_idx, 1, value=title)
    cell.font = Font(bold=True, size=14)
    cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.row_dimensions[row_idx].height = 28
    return row_idx + 1


def write_patient_like_sheet(ws, df_part: pd.DataFrame, medicaments_map: dict):
    table_df = aggregate_for_patient_style(df_part, medicaments_map)
    ncols = len(OUT_HEADERS)

    for c, h in enumerate(OUT_HEADERS, 1):
        cell = ws.cell(1, c, value=h)
        cell.font = Font(bold=True)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

    r = 2

    if not table_df.empty:
        for profile, df_prof in table_df.groupby(COL_PROFILE, sort=False, dropna=False):
            r = write_profile_header(ws, r, profile, ncols)

            for _, row in df_prof.iterrows():
                values = [
                    row["ФИО"],
                    row["Услуга"],
                    row["Состояние"],
                    row["Тар.план"],
                    row["Договор на оплату"],
                    row["Дата договора"],
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
                    if c == 6:  # Дата договора
                        cell.number_format = "dd.mm.yyyy"
                    if c == 7:  # Кол-во услуг
                        cell.number_format = "0"
                    if c in (8, 9, 10):  # суммы
                        cell.number_format = "0.00"
                r += 1

    total_qty = int(table_df["Количество услуг"].sum()) if not table_df.empty else 0
    total_sum = float(table_df["Сумма по тарифу"].sum()) if not table_df.empty else 0.0
    total_meds = float(table_df["Медикаменты"].sum()) if not table_df.empty else 0.0
    total_dist = float(table_df["Сумма для распределения"].sum()) if not table_df.empty else 0.0

    ws.cell(r, 1, value="ИТОГО").font = Font(bold=True)
    ws.cell(r, 7, value=total_qty).font = Font(bold=True)

    c8 = ws.cell(r, 8, value=round(total_sum, 2)); c8.font = Font(bold=True); c8.number_format = "0.00"
    c9 = ws.cell(r, 9, value=round(total_meds, 2)); c9.font = Font(bold=True); c9.number_format = "0.00"
    c10 = ws.cell(r, 10, value=round(total_dist, 2)); c10.font = Font(bold=True); c10.number_format = "0.00"

    for c in range(1, ncols + 1):
        ws.cell(r, c).alignment = Alignment(vertical="top", wrap_text=True)

    apply_borders(ws, 1, r, 1, ncols)
    format_sheet(ws)


def build_report(df: pd.DataFrame, output_path: str) -> None:
    medicaments_map = load_medicaments_map(medicaments_json_path())

    df_prof, df_other = split_by_vid(df)

    wb = openpyxl.Workbook()
    default = wb.active
    wb.remove(default)

    ws_med = wb.create_sheet(title=SHEET_MEDCOM)
    write_patient_like_sheet(ws_med, df_prof, medicaments_map)

    ws_other = wb.create_sheet(title=SHEET_OTHER)
    write_patient_like_sheet(ws_other, df_other, medicaments_map)

    wb.save(output_path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="Входной файл xlsx/xls")
    ap.add_argument("--output", required=True, help="Выходной файл xlsx")
    args = ap.parse_args()

    df = load_input(args.input)
    build_report(df, args.output)


if __name__ == "__main__":
    main()
