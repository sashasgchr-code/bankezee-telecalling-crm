# C — DRY RUN: production hierarchy repair proposal (NOTHING WRITTEN)

Generated against `https://connect.bankezee.com` (read-only API) on September 3, 2026.
Writes performed: **0**. Machine-readable detail: `C_dryrun_hierarchy_repair.json`.
Regenerate with: `python3 /app/scripts/c_dryrun_hierarchy_repair.py`

## Evidence sources
| What | Source |
|---|---|
| Current production state | `GET /api/users` + `GET /api/files/?gp_id=` on connect.bankezee.com |
| Intended links | the preview database, which was configured from your @users spreadsheet and has `manager_id`/`tl_id` populated for the 19 active GPs |
| Matching between the two | normalized email only — no guessing |

## Headline numbers
| Measure | Value |
|---|---|
| Production user documents | 201 |
| Unique people (by email) | 129 |
| People with duplicate documents | 72 |
| …of which the duplicates have **different `id` values** | **5** |
| Proposed hierarchy link changes | 16 |
| Proposed link targets that could not be resolved | 0 |
| Files covered by the 16 proposed changes | 53 |

## Option 1 — Link repair only (RECOMMENDED)
16 `$set` operations on `manager_id` / `tl_id`. No document is deleted, no ownership field is
touched, no `role` is changed. Fully reversible (current values recorded in the JSON).

Proposed structure:
- **teja@bankezee.com** ← 6 people (`gujjarisaikiran13`, `jkavithabhai`, `lellachandana24`, `mohammadwameez607`, `pillalamarrishivasai`, `regurivijayendra`), 5 of them with TL **pinkynagulapally**
- **gujjarisaikiran13@gmail.com** (G Saikiran, sub-manager) ← 10 people, all with TL **yarragondaanusha**: `asma.sultana0r`, `banothunithinnaik`, `gosangideevenadevaswamy`, `kemidiraju134`, `masoommd7472`, `meghanaaaa.36`, `mivimivi51`, `nalavonilakshmipriya`, `nani9346480`, `srivallisiri537`

15 of the 16 currently have `manager_id: null`; 1 (`meghanaaaa.36@gmail.com`) currently points at
`saikiran@bankezee.com` and would move to `gujjarisaikiran13@gmail.com`.

**Two things to confirm before I would run this:**
1. Your org chart names *G Saikiran* (`gujjarisaikiran13@gmail.com`) as the sub-manager for
   Anusha's team, but in production his `role` is `telecaller`, not `manager`. Link repair alone
   will not change that. The recursive traversal in A+B follows the links regardless of role, so
   Teja would still reach the whole subtree — but if you want him to *log in* as a manager, that
   is a separate role change and I have not proposed it.
2. `saikiran@bankezee.com` (`role=manager`, active) has `manager_id: null` and would sit outside
   Teja's tree. Confirm whether that account is still in use, or is superseded by
   `gujjarisaikiran13@gmail.com`.

## Option 2 — Dedupe + link repair (NOT recommended right now)
Adds a merge of 72 duplicate pairs on top of Option 1. My recommendation is to skip it, because:
- **67 of the 72 pairs already share the same `id`**, so they are harmless to scoping — the
  identity resolver in A+B treats them as one person, and the counts prove it.
- Only **5** pairs have different ids, and A+B already resolves all five:

| email | would keep | other id | notes |
|---|---|---|---|
| teja@bankezee.com | `e37774a4-8b44-4f6f-a282-faeaa5ab6800` (manager) | `698c346470f2678cbac393c5` | **this is the pair that broke his scoping** — now resolved by A |
| admin@bankezee.com | `698c182cb2efa8083454f81f` | `2284e6a5-ad78-4a92-9898-52f7a12f2b8c` | admin, no files |
| manager@bankezee.com | `2bcfc93f-4af8-42ab-a7bd-8e16e35fb8ab` | `698c346570f2678cbac393c6` | no files |
| manager2@bankezee.com | `698c346670f2678cbac393c7` | `2b15b0eb-3acb-4ffe-b3cd-e1cf938ae871` | no files |
| rama@bankezee.com | `6d8a0c94-7cb2-4813-817b-532b02daecb2` | `698c346370f2678cbac393c4` | ops, no files |

None of the five own any files, so a merge would move no ownership — it would only reduce the row
count on the Users page from 201 to 129. Deleting documents is irreversible and would break any
historical record still referencing the discarded `id`, which is exactly what the identity
resolver was built to avoid.

Related data-quality observation (no change proposed): `is_active` is **missing entirely** on 38
documents. A+B evaluates "active" per person rather than per document, so this no longer drops
live team members, but it is worth normalising eventually.

## What I need from you
- Approve **Option 1** (16 link writes) — or Option 2, or neither.
- Answer the two confirmations above about G Saikiran's role and `saikiran@bankezee.com`.

I will not write anything until you say so explicitly.
