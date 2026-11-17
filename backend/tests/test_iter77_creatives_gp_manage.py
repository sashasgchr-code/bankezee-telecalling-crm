# Iteration 77: Marketing Creatives (background analysis, placement, publish, replace, hide, personalised GP QR),
# Admin approve-as-active, GP user management (edit/password/view/active/delete), RBAC 403s.
import io
import os
import random
import sys
import time
import uuid

import pytest
import requests
from PIL import Image
from pymongo import MongoClient

sys.path.insert(0, "/app/backend")
from utils import creative_engine as ce  # noqa: E402

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    for ln in open("/app/frontend/.env"):
        if ln.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = ln.split("=", 1)[1].strip().rstrip("/")
API = BASE_URL + "/api"
FIX = "/app/backend/tests/fixtures/creatives"
P1_CODE = "TEST9B4002D6"
ENV = {k: v.strip('"') for k, v in (ln.strip().split("=", 1) for ln in open("/app/backend/.env") if "=" in ln)}
DB = MongoClient(ENV["MONGO_URL"])[ENV["DB_NAME"]]
S = {"creatives": {}, "users": [], "files": []}
ORIG = {"Origin": BASE_URL}


def H(t):
    return {"Authorization": f"Bearer {t}", **ORIG}


def mob():
    return "9" + "".join(random.choice("0123456789") for _ in range(9))


@pytest.fixture(scope="module")
def admin():
    r = requests.post(f"{API}/auth/login", json={"email": "admin@bankezee.com", "password": "ConnectSasha12!!"})
    assert r.status_code == 200
    return r.json()["token"]


@pytest.fixture(scope="module")
def ops():
    r = requests.post(f"{API}/auth/login", json={"email": "ops@bankezee.com", "password": "ops@bzc12"})
    if r.status_code != 200:
        pytest.skip("ops login failed")
    return r.json()["token"]


def gp_login(ident, pw):
    return requests.post(f"{API}/gp/login", json={"identifier": ident, "password": pw})


@pytest.fixture(scope="module")
def gp1():
    r = gp_login("8125832945", "Partner@123")
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def gp2(admin):
    m = mob()
    email = f"test_iter77_{uuid.uuid4().hex[:6]}@example.com"
    r = requests.post(f"{API}/gp/signup", json={"mobile": m, "email": email, "name": "TEST Iter77 GP2", "password": "Partner2@123"})
    assert r.status_code == 200, r.text
    u = DB.users.find_one({"email": email})
    S["users"].append(u["_id"])
    assert u.get("plain_password") == "Partner2@123"
    code = u["partner_code"]
    # approve requires reason
    assert requests.post(f"{API}/gp/admin/partners/{code}/approve", json={"reason": "  "}, headers=H(admin)).status_code == 400
    assert requests.post(f"{API}/gp/admin/partners/{code}/approve", json={}, headers=H(admin)).status_code == 422
    r = requests.post(f"{API}/gp/admin/partners/{code}/approve", json={"reason": "TEST approve iter77"}, headers=H(admin))
    assert r.status_code == 200
    p = [x for x in requests.get(f"{API}/gp/admin/partners", headers=H(admin)).json() if x["partner_id"] == code][0]
    assert p["status"].lower() == "active", p["status"]
    return {"token": gp_login(m, "Partner2@123").json()["token"], "code": code, "mobile": m, "email": email}


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    tok = requests.post(f"{API}/auth/login", json={"email": "admin@bankezee.com", "password": "ConnectSasha12!!"}).json()["token"]
    for cid in S["creatives"].values():
        requests.post(f"{API}/gp/admin/creatives/{cid}/hide", headers=H(tok))
        DB.gp_creatives.delete_one({"id": cid})
        DB.gp_creative_renders.delete_many({"creative_id": cid})
    for fid in S["files"]:
        DB.leads.delete_one({"id": fid})
    for _id in S["users"]:
        DB.gp_agreements.delete_many({"partner_id": str(_id)})
        DB.users.delete_one({"_id": _id})


