"""Marketing Creatives: Admin uploads/publishes artwork; each Growth Partner downloads it with their own application QR."""
import asyncio
import hashlib
import uuid
from typing import List, Optional
from urllib.parse import urlparse

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Request
from fastapi.responses import Response
from motor.motor_asyncio import AsyncIOMotorGridFSBucket
from pydantic import BaseModel

from utils.database import db
from utils import creative_engine as ce
from config.loan_types import LOAN_TYPES
from routes.gp_portal import require_admin_only, require_gp, raw_user, now

router = APIRouter(prefix="/api/gp", tags=["Marketing Creatives"])
BUCKET = lambda: AsyncIOMotorGridFSBucket(db, bucket_name="gp_creatives")  # noqa: E731
MIMES = {"image/png", "image/jpeg", "image/jpg", "image/webp"}
LOAN_LABEL = {t["value"]: t["label"] for t in LOAN_TYPES}
DEFAULT_BASE = "https://connect.bankezee.com"
TRUSTED = (".bankezee.com", ".emergentagent.com", ".emergent.host", ".emergentcf.cloud")
SEM = asyncio.Semaphore(3)


def base_url(req: Request):
    o = req.headers.get("origin") or req.headers.get("referer") or ""
    u = urlparse(o)
    host = u.hostname or ""
    return f"{u.scheme}://{u.netloc}" if u.scheme == "https" and (host == "bankezee.com" or host.endswith(TRUSTED)) else DEFAULT_BASE


def app_link(base, code, loan_type):
    return f"{base}/r/{code}" + (f"?loan={loan_type}" if loan_type else "")


async def put(data: bytes, name: str, meta: dict):
    return str(await BUCKET().upload_from_stream(name, data, metadata=meta))


async def get(fid: str) -> bytes:
    s = await BUCKET().open_download_stream(ObjectId(fid))
    return await s.read()


def view(c):
    c = {k: v for k, v in c.items() if k != "_id"}
    c["loan_label"] = LOAN_LABEL.get(c.get("loan_type"))
    c["min_qr"] = ce.min_qr(c["width"], c["height"])
    return c


async def evaluate(art, c, placement, base):
    """Validate a placement: bounds, size, overlaps, then render the preview and check the QR decodes (incl. WhatsApp-style recompression)."""
    W, H = art.size
    issues, hits = [], []
    if placement["mode"] == "overlay":
        placement = {**placement, "x": int(placement["x"]), "y": int(placement["y"]), "size": int(placement["size"]), "caption": placement.get("caption", True) is not False}
        placement["zone"] = c["analysis"].get("qr_placeholder")
        if placement["size"] < ce.min_qr(W, H):
            issues.append(f"QR is smaller than the minimum scannable size ({ce.min_qr(W, H)} px)")
        if not ce.in_bounds(placement, W, H):
            issues.append("QR goes outside the image")
        hits = ce.overlaps(placement, c["analysis"], W, H, ce.busy_map(art))
        if hits:
            issues.append(f"QR covers {', '.join(sorted({h['kind'] for h in hits}))} — move it or use Add QR Footer")
    url = app_link(base, "PREVIEW", c.get("loan_type"))
    out = ce.render(art, placement, url, add_logo=not c["analysis"].get("has_bankezee_logo"))
    full, wa = ce.decode(out)
    ok = full == url and wa == url
    if not ok:
        issues.append("QR did not decode from the finished image" if full != url else "QR fails after WhatsApp-style compression")
    return placement, {"issues": issues, "overlaps": hits, "qr_check": {"ok": ok, "decoded": full == url, "whatsapp_ok": wa == url},
                       "export": {"width": out.width, "height": out.height}}


async def analyse_and_place(art):
    try:
        analysis = await ce.analyse(art)
    except Exception as e:
        analysis = {"occupied": [], "qr_placeholder": None, "blank_footer": None, "has_bankezee_logo": False, "source": "unavailable", "error": str(e)[:200]}
    return analysis, ce.auto_place(art, analysis)


