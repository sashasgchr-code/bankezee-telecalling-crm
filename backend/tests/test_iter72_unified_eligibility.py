# Iteration 72: unified eligibility (Meta Files Check Eligibility), doc-extract status, Connect regression, bank-result comparison
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
LEAD = "lead_swamytest01"
CONNECT_LEAD = "867d684d-e45f-45a8-af27-8add1848eeeb"


@pytest.fixture(scope="module")
def s():
    ss = requests.Session()
    r = ss.post(f"{API}/auth/login", json={"email": "admin@bankezee.com", "password": "ConnectSasha12!!"}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    d = r.json()
    tok = d.get("access_token") or d.get("token")
    if tok:
        ss.headers.update({"Authorization": f"Bearer {tok}"})
    return ss


# Meta check-eligibility: one authoritative result per lender, each with calc
def test_meta_check_eligibility(s):
    r = s.post(f"{API}/meta/files-compat/{LEAD}/check-eligibility", timeout=90)
    assert r.status_code == 200, r.text[:300]
    d = r.json()
    res = d.get("results") or []
    assert len(res) == 34, len(res)
    names = [x.get("bank_name") for x in res]
    assert len(names) == len(set(n.lower() for n in names)), "duplicate lenders"
    assert all("calc" in x and x["calc"] for x in res)
    summ = d.get("summary") or {}
    print("summary:", summ)
    print("profile keys:", list((d.get("engine_meta") or {}).keys()))
    from collections import Counter
    print(Counter(x.get("eligibility") for x in res))
    # status consistency between eligibility and calc.status
    m = {"Eligible": "eligible", "Needs Review": "possibly_eligible", "Not Eligible": "not_eligible"}
    bad = [(x["bank_name"], x["eligibility"], x["calc"].get("status")) for x in res if m.get(x["calc"].get("status")) != x["eligibility"]]
    assert not bad, bad[:5]


# Connect regression
def test_connect_check_eligibility(s):
    r = s.post(f"{API}/bank-policies/check-eligibility/{CONNECT_LEAD}", timeout=90)
    assert r.status_code == 200, r.text[:300]
    assert isinstance(r.json().get("results"), list)


# doc-extract status: processing false, no duplicate jobs
def test_doc_extract_status_idempotent(s):
    a = s.get(f"{API}/doc-extract/meta/{LEAD}", timeout=30)
    b = s.get(f"{API}/doc-extract/meta/{LEAD}", timeout=30)
    assert a.status_code == 200 and b.status_code == 200
    da, db_ = a.json(), b.json()
    assert da["processing"] is False and db_["processing"] is False
    ids = [x["doc_id"] for x in db_["documents"]]
    assert len(ids) == len(set(ids)), ids
    assert len(da["documents"]) == len(db_["documents"])
    print("docs:", [(x["doc_id"], x.get("status")) for x in db_["documents"]])
    print("conflicts:", [(c["id"], c.get("kind"), c.get("label") or c.get("field")) for c in db_.get("conflicts") or []])


# Retry on Form16 returns Failed with storage message
def test_retry_form16(s):
    r = s.post(f"{API}/doc-extract/meta/{LEAD}/documents/d_f16/retry", json={}, timeout=60)
    assert r.status_code == 200, r.text[:300]
    d = next(x for x in r.json()["documents"] if x["doc_id"] == "d_f16")
    print(d)
    assert d["status"].lower() == "failed"
    assert "not available in storage" in str(d).lower()


# Conflict invalid action -> 404
def test_conflict_bad(s):
    r = s.post(f"{API}/doc-extract/meta/{LEAD}/conflicts/nonexistent", json={"action": "apply"}, timeout=30)
    assert r.status_code == 404


# Bank result comparison uses same calculation as card
def test_bank_result_compare(s):
    elig = s.post(f"{API}/meta/files-compat/{LEAD}/check-eligibility", timeout=90).json()
    axis = next(x for x in elig["results"] if x["bank_name"].lower() == "axis bank")
    r = s.post(f"{API}/elig-compare/meta/{LEAD}/bank-result", json={"bank_name": "Axis Bank", "status": "Eligible", "amount": 800000}, timeout=60)
    assert r.status_code == 200, r.text[:300]
    d = r.json()
    print("calc status:", d["calculator"]["status"], "card:", axis["calc"]["status"], "mism:", d["mismatches"])
    assert d["calculator"]["status"] == axis["calc"]["status"]
    lst = s.get(f"{API}/elig-compare/meta/{LEAD}", timeout=30)
    assert lst.status_code == 200
    assert any(x["bank"] == "axis bank" for x in lst.json())