def wait_done(admin, ids, timeout=150):
    end = time.time() + timeout
    while time.time() < end:
        rows = {c["id"]: c for c in requests.get(f"{API}/gp/admin/creatives", headers=H(admin)).json() if c["id"] in ids}
        if all(not rows[i].get("processing") for i in ids):
            return rows
        time.sleep(4)
    raise AssertionError("analysis did not finish")


# --- Creatives upload + background analysis ---
class TestCreatives:
    FILES = ["square_clear.png", "portrait_tiny_text.png", "landscape_crowded.jpg", "square_placeholder.webp", "footer_with_scan_label.png"]
    MIME = {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}

    def test_01_bulk_upload_returns_fast(self, admin):
        files = [("files", (f, open(f"{FIX}/{f}", "rb"), self.MIME[f.rsplit('.', 1)[1]])) for f in self.FILES]
        names = "|".join(f"TEST_i77 {f.split('.')[0]}" for f in self.FILES)
        t = time.time()
        r = requests.post(f"{API}/gp/admin/creatives", files=files, data={"names": names}, headers=H(admin))
        el = time.time() - t
        assert r.status_code == 200, r.text
        res = r.json()["results"]
        for f, c in zip(self.FILES, res):
            assert "error" not in c, c
            S["creatives"][f] = c["id"]
            assert c["processing"] == "analysing"
        print("upload secs", round(el, 2))
        assert el < 10

    def test_02_bad_mime_rejected(self, admin):
        r = requests.post(f"{API}/gp/admin/creatives", files=[("files", ("x.gif", b"GIF89a", "image/gif"))], headers=H(admin))
        assert r.status_code == 200 and "error" in r.json()["results"][0]

    def test_03_analysis_results(self, admin):
        rows = wait_done(admin, list(S["creatives"].values()))
        out = {f: rows[cid] for f, cid in S["creatives"].items()}
        for f, c in out.items():
            print(f, c["analysis"].get("source"), c["auto_placement"], c["placement"], c["issues"], c["qr_check"], c.get("processing_error"))
        for f, c in out.items():
            assert c["analysis"].get("source") == "ai", f
            assert c["qr_check"]["ok"] is True, f
            assert c["issues"] == [], (f, c["issues"])
        assert out["landscape_crowded.jpg"]["placement"]["mode"] == "footer"
        for f in ("square_placeholder.webp", "footer_with_scan_label.png"):
            p = out[f]["placement"]
            assert p["mode"] == "overlay" and p["caption"] is False, (f, p)
            z = out[f]["analysis"]["qr_placeholder"]
            assert z and z[0] <= p["x"] and z[1] <= p["y"] and p["x"] + p["size"] <= z[2] + 2 and p["y"] + p["size"] <= z[3] + 2, (f, p, z)
        pt = out["portrait_tiny_text.png"]
        assert pt["overlaps"] == []

    def test_04_edit_overlap_then_footer(self, admin):
        cid = S["creatives"]["landscape_crowded.jpg"]
        c = [x for x in requests.get(f"{API}/gp/admin/creatives", headers=H(admin)).json() if x["id"] == cid][0]
        sz = c["min_qr"] + 20
        r = requests.put(f"{API}/gp/admin/creatives/{cid}", json={"placement": {"mode": "overlay", "x": c["width"] // 2 - sz // 2, "y": c["height"] // 2 - sz // 2, "size": sz}},
                         headers=H(admin))
        assert r.status_code == 200
        assert r.json()["overlaps"] and r.json()["issues"]
        # min size enforced
        r = requests.put(f"{API}/gp/admin/creatives/{cid}", json={"placement": {"mode": "overlay", "x": 0, "y": 0, "size": 10}}, headers=H(admin))
        assert any("minimum" in i for i in r.json()["issues"])
        # publish blocked while issues
        r = requests.post(f"{API}/gp/admin/creatives/publish", json={"ids": [cid]}, headers=H(admin))
        assert r.json()["results"][0]["ok"] is False
        r = requests.put(f"{API}/gp/admin/creatives/{cid}", json={"placement": {"mode": "footer"}, "loan_type": "business_loan"}, headers=H(admin))
        assert r.status_code == 200 and r.json()["issues"] == [] and r.json()["placement"]["mode"] == "footer"
        pv = requests.get(f"{API}/gp/admin/creatives/{cid}/preview.png", headers=H(admin))
        assert pv.status_code == 200 and Image.open(io.BytesIO(pv.content)).height > c["height"]

    def test_05_publish_and_gallery_personalised(self, admin, gp1, gp2):
        ids = [S["creatives"]["landscape_crowded.jpg"], S["creatives"]["square_placeholder.webp"]]
        r = requests.post(f"{API}/gp/admin/creatives/publish", json={"ids": ids}, headers=H(admin))
        assert all(x["ok"] for x in r.json()["results"]), r.json()
        for tok, code in ((gp1, P1_CODE), (gp2["token"], gp2["code"])):
            g = requests.get(f"{API}/gp/creatives", headers=H(tok)).json()
            items = {i["id"]: i for i in g["items"]}
            for cid in ids:
                assert cid in items
                img = requests.get(f"{API}/gp/creatives/{cid}/image.png?download=true", headers=H(tok))
                assert img.status_code == 200 and "attachment" in img.headers.get("content-disposition", "")
                full, wa = ce.decode(Image.open(io.BytesIO(img.content)).convert("RGB"))
                assert full == items[cid]["link"] and wa == full, (full, items[cid]["link"])
                assert f"/r/{code}" in full
            assert items[ids[0]]["link"].endswith(f"/r/{code}?loan=business_loan")
            assert "?loan=" not in items[ids[1]]["link"]
            # filter by product
            f = requests.get(f"{API}/gp/creatives?loan_type=business_loan", headers=H(tok)).json()["items"]
            assert ids[0] in [i["id"] for i in f] and ids[1] not in [i["id"] for i in f]

    def test_06_replace_keeps_old_published(self, admin, gp1):
        cid = S["creatives"]["square_placeholder.webp"]
        r = requests.post(f"{API}/gp/admin/creatives/{cid}/replace", files={"file": ("sq.png", open(f"{FIX}/square_clear.png", "rb"), "image/png")}, headers=H(admin))
        assert r.status_code == 200 and r.json()["processing"] == "analysing" and r.json()["pending_republish"] is True
        it = [i for i in requests.get(f"{API}/gp/creatives", headers=H(gp1)).json()["items"] if i["id"] == cid][0]
        assert it["version"] == 1
        rows = wait_done(admin, [cid])
        assert rows[cid]["version"] == 2 and not rows[cid].get("processing")
        it = [i for i in requests.get(f"{API}/gp/creatives", headers=H(gp1)).json()["items"] if i["id"] == cid][0]
        assert it["version"] == 1
        r = requests.post(f"{API}/gp/admin/creatives/publish", json={"ids": [cid]}, headers=H(admin))
        assert r.json()["results"][0]["ok"], r.json()
        it = [i for i in requests.get(f"{API}/gp/creatives", headers=H(gp1)).json()["items"] if i["id"] == cid][0]
        assert it["version"] == 2

    def test_07_hide(self, admin, gp1):
        cid = S["creatives"]["square_placeholder.webp"]
        assert requests.post(f"{API}/gp/admin/creatives/{cid}/hide", headers=H(admin)).status_code == 200
        assert cid not in [i["id"] for i in requests.get(f"{API}/gp/creatives", headers=H(gp1)).json()["items"]]
        assert requests.get(f"{API}/gp/creatives/{cid}/image.png", headers=H(gp1)).status_code == 404


# --- RBAC ---
class TestRBAC:
    def test_ops_403(self, ops):
        for m, path in (("get", "/gp/admin/partners"), ("get", "/gp/admin/creatives"), ("post", f"/gp/admin/partners/{P1_CODE}/approve"),
                        ("put", f"/gp/admin/partners/{P1_CODE}/password"), ("get", f"/gp/admin/partners/{P1_CODE}/password"),
                        ("post", f"/gp/admin/partners/{P1_CODE}/active"), ("delete", f"/gp/admin/partners/{P1_CODE}"), ("post", "/gp/admin/creatives/publish")):
            r = getattr(requests, m)(f"{API}{path}", headers=H(ops), json={"reason": "x", "new_password": "xxxxxxxxx", "active": False, "ids": []})
            assert r.status_code == 403, (path, r.status_code)

    def test_gp_cannot_admin(self, gp1):
        assert requests.get(f"{API}/gp/admin/creatives", headers=H(gp1)).status_code == 403


# --- GP user management ---
class TestManage:
    def test_edit_duplicate_and_ok(self, admin, gp2):
        code = gp2["code"]
        r = requests.put(f"{API}/gp/admin/partners/{code}", json={"name": "TEST Iter77 GP2", "mobile": "8125832945", "email": gp2["email"]}, headers=H(admin))
        assert r.status_code == 409 and "already used" in r.json()["detail"]
        r = requests.put(f"{API}/gp/admin/partners/{code}", json={"name": "TEST Iter77 GP2", "mobile": gp2["mobile"], "email": "admin@bankezee.com"}, headers=H(admin))
        assert r.status_code == 409
        r = requests.put(f"{API}/gp/admin/partners/{code}", json={"name": "TEST Iter77 GP2 Edited", "mobile": gp2["mobile"], "email": gp2["email"]}, headers=H(admin))
        assert r.status_code == 200
        assert DB.users.find_one({"partner_code": code})["name"] == "TEST Iter77 GP2 Edited"

    def test_password_change_view(self, admin, gp2):
        code = gp2["code"]
        assert requests.put(f"{API}/gp/admin/partners/{code}/password", json={"new_password": "short"}, headers=H(admin)).status_code == 400
        assert requests.put(f"{API}/gp/admin/partners/{code}/password", json={"new_password": "NewPass@777"}, headers=H(admin)).status_code == 200
        assert requests.get(f"{API}/gp/admin/partners/{code}/password", headers=H(admin)).json()["password"] == "NewPass@777"
        assert gp_login(gp2["mobile"], "NewPass@777").status_code == 200
        assert gp_login(gp2["mobile"], "Partner2@123").status_code == 401

    def test_deactivate_reactivate(self, admin, gp2):
        code = gp2["code"]
        assert requests.post(f"{API}/gp/admin/partners/{code}/active", json={"active": False}, headers=H(admin)).status_code == 200
        r = gp_login(gp2["mobile"], "NewPass@777")
        assert r.status_code in (401, 403), r.status_code
        # existing token should no longer work
        me = requests.get(f"{API}/gp/me", headers=H(gp2["token"]))
        print("deactivated token /gp/me", me.status_code)
        assert requests.post(f"{API}/gp/admin/partners/{code}/active", json={"active": True}, headers=H(admin)).status_code == 200
        assert gp_login(gp2["mobile"], "NewPass@777").status_code == 200

    def test_delete_blocked_with_files_then_new_deleted(self, admin):
        m = mob()
        email = f"test_iter77d_{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(f"{API}/gp/signup", json={"mobile": m, "email": email, "name": "TEST Iter77 Del", "password": "DelPass@123"})
        assert r.status_code == 200
        tok = r.json()["token"]
        u = DB.users.find_one({"email": email})
        S["users"].append(u["_id"])
        code = u["partner_code"]
        requests.post(f"{API}/gp/admin/partners/{code}/approve", json={"reason": "TEST"}, headers=H(admin))
        f = requests.post(f"{API}/gp/files", json={"name": "TEST_i77 cust", "mobile": mob(), "loan_type": "new_personal_loan", "employment_type": "salaried", "consent": True},
                          headers=H(tok))
        if f.status_code == 200:
            fid = f.json().get("file_id") or f.json().get("id") or (f.json().get("file") or {}).get("id")
            lead = DB.leads.find_one({"$or": [{"id": fid}, {"file_id": fid}]}) if fid else None
            if lead:
                S["files"].append(lead["id"])
            r = requests.delete(f"{API}/gp/admin/partners/{code}", headers=H(admin))
            assert r.status_code == 409 and "Deactivate" in r.json()["detail"], r.text
            for fid in S["files"]:
                DB.leads.delete_one({"id": fid})
            S["files"].clear()
        else:
            print("gp file create failed", f.status_code, f.text[:200])
        r = requests.delete(f"{API}/gp/admin/partners/{code}", headers=H(admin))
        assert r.status_code == 200, r.text
        assert DB.users.find_one({"email": email}) is None
