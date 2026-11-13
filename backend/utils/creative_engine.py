"""Marketing creative engine: layout analysis, automatic QR placement, rendering and scan check."""
import io
import json
import os
import re
import tempfile
import uuid
from pathlib import Path

import numpy as np
import qrcode
from PIL import Image, ImageDraw, ImageFont

ASSETS = Path(__file__).resolve().parent.parent / "assets"
CAPTION = 0.2          # caption strip under an overlay QR, as a fraction of QR size
MIN_EXPORT_SHORT = 1080
_logo = None


def font(size, bold=True):
    return ImageFont.truetype(str(ASSETS / ("LiberationSans-Bold.ttf" if bold else "LiberationSans-Regular.ttf")), max(8, int(size)))


def load(data: bytes) -> Image.Image:
    im = Image.open(io.BytesIO(data))
    im.load()
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, "white")
        bg.paste(im, mask=im.split()[-1])
        return bg
    return im.convert("RGB")


def export_base(im: Image.Image) -> Image.Image:
    """Upscale small artwork so the QR stays readable; never changes proportions."""
    s = min(im.size)
    if s >= MIN_EXPORT_SHORT:
        return im
    k = MIN_EXPORT_SHORT / s
    return im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)


def min_qr(w, h):
    return max(220, round(0.15 * min(w, h)))


def default_qr(w, h):
    return max(min_qr(w, h), round(0.2 * min(w, h)))


def footprint(p):
    return (p["x"], p["y"], p["x"] + p["size"], p["y"] + round(p["size"] * (1 + CAPTION)))


def _inter(a, b):
    return not (a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1])


def busy_map(im: Image.Image):
    """Local layout analysis: gradient density + colour variation on a downscaled copy."""
    k = 480 / max(im.size)
    sm = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.BILINEAR)
    a = np.asarray(sm.convert("L"), dtype=np.float32)
    gx = np.abs(np.diff(a, axis=1, prepend=a[:, :1]))
    gy = np.abs(np.diff(a, axis=0, prepend=a[:1, :]))
    return (np.maximum(gx, gy) > 18), k


def region_busy(bm, k, box):
    x0, y0, x1, y1 = [round(v * k) for v in box]
    r = bm[max(0, y0):max(1, y1), max(0, x0):max(1, x1)]
    return float(r.mean()) if r.size else 1.0


ANALYSIS_PROMPT = """You analyse a marketing creative so a QR code can be added without covering anything important.
Return ONLY JSON:
{"occupied":[{"kind":"text|logo|cta|disclaimer|face|person|product|artwork|contact","box":[x0,y0,x1,y1]}],
 "qr_placeholder":[x0,y0,x1,y1] or null,
 "blank_footer":[x0,y0,x1,y1] or null,
 "has_bankezee_logo":true|false}
Coordinates are integers 0-1000 relative to image width (x) and height (y).
List EVERY piece of text including tiny print, phone numbers, URLs, disclaimers, logos, buttons, faces, people, products and illustrations.
qr_placeholder = an empty box/frame clearly meant for a QR code (e.g. labelled "scan", or a blank white square). blank_footer = an empty plain band at the bottom with no content.
has_bankezee_logo = true only if the Bankezee brand name/logo is visible."""