def placeholder_fields(art):
    return {"width": art.width, "height": art.height, "orientation": "square" if abs(art.width - art.height) < 0.05 * art.width else "portrait" if art.height > art.width else "landscape",
            "analysis": {"occupied": [], "source": "pending"}, "auto_placement": {"mode": "footer", "reason": "Analysing layout…"}, "placement": {"mode": "footer"},
            "issues": ["Layout analysis in progress"], "overlaps": [], "qr_check": {"ok": False}, "export": None}


async def process(cid, base):
    """Background: layout analysis + automatic placement + scan check (too slow for a single HTTP request)."""
    import logging
    try:
        c = await load_c(cid)
        art = ce.load(await get(c["image_id"]))
        async with SEM:
            analysis, auto = await analyse_and_place(art)
        c.update(analysis=analysis, auto_placement=auto)
        placement, ev = await evaluate(art, c, {k: v for k, v in auto.items() if k != "reason"}, base)
        await db.gp_creatives.update_one({"id": cid, "image_id": c["image_id"]}, {"$set": {"analysis": analysis, "auto_placement": auto, "placement": placement, **ev,
                                                                                         "processing": None, "processing_error": None, "updated_at": now()}})
    except Exception as e:
        logging.getLogger(__name__).exception(f"creative {cid} processing failed")
        await db.gp_creatives.update_one({"id": cid}, {"$set": {"processing": None, "processing_error": str(e)[:200], "issues": ["Layout analysis failed — click Retry analysis"]}})


_TASKS = set()


def start(cid, base):
    t = asyncio.create_task(process(cid, base))
    _TASKS.add(t)
    t.add_done_callback(_TASKS.discard)


async def ingest(f: UploadFile, name: str, loan_type: Optional[str], base: str, user: dict):
    data = await f.read()
    if (f.content_type or "").lower() not in MIMES:
        return {"file": f.filename, "error": "Only PNG, JPG, JPEG or WebP images"}
    if len(data) > 15 * 1024 * 1024:
        return {"file": f.filename, "error": "Image is larger than 15 MB"}
    try:
        art = ce.load(data)
    except Exception:
        return {"file": f.filename, "error": "Could not read this image"}
    cid = uuid.uuid4().hex[:12]
    c = {"id": cid, "name": name or (f.filename or "Creative").rsplit(".", 1)[0], "loan_type": loan_type if loan_type in LOAN_LABEL else None,
         "status": "draft", "version": 1, "image_id": await put(data, f.filename or "creative", {"creative_id": cid, "version": 1}), "mime": f.content_type,
         **placeholder_fields(art), "processing": "analysing", "processing_started": now(), "created_at": now(), "created_by": user.get("name"), "updated_at": now()}
    await db.gp_creatives.insert_one(dict(c))
    start(cid, base)
    return view(c)


@router.post("/admin/creatives")
async def upload(request: Request, files: List[UploadFile] = File(...), names: Optional[str] = Form(None), loan_type: Optional[str] = Form(None),
                 u: dict = Depends(require_admin_only)):
    if len(files) > 25:
        raise HTTPException(400, "Upload up to 25 images at a time")
    nm = [n.strip() for n in (names or "").split("|")]
    res = [await ingest(f, nm[i] if i < len(nm) else "", loan_type, base_url(request), u) for i, f in enumerate(files)]
    return {"results": res}


@router.post("/admin/creatives/{cid}/reanalyse")
async def reanalyse(cid: str, request: Request, _: dict = Depends(require_admin_only)):
    await load_c(cid)
    await db.gp_creatives.update_one({"id": cid}, {"$set": {"processing": "analysing", "processing_started": now(), "processing_error": None}})
    start(cid, base_url(request))
    return {"ok": True}


@router.get("/admin/creatives")
async def list_creatives(_: dict = Depends(require_admin_only)):
    from datetime import datetime, timezone, timedelta
    stale = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    await db.gp_creatives.update_many({"processing": "analysing", "processing_started": {"$lt": stale}},
                                      {"$set": {"processing": None, "processing_error": "Analysis did not finish", "issues": ["Layout analysis did not finish — click Retry analysis"]}})
    return [view(c) for c in await db.gp_creatives.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)]


