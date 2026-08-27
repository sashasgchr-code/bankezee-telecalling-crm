"""Backend tests for leads filter/search + last_call_outcome query param."""
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    # Fallback: read frontend .env
    with open('/app/frontend/.env') as f:
        for line in f:
            if line.startswith('REACT_APP_BACKEND_URL='):
                BASE_URL = line.split('=', 1)[1].strip().rstrip('/')

AGENT = {"email": "agent@test.com", "password": "agent123"}
ADMIN = {"email": "admin@bankezee.com", "password": "ConnectSasha12!!"}


@pytest.fixture(scope="module")
def agent_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=AGENT)
    assert r.status_code == 200, f"Agent login failed: {r.status_code} {r.text}"
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    return r.json().get("access_token") or r.json().get("token")


def _hdr(t):
    return {"Authorization": f"Bearer {t}"}


class TestLeadsFilter:
    def test_list_leads_default(self, agent_token):
        r = requests.get(f"{BASE_URL}/api/leads", headers=_hdr(agent_token))
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)

    def test_search_by_name(self, agent_token):
        # get one lead's name first
        r = requests.get(f"{BASE_URL}/api/leads", headers=_hdr(agent_token))
        leads = r.json()
        if not leads:
            pytest.skip("No leads assigned to agent")
        name = leads[0].get("name", "")[:3]
        if not name:
            pytest.skip("Lead has no name")
        r2 = requests.get(f"{BASE_URL}/api/leads", headers=_hdr(agent_token), params={"search": name})
        assert r2.status_code == 200
        results = r2.json()
        assert isinstance(results, list)
        # every result should have name containing the substring (case-insensitive) or phone/email match
        for lead in results:
            hay = f"{lead.get('name','')} {lead.get('phone','')} {lead.get('email','')}".lower()
            assert name.lower() in hay

    def test_search_by_phone(self, agent_token):
        r = requests.get(f"{BASE_URL}/api/leads", headers=_hdr(agent_token))
        leads = r.json()
        if not leads:
            pytest.skip("No leads assigned")
        phone = str(leads[0].get("phone", ""))[:4]
        if not phone:
            pytest.skip("Lead has no phone")
        r2 = requests.get(f"{BASE_URL}/api/leads", headers=_hdr(agent_token), params={"search": phone})
        assert r2.status_code == 200
        for lead in r2.json():
            hay = f"{lead.get('name','')} {lead.get('phone','')} {lead.get('email','')}".lower()
            assert phone.lower() in hay

    @pytest.mark.parametrize("status", ["follow_up", "leads", "file", "not_interested"])
    def test_filter_by_status(self, agent_token, status):
        r = requests.get(f"{BASE_URL}/api/leads", headers=_hdr(agent_token), params={"status": status})
        assert r.status_code == 200
        for lead in r.json():
            assert lead.get("status") == status

    @pytest.mark.parametrize("outcome", [
        "connected", "no_answer", "switched_off", "not_connecting",
        "busy", "wrong_number", "voicemail"
    ])
    def test_filter_by_call_outcome(self, agent_token, outcome):
        r = requests.get(f"{BASE_URL}/api/leads", headers=_hdr(agent_token),
                         params={"last_call_outcome": outcome})
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        for lead in data:
            assert lead.get("last_call_outcome") == outcome

    def test_combined_status_and_outcome_filter(self, agent_token):
        r = requests.get(f"{BASE_URL}/api/leads", headers=_hdr(agent_token),
                         params={"status": "follow_up", "last_call_outcome": "connected"})
        assert r.status_code == 200
        for lead in r.json():
            assert lead.get("status") == "follow_up"
            assert lead.get("last_call_outcome") == "connected"