async def analyse(im: Image.Image) -> dict:
    from emergentintegrations.llm.chat import LlmChat, UserMessage, FileContentWithMimeType
    k = 1280 / max(im.size)
    sm = im.resize((round(im.width * k), round(im.height * k))) if k < 1 else im
    t = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
    sm.save(t, format="PNG")
    t.close()
    try:
        chat = LlmChat(api_key=os.environ["EMERGENT_LLM_KEY"], session_id=f"creative-{uuid.uuid4().hex}",
                       system_message="You are a precise layout-analysis engine. Reply with JSON only.").with_model("gemini", "gemini-3-flash-preview")
        txt = await chat.send_message(UserMessage(text=ANALYSIS_PROMPT, file_contents=[FileContentWithMimeType(file_path=t.name, mime_type="image/png")]))
    finally:
        os.unlink(t.name)
    m = re.search(r"\{.*\}", str(txt), re.S)
    raw = json.loads(m.group(0)) if m else {}
    W, H = im.size

    def px(b):
        if not isinstance(b, (list, tuple)) or len(b) != 4:
            return None
        x0, y0, x1, y1 = [float(v) for v in b]
        return [round(min(x0, x1) * W / 1000), round(min(y0, y1) * H / 1000), round(max(x0, x1) * W / 1000), round(max(y0, y1) * H / 1000)]
    occ = [{"kind": str(o.get("kind", "content")), "box": px(o.get("box"))} for o in raw.get("occupied") or [] if isinstance(o, dict) and px(o.get("box"))]
    return {"occupied": occ, "qr_placeholder": px(raw.get("qr_placeholder")), "blank_footer": px(raw.get("blank_footer")),
            "has_bankezee_logo": bool(raw.get("has_bankezee_logo")), "source": "ai"}


def overlaps(p, analysis, W, H, bmk=None):
    """Occupied regions intersecting the QR footprint (+ safety padding)."""
    pad = round(0.015 * min(W, H))
    f = footprint(p)
    fp = (f[0] - pad, f[1] - pad, f[2] + pad, f[3] + pad)
    z = p.get("zone")
    if z and f[0] >= z[0] and f[1] >= z[1] and f[2] <= z[2] and f[3] <= z[3]:
        inside = lambda o: o[0] >= z[0] - 6 and o[1] >= z[1] - 6 and o[2] <= z[2] + 6 and o[3] <= z[3] + 6  # noqa: E731
        return [o for o in analysis.get("occupied", []) if not inside(o["box"]) and _inter(f, o["box"])]
    hits = [o for o in analysis.get("occupied", []) if _inter(fp, o["box"])]
    if bmk is not None:
        bm, k = bmk
        if region_busy(bm, k, fp) > 0.02:
            hits.append({"kind": "detail", "box": list(f)})
    return hits


def in_bounds(p, W, H):
    f = footprint(p)
    return f[0] >= 0 and f[1] >= 0 and f[2] <= W and f[3] <= H