async def load_c(cid):
    c = await db.gp_creatives.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(404, "Creative not found")
    return c


@router.get("/admin/creatives/{cid}/original")
async def original(cid: str, _: dict = Depends(require_admin_only)):
    c = await load_c(cid)
    return Response(await get(c["image_id"]), media_type=c.get("mime") or "image/png")


@router.get("/admin/creatives/{cid}/preview.png")
async def preview(cid: str, request: Request, _: dict = Depends(require_admin_only)):
    c = await load_c(cid)
    art = ce.load(await get(c["image_id"]))
    out = ce.render(art, c["placement"], app_link(base_url(request), "PREVIEW", c.get("loan_type")), not c["analysis"].get("has_bankezee_logo"))
    return Response(ce.png_bytes(out), media_type="image/png")


class Placement(BaseModel):
    mode: str
    caption: Optional[bool] = True
    x: Optional[float] = 0
    y: Optional[float] = 0
    size: Optional[float] = 0


class Edit(BaseModel):
    name: Optional[str] = None
    loan_type: Optional[str] = None
    placement: Optional[Placement] = None
    use_auto: Optional[bool] = False


@router.put("/admin/creatives/{cid}")
async def edit(cid: str, inp: Edit, request: Request, u: dict = Depends(require_admin_only)):
    c = await load_c(cid)
    if c.get("processing"):
        raise HTTPException(409, "Layout analysis is still running — try again in a few seconds")
    if inp.name is not None:
        c["name"] = inp.name.strip() or c["name"]
    if inp.loan_type is not None:
        c["loan_type"] = inp.loan_type if inp.loan_type in LOAN_LABEL else None
    pl = c["placement"]
    if inp.use_auto:
        pl = {k: v for k, v in c["auto_placement"].items() if k != "reason"}
    elif inp.placement:
        if inp.placement.mode not in ("overlay", "footer"):
            raise HTTPException(400, "Placement must be overlay or footer")
        pl = inp.placement.dict() if inp.placement.mode == "overlay" else {"mode": "footer"}
    art = ce.load(await get(c["image_id"]))
    pl, ev = await evaluate(art, c, pl, base_url(request))
    upd = {"name": c["name"], "loan_type": c["loan_type"], "placement": pl, **ev, "updated_at": now(), "updated_by": u.get("name")}
    await db.gp_creatives.update_one({"id": cid}, {"$set": upd})
    return view({**c, **upd})


@router.post("/admin/creatives/{cid}/replace")
async def replace(cid: str, request: Request, file: UploadFile = File(...), u: dict = Depends(require_admin_only)):
    c = await load_c(cid)
    data = await file.read()
    if (file.content_type or "").lower() not in MIMES or len(data) > 15 * 1024 * 1024:
        raise HTTPException(400, "Upload a PNG, JPG, JPEG or WebP image up to 15 MB")
    art = ce.load(data)
    v = c["version"] + 1
    upd = {"version": v, "image_id": await put(data, file.filename or "creative", {"creative_id": cid, "version": v}), "mime": file.content_type, **placeholder_fields(art),
           "processing": "analysing", "processing_started": now(), "processing_error": None, "updated_at": now(), "updated_by": u.get("name"),
           "pending_republish": bool(c.get("published"))}
    await db.gp_creatives.update_one({"id": cid}, {"$set": upd})
    start(cid, base_url(request))
    return view({**c, **upd})


class Ids(BaseModel):
    ids: List[str]


