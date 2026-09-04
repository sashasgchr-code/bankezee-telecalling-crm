# User Management duplicates - test_database

- user documents: **128**
- distinct people: **127**
- people with more than one document: **1** (documents involved: 2)
- rows BEFORE (one per document): **128** -> rows AFTER (one per person): **127**

## Before / after per duplicated person

| Person | rows before | rows after | account _id | id | connect_id | legacy_user_id | credential | active | role | treated as |
|---|---|---|---|---|---|---|---|---|---|---|
| Asma Sultana  | 2 | 1 | `6a96f82aaf607d4f8688f293` | `6a5866a969071f897aef93a1` | `6a5866a969071f897aef93a1` | `8f4d4bca-297c-49f4-ad8e-a1152f8ce21f` | password | True | sales_agent | **CURRENT (row + writes target this row)** |
| Asma Sultana  | 2 | 1 | `6a97e7d876f42c7795c2eaeb` | `1effe555-e818-4a34-9ac3-21f2938933c5` | `None` | `1effe555-e818-4a34-9ac3-21f2938933c5` | none | False | sales_agent | linked account (administer explicitly) |

## Watch-list names (reported in production)

- **asma**: 2 document(s), 1 person(s) -> 1 row(s) in User Management
    - `6a96f82aaf607d4f8688f293` id=`6a5866a969071f897aef93a1` asma.sultana0r@gmail.com cred=password active=True role=sales_agent <= CURRENT
    - `6a97e7d876f42c7795c2eaeb` id=`1effe555-e818-4a34-9ac3-21f2938933c5` asma.Sultana0r@gmail.com cred=none active=False role=sales_agent <= linked
- **karuna**: 1 document(s), 1 person(s) -> 1 row(s) in User Management
    - `6a96f82aaf607d4f8688f2ab` id=`6a868ae7119d0a4fd2da7c70` bkarunanidhi16@gmail.com cred=none active=False role=telecaller <= CURRENT
- **nithin**: 1 document(s), 1 person(s) -> 1 row(s) in User Management
    - `6a96f82aaf607d4f8688f28c` id=`6a43535269071f897aeeb626` banothunithinnaik@gmail.com cred=password active=True role=sales_agent <= CURRENT
- **praveen**: 1 document(s), 1 person(s) -> 1 row(s) in User Management
    - `6a96f82aaf607d4f8688f2bd` id=`6a9657fa870766c46c8e5c2a` praveenbhukya842@gmail.com cred=none active=False role=telecaller <= CURRENT
- **sharanya**: 1 document(s), 1 person(s) -> 1 row(s) in User Management
    - `6a96f82aaf607d4f8688f2b6` id=`6a8e6e784282cf0a38adadc2` sharanya777sharu@gmail.com cred=none active=False role=sales_agent <= CURRENT
- **saikiran**: 3 document(s), 3 person(s) -> 3 row(s) in User Management
    - `6a96f82aaf607d4f8688f2b5` id=`6a8e6d934282cf0a38adadb6` gujjarisaikiran13@gmail.com cred=password active=True role=telecaller <= CURRENT
    - `6a97e7d876f42c7795c2eac5` id=`cf14f7bd-f5ee-4206-ada8-e62282e1314f` Saikiranmasula389@gmail.com cred=none active=False role=sales_agent <= CURRENT
    - `6a9858b55c918623d6764602` id=`6a9858b55c918623d6764602` saikiran@bankezee.com cred=password active=True role=manager <= CURRENT
- **masula**: 2 document(s), 2 person(s) -> 2 row(s) in User Management
    - `6a97e7d876f42c7795c2eac5` id=`cf14f7bd-f5ee-4206-ada8-e62282e1314f` Saikiranmasula389@gmail.com cred=none active=False role=sales_agent <= CURRENT
    - `6a97e7d876f42c7795c2ead0` id=`39388f08-3116-40b7-a2a5-b2cb4062a192` sai@bankezee.com cred=none active=True role=manager <= CURRENT

## Same name, different email - NOT auto-merged

These are separate people to the resolver (no shared email/id/connect_id/legacy_user_id), so they stay separately administrable. Link them deliberately with the legacy->Connect mapping tool if they really are one person; the app never merges accounts on name alone.

- **aala bala subhash**
    - `6a97e7d876f42c7795c2eae5` aalasubhash@gmail.com role=sales_agent active=False cred=none
    - `6a97e7d876f42c7795c2eae6` aalabala2002@gmail.com role=sales_agent active=False cred=none
- **anusha maloth**
    - `6a97e7d876f42c7795c2eae3` anushamaloth2003@gmail.com role=sales_agent active=False cred=none
    - `6a97e7d876f42c7795c2eae4` 21b61a05a2@nmrec.edu.in role=sales_agent active=False cred=none
- **kambala santhi**
    - `6a96f82aaf607d4f8688f2a5` srivallisiri912@gmail.com role=telecaller active=False cred=none
    - `6a96f82aaf607d4f8688f2b9` srivallisiri537@gmail.com role=telecaller active=True cred=password
- **md masoom babu**
    - `6a96f82aaf607d4f8688f2ac` masoom7472@gmail.com role=sales_agent active=False cred=none
    - `6a96f82aaf607d4f8688f2b1` masoommd7472@gmai.com role=telecaller active=True cred=password
- **nagulapally pinky**
    - `6a96f82aaf607d4f8688f27e` akshaya03302023@gmail.com role=sales_agent active=False cred=password
    - `6a96f82aaf607d4f8688f2b0` pinkynagulapally@gmail.com role=telecaller active=True cred=password
- **test pending**
    - `6a97af814f413bf463391267` test_pending_b38b4d6b@example.com role=telecaller active=False cred=password
    - `6a97af91d1ae3a517e872299` test_pending_824d054e@example.com role=telecaller active=False cred=password

## Proposed cleanup - DRY RUN ONLY (nothing was written)

For every person below the application already behaves correctly without any data change (one row, writes hit the exact document). Cleanup is therefore OPTIONAL and only removes dormant legacy documents that own no records.

- Asma Sultana  legacy doc `6a97e7d876f42c7795c2eaeb` (email asma.Sultana0r@gmail.com, cred=none, active=False): leads/files=0, calls=0 -> **SAFE TO DELETE (owns no leads/files/calls)**

No delete/merge was executed. Await explicit approval before running any cleanup.
