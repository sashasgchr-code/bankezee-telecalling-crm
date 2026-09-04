#!/usr/bin/env python3
"""Dynamic scope check: moving a TL under a Manager must change the Manager's Track Report
population immediately, and moving her back must restore it. Preview only; always restores."""
import asyncio, json, os, sys, urllib.request, urllib.error
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

BASE = 'https://responsive-crm-app-1.preview.emergentagent.com'
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
TL_EMAIL = 'yarragondaanusha@gmail.com'
TEJA_ID = 'e37774a4-8b44-4f6f-a282-faeaa5ab6800'
load_dotenv('/app/backend/.env')


def req(p, t=None, m='GET', b=None):
    r = urllib.request.Request(BASE + p, method=m)
    r.add_header('Content-Type', 'application/json')
    r.add_header('User-Agent', UA)
    if t:
        r.add_header('Authorization', 'Bearer ' + t)
    try:
        with urllib.request.urlopen(r, json.dumps(b).encode() if b else None, timeout=300) as z:
            return z.status, json.loads(z.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:200]


def mgr_token():
    _, d = req('/api/auth/login', m='POST', b={'email': 'teja@bankezee.com', 'password': 'tejasme12'})
    return d.get('access_token') or d.get('token')


async def set_manager(value):
    client = AsyncIOMotorClient(os.environ['MONGO_URL'])
    db = client[os.environ['DB_NAME']]
    await db.users.update_many({'email': TL_EMAIL}, {'$set': {'manager_id': value}})


def scope():
    t = mgr_token()
    s, rows = req('/api/reports/daily-tracking-sheet?month=9&year=2026', t)
    s2, members = req('/api/users/manager-team-members', t)
    mem = members.get('members', []) if isinstance(members, dict) else []
    return (s, len(rows) if isinstance(rows, list) else rows, len(mem))


before_mgr = '6a9858b55c918623d6764602'
s, track_before, mem_before = scope()
print(f"baseline           : track={track_before} dashboard_members={mem_before} (HTTP {s})")

asyncio.run(set_manager(TEJA_ID))
s, track_after, mem_after = scope()
print(f"TL moved under Teja: track={track_after} dashboard_members={mem_after} (HTTP {s})")

asyncio.run(set_manager(before_mgr))
s, track_restored, mem_restored = scope()
print(f"restored           : track={track_restored} dashboard_members={mem_restored} (HTTP {s})")

ok = (track_after > track_before and mem_after > mem_before
      and track_restored == track_before and mem_restored == mem_before)
print(f"\n{'PASS' if ok else 'FAIL'}  Track Report scope follows hierarchy changes and restores")
sys.exit(0 if ok else 1)