@router.post("/admin/creatives/publish")
async def publish(inp: Ids, u: dict = Depends(require_admin_only)):
    out = []
    for cid in inp.ids:
        c = await db.gp_creatives.find_one({"id": cid}, {"_id": 0})
        if not c:
            out.append({"id": cid, "ok": False, "error": "Not found"})
        elif c.get("processing"):
            out.append({"id": cid, "ok": False, "error": "Layout analysis is still running"})
        elif c.get("issues"):
            out.append({"id": cid, "ok": False, "error": "; ".join(c["issues"])})
        else:
            snap = {k: c[k] for k in ("version", "image_id", "placement", "loan_type", "name", "width", "height")} | {
                "add_logo": not c["analysis"].get("has_bankezee_logo"), "export": c.get("export"), "published_at": now(), "published_by": u.get("name")}
            await db.gp_creatives.update_one({"id": cid}, {"$set": {"status": "published", "published": snap, "pending_republish": False}})
            out.append({"id": cid, "ok": True})
    return {"results": out}


@router.post("/admin/creatives/{cid}/hide")
async def hide(cid: str, _: dict = Depends(require_admin_only)):
    await load_c(cid)
    await db.gp_creatives.update_one({"id": cid}, {"$set": {"status": "hidden", "updated_at": now()}})
    return {"ok": True}


# ---------------- Growth Partner gallery ----------------
async def partner_code(u):
    raw = await raw_user(u)
    code = (raw or {}).get("partner_code")
    return code if code and (raw or {}).get("is_active", True) else None


@router.get("/creatives")
async def gallery(request: Request, loan_type: str = "", u: dict = Depends(require_gp)):
    code = await partner_code(u)
    q = {"status": "published", "published": {"$exists": True}}
    rows = await db.gp_creatives.find(q, {"_id": 0, "id": 1, "published": 1}).sort("published.published_at", -1).to_list(500)
    base = base_url(request)
    items = [{"id": r["id"], "name": r["published"]["name"], "loan_type": r["published"].get("loan_type"), "loan_label": LOAN_LABEL.get(r["published"].get("loan_type")),
              "version": r["published"]["version"], "export": r["published"].get("export"), "link": app_link(base, code, r["published"].get("loan_type")) if code else None}
             for r in rows]
    if loan_type:
        items = [i for i in items if (i["loan_type"] or "") == ("" if loan_type == "general" else loan_type)]
    return {"items": items, "link_available": bool(code), "message": None if code else "Your application link isn't available yet — contact Bankezee support to activate your Partner ID."}


@router.get("/creatives/{cid}/image.png")
async def partner_image(cid: str, request: Request, download: bool = False, u: dict = Depends(require_gp)):
    code = await partner_code(u)
    if not code:
        raise HTTPException(409, "Your application link isn't available yet")
    c = await db.gp_creatives.find_one({"id": cid, "status": "published"}, {"_id": 0, "published": 1})
    if not c or not c.get("published"):
        raise HTTPException(404, "Creative not found")
    p = c["published"]
    url = app_link(base_url(request), code, p.get("loan_type"))
    key = hashlib.sha256(f"{cid}|{p['version']}|{p['published_at']}|{code}|{url}".encode()).hexdigest()
    hit = await db.gp_creative_renders.find_one({"key": key})
    if hit:
        data = await get(hit["file_id"])
    else:
        out = ce.render(ce.load(await get(p["image_id"])), p["placement"], url, p.get("add_logo", True))
        full, _ = ce.decode(out)
        if full != url:
            raise HTTPException(500, "Could not generate a scannable QR for this creative — please contact support")
        data = ce.png_bytes(out)
        fid = await put(data, f"render-{cid}-{code}.png", {"render": True, "creative_id": cid, "partner_code": code})
        await db.gp_creative_renders.update_one({"key": key}, {"$set": {"key": key, "file_id": fid, "creative_id": cid, "version": p["version"], "partner_code": code, "at": now()}},
                                                upsert=True)
    name = "".join(ch if ch.isalnum() else "-" for ch in p["name"]).strip("-")[:60] or "creative"
    hdr = {"Content-Disposition": f'attachment; filename="Bankezee-{name}-{code}.png"'} if download else {}
    return Response(data, media_type="image/png", headers={**hdr, "Cache-Control": "private, no-store"})