def auto_place(im: Image.Image, analysis: dict):
    """Placeholder -> blank footer band -> clear area (lower-right first) -> else white footer."""
    W, H = im.size
    if analysis.get("source") != "ai":
        return {"mode": "footer", "reason": "Layout analysis unavailable — footer used for safety"}
    mn, dq = min_qr(W, H), default_qr(W, H)
    bmk = busy_map(im)
    for key, label in (("qr_placeholder", "Blank QR placeholder"), ("blank_footer", "Existing blank footer")):
        b = analysis.get(key)
        if b:
            bw, bh = b[2] - b[0], b[3] - b[1]
            size = min(round(bw * 0.92), round(bh * 0.92 / (1 + CAPTION)), round(1.4 * dq))
            if size >= mn:
                p = {"mode": "overlay", "size": size, "x": b[0] + (bw - size) // 2 if key == "qr_placeholder" else b[2] - size - round(0.03 * W),
                     "y": b[1] + (bh - round(size * (1 + CAPTION))) // 2}
                if key == "qr_placeholder":
                    p["zone"] = b
                if in_bounds(p, W, H) and not overlaps(p, analysis, W, H, bmk):
                    return {**p, "reason": label}
    m = round(0.03 * min(W, H))
    for size in (dq, mn):
        fh = round(size * (1 + CAPTION))
        corners = [(W - size - m, H - fh - m, "Clear lower-right area"), (m, H - fh - m, "Clear lower-left area"),
                   (W - size - m, m, "Clear upper-right area"), (m, m, "Clear upper-left area")]
        step = max(8, size // 6)
        grid = [(x, y, "Clear area") for y in range(H - fh - m, m - 1, -step) for x in range(W - size - m, m - 1, -step)]
        for x, y, why in corners + grid:
            p = {"mode": "overlay", "x": int(x), "y": int(y), "size": int(size)}
            if in_bounds(p, W, H) and not overlaps(p, analysis, W, H, bmk):
                return {**p, "reason": why}
    return {"mode": "footer", "reason": "No clear area large enough — white footer added"}


def qr_tile(url: str, size: int) -> Image.Image:
    q = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=4, box_size=1)
    q.add_data(url)
    q.make(fit=True)
    n = q.modules_count + 8
    box = max(3, size // n)
    q.box_size = box
    img = q.make_image(fill_color="black", back_color="white").get_image().convert("RGB")
    tile = Image.new("RGB", (size, size), "white")
    tile.paste(img, ((size - img.width) // 2, (size - img.height) // 2))
    return tile


def logo_img():
    global _logo
    if _logo is None:
        _logo = Image.open(ASSETS / "bankezee-logo.png").convert("RGBA")
    return _logo


def render(art: Image.Image, placement: dict, url: str, add_logo: bool) -> Image.Image:
    im = export_base(art)
    k = im.width / art.width
    W, H = im.size
    if placement.get("mode") == "overlay":
        size = round(placement["size"] * k)
        x, y = round(placement["x"] * k), round(placement["y"] * k)
        out = im.copy()
        cap = round(size * CAPTION)
        d = ImageDraw.Draw(out)
        d.rectangle([x, y, x + size, y + size + cap], fill="white")
        out.paste(qr_tile(url, size), (x, y))
        f = font(cap * 0.55)
        t = "Scan to Apply"
        tw = d.textlength(t, font=f)
        d.text((x + (size - tw) / 2, y + size + cap * 0.12), t, fill="black", font=f)
        return out
    size = max(min_qr(W, H), round(0.17 * W) if W >= H else round(0.24 * W))
    pad = round(size * 0.12)
    fh = size + 2 * pad
    out = Image.new("RGB", (W, H + fh), "white")
    out.paste(im, (0, 0))
    out.paste(qr_tile(url, size), (W - size - pad, H + pad))
    d = ImageDraw.Draw(out)
    d.line([(0, H), (W, H)], fill=(225, 228, 222), width=max(1, round(fh * 0.01)))
    left = pad
    if add_logo:
        lg = logo_img()
        lh = round(fh * 0.42)
        lw = round(lg.width * lh / lg.height)
        lgr = lg.resize((lw, lh), Image.LANCZOS)
        out.paste(lgr, (left, H + (fh - lh) // 2), lgr)
        left += lw + pad
    f1, f2 = font(fh * 0.2), font(fh * 0.1, bold=False)
    room = W - size - 2 * pad - left
    if room > fh * 0.9:
        d.text((left, H + fh * 0.28), "Scan to Apply", fill=(20, 24, 20), font=f1)
        d.text((left, H + fh * 0.56), "Quick loan application with Bankezee", fill=(90, 95, 90), font=f2)
    else:
        f = font(pad * 0.7)
        t = "Scan to Apply"
        d.text((W - size - pad + (size - d.textlength(t, font=f)) / 2, H + pad * 0.15), t, fill="black", font=f)
    return out


def decode(im: Image.Image):
    import cv2
    det = cv2.QRCodeDetector()

    def read(img):
        a = cv2.cvtColor(np.asarray(img), cv2.COLOR_RGB2BGR)
        val, pts, _ = det.detectAndDecode(a)
        return val or None
    full = read(im)
    k = 1280 / max(im.size)
    wa = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS) if k < 1 else im
    buf = io.BytesIO()
    wa.save(buf, format="JPEG", quality=60)
    return full, read(Image.open(io.BytesIO(buf.getvalue())).convert("RGB"))


def png_bytes(im: Image.Image) -> bytes:
    b = io.BytesIO()
    im.save(b, format="PNG", optimize=True)
    return b.getvalue()
