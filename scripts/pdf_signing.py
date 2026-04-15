import argparse
import base64
import json
import os
from io import BytesIO
from pathlib import Path

os.environ.setdefault("TZ", "Asia/Kamchatka")

from pyhanko.pdf_utils import layout
from pyhanko.pdf_utils.images import PdfImage
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.sign import fields, signers
from pyhanko.sign.signers import ExternalSigner
from pyhanko.sign.signers.pdf_byterange import PreparedByteRangeDigest
from pyhanko.sign.signers.pdf_signer import PdfTBSDocument
from pyhanko.stamp import StaticStampStyle
from PIL import Image, ImageDraw, ImageFont

PLACEHOLDER_SIZE = 131072
MIN_STAMP_IMAGE_WIDTH = 960
MIN_STAMP_IMAGE_HEIGHT = 220
MAX_STAMP_IMAGE_WIDTH = 1800
MAX_STAMP_IMAGE_HEIGHT = 420


def ensure_parent(path_str: str) -> Path:
    path = Path(path_str)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def resolve_font_path(bold: bool = False):
    candidates = [
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
        if bold
        else Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf")
        if bold
        else Path("/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf") if bold else Path("C:/Windows/Fonts/arial.ttf"),
        Path("C:/Windows/Fonts/calibrib.ttf") if bold else Path("C:/Windows/Fonts/calibri.ttf"),
        Path("C:/Windows/Fonts/tahomabd.ttf") if bold else Path("C:/Windows/Fonts/tahoma.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def load_pil_font(size: int, bold: bool = False):
    font_path = resolve_font_path(bold=bold)
    if font_path:
        try:
            return ImageFont.truetype(str(font_path), size=size)
        except Exception:
            pass
    return ImageFont.load_default()


def measure_text(draw: ImageDraw.ImageDraw, text: str, font):
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0], bbox[3] - bbox[1]


def fit_font_to_width(
    draw: ImageDraw.ImageDraw,
    text: str,
    max_width: int,
    start_size: int,
    min_size: int,
    bold: bool = False,
):
    size = start_size
    while size > min_size:
        font = load_pil_font(size, bold=bold)
        text_width, _ = measure_text(draw, text, font)
        if text_width <= max_width:
            return font
        size -= 1
    return load_pil_font(min_size, bold=bold)


def ellipsize(text: str, max_len: int) -> str:
    text = (text or "").strip()
    if len(text) <= max_len:
        return text
    if max_len <= 3:
        return text[:max_len]
    return f"{text[: max_len - 3]}..."


def format_valid_to(value: str) -> str:
    text = (value or "").strip()
    if not text:
        return ""
    if "T" in text:
        text = text.split("T", 1)[0]
    parts = text.split("-")
    if len(parts) == 3:
        return f"{parts[2]}.{parts[1]}.{parts[0]}"
    return text


def normalize_subject_value(value: str) -> str:
    return (value or "").replace("\n", " ").replace("\r", " ").strip()


def extract_certificate_owner(subject: str, fallback_name: str) -> str:
    normalized = normalize_subject_value(subject)
    if normalized:
        for chunk in normalized.split(","):
            part = chunk.strip()
            if part.upper().startswith("CN="):
                owner = part[3:].strip()
                if owner:
                    return owner
    return (fallback_name or "").strip()


def format_date_only(value: str) -> str:
    return format_valid_to(value)


def short_signer_name(full_name: str) -> str:
    parts = [part.strip() for part in full_name.split() if part.strip()]
    if len(parts) <= 1:
        return full_name

    last_name = parts[0]
    first_initial = f"{parts[1][0]}." if len(parts) > 1 and parts[1] else ""
    middle_initial = f"{parts[2][0]}." if len(parts) > 2 and parts[2] else ""
    return f"{last_name} {first_initial}{middle_initial}".strip()


def resolve_logo_path() -> Path | None:
    candidate = Path.cwd() / "public" / "logo.png"
    return candidate if candidate.exists() else None


def create_stamp_image(
    output_path: Path,
    signer_name: str,
    certificate_subject: str,
    certificate_thumbprint: str,
    certificate_valid_from: str,
    certificate_valid_to: str,
    stamp_width: float,
    stamp_height: float,
):
    canvas_width = int(max(MIN_STAMP_IMAGE_WIDTH, min(MAX_STAMP_IMAGE_WIDTH, round(stamp_width * 4.0))))
    canvas_height = int(max(MIN_STAMP_IMAGE_HEIGHT, min(MAX_STAMP_IMAGE_HEIGHT, round(stamp_height * 4.0))))
    img = Image.new("RGBA", (canvas_width, canvas_height), (255, 255, 255, 0))
    draw = ImageDraw.Draw(img)

    border_color = (90, 98, 226, 255)
    accent_fill = (241, 245, 255, 255)
    accent_border = (201, 209, 255, 255)
    text_main = (61, 71, 202, 255)
    text_sub = (40, 53, 142, 255)
    text_soft = (87, 96, 156, 255)

    radius = max(20, int(canvas_height * 0.095))
    border_width = max(2, int(canvas_height * 0.01))
    outer_margin = max(3, int(canvas_height * 0.012))
    draw.rounded_rectangle(
        (outer_margin, outer_margin, canvas_width - outer_margin, canvas_height - outer_margin),
        radius=radius,
        outline=border_color,
        width=border_width,
        fill=(255, 255, 255, 250),
    )

    logo_box = max(64, int(canvas_height * 0.28))
    logo_left = max(22, int(canvas_width * 0.022))
    logo_top = max(18, int(canvas_height * 0.08))
    draw.rounded_rectangle(
        (logo_left, logo_top, logo_left + logo_box, logo_top + logo_box),
        radius=max(12, int(logo_box * 0.24)),
        fill=accent_fill,
        outline=accent_border,
        width=1,
    )

    logo_path = resolve_logo_path()
    if logo_path:
        try:
            logo = Image.open(logo_path).convert("RGBA")
            logo.thumbnail((int(logo_box * 0.72), int(logo_box * 0.72)))
            logo_x = logo_left + (logo_box - logo.width) // 2
            logo_y = logo_top + (logo_box - logo.height) // 2
            img.alpha_composite(logo, (logo_x, logo_y))
        except Exception:
            pass

    owner = ellipsize(extract_certificate_owner(certificate_subject, signer_name), 40) or "не указан"
    thumbprint = normalize_subject_value(certificate_thumbprint) or "не указан"
    valid_from = format_date_only(certificate_valid_from) or "не указано"
    valid_to = format_date_only(certificate_valid_to) or "не указано"

    text_left = logo_left + logo_box + max(18, int(canvas_width * 0.02))
    text_right = canvas_width - max(22, int(canvas_width * 0.03))
    text_width = max(240, text_right - text_left)

    title_text = "ДОКУМЕНТ ПОДПИСАН"
    subtitle_text = "ЭЛЕКТРОННОЙ ПОДПИСЬЮ"
    owner_label = "Подписант:"
    cert_label = "Сертификат:"
    valid_label = "Срок действия:"
    valid_value = f"с {valid_from} по {valid_to}"

    title_font = fit_font_to_width(
        draw,
        title_text,
        text_width,
        start_size=max(44, int(canvas_height * 0.2)),
        min_size=30,
        bold=True,
    )
    subtitle_font = fit_font_to_width(
        draw,
        subtitle_text,
        text_width,
        start_size=max(30, int(canvas_height * 0.14)),
        min_size=20,
        bold=True,
    )
    body_label_font = fit_font_to_width(
        draw,
        valid_label,
        max(140, int(text_width * 0.24)),
        start_size=max(22, int(canvas_height * 0.11)),
        min_size=16,
        bold=True,
    )
    body_value_font = fit_font_to_width(
        draw,
        owner,
        max(180, int(text_width * 0.72)),
        start_size=max(22, int(canvas_height * 0.11)),
        min_size=14,
        bold=False,
    )
    thumbprint_font = fit_font_to_width(
        draw,
        thumbprint,
        max(180, int(text_width * 0.72)),
        start_size=max(20, int(canvas_height * 0.1)),
        min_size=12,
        bold=False,
    )
    date_font = fit_font_to_width(
        draw,
        valid_value,
        max(180, int(text_width * 0.72)),
        start_size=max(20, int(canvas_height * 0.1)),
        min_size=13,
        bold=False,
    )

    _, title_h = measure_text(draw, title_text, title_font)
    _, subtitle_h = measure_text(draw, subtitle_text, subtitle_font)
    owner_label_w, owner_label_h = measure_text(draw, owner_label, body_label_font)
    cert_label_w, cert_label_h = measure_text(draw, cert_label, body_label_font)
    valid_label_w, valid_label_h = measure_text(draw, valid_label, body_label_font)
    _, owner_value_h = measure_text(draw, owner, body_value_font)
    _, thumb_value_h = measure_text(draw, thumbprint, thumbprint_font)
    _, valid_value_h = measure_text(draw, valid_value, date_font)

    line_gap = max(8, int(canvas_height * 0.035))
    section_gap = max(12, int(canvas_height * 0.05))
    title_y = max(16, int(canvas_height * 0.08))
    y = title_y
    draw.text((text_left, y), title_text, font=title_font, fill=text_main)
    y += title_h + max(2, int(canvas_height * 0.01))
    draw.text((text_left, y), subtitle_text, font=subtitle_font, fill=text_main)
    y += subtitle_h + section_gap

    label_gap = max(10, int(canvas_width * 0.01))

    draw.text((text_left, y), owner_label, font=body_label_font, fill=text_sub)
    draw.text((text_left + owner_label_w + label_gap, y), owner, font=body_value_font, fill=text_soft)
    y += max(owner_label_h, owner_value_h) + line_gap

    draw.text((text_left, y), cert_label, font=body_label_font, fill=text_sub)
    draw.text((text_left + cert_label_w + label_gap, y), thumbprint, font=thumbprint_font, fill=text_soft)
    y += max(cert_label_h, thumb_value_h) + line_gap

    draw.text((text_left, y), valid_label, font=body_label_font, fill=text_sub)
    draw.text((text_left + valid_label_w + label_gap, y), valid_value, font=date_font, fill=text_soft)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(output_path, format="PNG")


def build_stamp_style(stamp_image_path: Path):
    return StaticStampStyle(
        border_width=0,
        background=PdfImage(str(stamp_image_path)),
        background_layout=layout.SimpleBoxLayoutRule(
            x_align=layout.AxisAlignment.ALIGN_MID,
            y_align=layout.AxisAlignment.ALIGN_MID,
            margins=layout.Margins.uniform(0),
        ),
        background_opacity=1.0,
    )


def clamp(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(value, max_value))


def compute_signature_box(
    media_box,
    x_ratio: float,
    y_ratio: float,
    width_ratio: float,
    height_ratio: float,
    column_count: int,
    step_order: int,
    step_total: int,
):
    left = float(media_box[0])
    bottom = float(media_box[1])
    right = float(media_box[2])
    top = float(media_box[3])
    page_width = right - left
    page_height = top - bottom

    block_x = left + x_ratio * page_width
    block_width = width_ratio * page_width
    block_height = height_ratio * page_height
    block_y = top - y_ratio * page_height - block_height

    cols = max(1, min(column_count, step_total, 2))
    rows = max(1, (step_total + cols - 1) // cols)
    gap_x = 10.0 if cols > 1 else 0.0
    gap_y = 10.0 if rows > 1 else 0.0
    stamp_width = (block_width - gap_x * max(cols - 1, 0)) / max(cols, 1)
    stamp_height = (block_height - gap_y * max(rows - 1, 0)) / max(rows, 1)

    stamp_width = max(1.0, stamp_width)
    stamp_height = max(1.0, stamp_height)
    step_index = max(0, step_order - 1)
    row_index = step_index // cols
    col_index = step_index % cols
    item_left = block_x + col_index * (stamp_width + gap_x)
    item_top = block_y + block_height - row_index * (stamp_height + gap_y)
    item_bottom = item_top - stamp_height

    x1 = clamp(item_left, left, right)
    x2 = clamp(item_left + stamp_width, left, right)
    y1 = clamp(item_bottom, bottom, top)
    y2 = clamp(item_top, bottom, top)

    return (x1, y1, x2, y2)


def command_prepare(args):
    input_path = Path(args.input)
    prepared_output = ensure_parent(args.prepared_output)
    to_sign_output = ensure_parent(args.to_sign_output)
    meta_output = ensure_parent(args.meta_output)
    stamp_image_output = ensure_parent(str(prepared_output.with_name(f"{args.field_name}.stamp.png")))

    with input_path.open("rb") as inf:
        writer = IncrementalPdfFileWriter(inf)
        page_ix = -1
        page_ref, _ = writer.prev.find_page_for_modification(page_ix)
        page = page_ref.get_object()
        media_box = page["/MediaBox"]
        sig_box = compute_signature_box(
            media_box=media_box,
            x_ratio=args.x_ratio,
            y_ratio=args.y_ratio,
            width_ratio=args.width_ratio,
            height_ratio=args.height_ratio,
            column_count=args.column_count,
            step_order=args.step_order,
            step_total=args.step_total,
        )

        signature_meta = signers.PdfSignatureMetadata(
            field_name=args.field_name,
            md_algorithm="sha256",
            subfilter=fields.SigSeedSubFilter.ADOBE_PKCS7_DETACHED,
        )
        field_spec = fields.SigFieldSpec(
            args.field_name,
            on_page=page_ix,
            box=sig_box,
        )
        signer = ExternalSigner(
            signing_cert=None,
            cert_registry=None,
            signature_value=8192,
        )

        create_stamp_image(
            stamp_image_output,
            signer_name=args.signer_name,
            certificate_subject=args.certificate_subject,
            certificate_thumbprint=args.certificate_thumbprint,
            certificate_valid_from=args.certificate_valid_from,
            certificate_valid_to=args.certificate_valid_to,
            stamp_width=sig_box[2] - sig_box[0],
            stamp_height=sig_box[3] - sig_box[1],
        )

        pdf_signer = signers.PdfSigner(
            signature_meta,
            signer=signer,
            stamp_style=build_stamp_style(stamp_image_output),
            new_field_spec=field_spec,
        )

        prepared_digest, _, output = pdf_signer.digest_doc_for_signing(
            writer,
            bytes_reserved=PLACEHOLDER_SIZE,
            appearance_text_params={},
        )

        prepared_bytes = output.getvalue()
        prepared_output.write_bytes(prepared_bytes)

        to_sign_bytes = (
            prepared_bytes[: prepared_digest.reserved_region_start]
            + prepared_bytes[prepared_digest.reserved_region_end :]
        )
        to_sign_output.write_bytes(to_sign_bytes)

        meta = {
            "prepared_pdf_path": str(prepared_output),
            "to_sign_path": str(to_sign_output),
            "document_digest": base64.b64encode(prepared_digest.document_digest).decode("ascii"),
            "reserved_region_start": prepared_digest.reserved_region_start,
            "reserved_region_end": prepared_digest.reserved_region_end,
            "page_box": [float(value) for value in sig_box],
        }
        meta_output.write_text(json.dumps(meta), encoding="utf-8")
        stamp_image_output.unlink(missing_ok=True)


def command_apply(args):
    prepared_path = Path(args.prepared_input)
    output_path = ensure_parent(args.output)
    cms_base64 = Path(args.signature_base64_file).read_text(encoding="utf-8").strip()
    cms_bytes = base64.b64decode(cms_base64)

    prepared_bytes = prepared_path.read_bytes()
    prepared_digest = PreparedByteRangeDigest(
        document_digest=base64.b64decode(args.document_digest),
        reserved_region_start=int(args.reserved_region_start),
        reserved_region_end=int(args.reserved_region_end),
    )

    output = BytesIO(prepared_bytes)
    PdfTBSDocument.finish_signing(output, prepared_digest, cms_bytes)
    output_path.write_bytes(output.getvalue())


def main():
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    prepare_parser = subparsers.add_parser("prepare")
    prepare_parser.add_argument("--input", required=True)
    prepare_parser.add_argument("--prepared-output", required=True)
    prepare_parser.add_argument("--to-sign-output", required=True)
    prepare_parser.add_argument("--meta-output", required=True)
    prepare_parser.add_argument("--field-name", required=True)
    prepare_parser.add_argument("--x-ratio", required=True, type=float)
    prepare_parser.add_argument("--y-ratio", required=True, type=float)
    prepare_parser.add_argument("--width-ratio", required=True, type=float)
    prepare_parser.add_argument("--height-ratio", required=True, type=float)
    prepare_parser.add_argument("--column-count", required=True, type=int)
    prepare_parser.add_argument("--step-order", required=True, type=int)
    prepare_parser.add_argument("--step-total", required=True, type=int)
    prepare_parser.add_argument("--signer-name", required=True)
    prepare_parser.add_argument("--certificate-subject", required=False, default="")
    prepare_parser.add_argument("--certificate-thumbprint", required=False, default="")
    prepare_parser.add_argument("--certificate-valid-from", required=False, default="")
    prepare_parser.add_argument("--certificate-valid-to", required=False, default="")
    prepare_parser.set_defaults(func=command_prepare)

    apply_parser = subparsers.add_parser("apply")
    apply_parser.add_argument("--prepared-input", required=True)
    apply_parser.add_argument("--output", required=True)
    apply_parser.add_argument("--document-digest", required=True)
    apply_parser.add_argument("--reserved-region-start", required=True, type=int)
    apply_parser.add_argument("--reserved-region-end", required=True, type=int)
    apply_parser.add_argument("--signature-base64-file", required=True)
    apply_parser.set_defaults(func=command_apply)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
