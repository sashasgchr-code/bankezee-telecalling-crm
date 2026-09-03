# BANKEZEE Connect CRM - Test Credentials

## Admin Account
| Email | Password | Role | Notes |
|-------|----------|------|-------|
| admin@bankezee.com | ConnectSasha12!! | admin | Full system access |

## Operations Accounts
| Email | Password | Role | Notes |
|-------|----------|------|-------|
| rama@bankezee.com | rama123 | ops | Operations team |
| ops@bankezee.com | ops123 | ops | Operations backup |

## Manager Account
| Email | Password | Role | Notes |
|-------|----------|------|-------|
| teja@bankezee.com | tejasme12 | manager | Can manage team hierarchy |

## Team Leaders (TLs)
| Email | Password | Role | Notes |
|-------|----------|------|-------|
| yarragondaanusha@gmail.com | 9063023292 | growth_partner + is_tl=true | TL with 11 team members, reports to Saikiran |
| pinkynagulapally@gmail.com | Pinky@1234 | growth_partner + is_tl=true | TL with 5 team members, reports to Teja. CRM account: akshaya03302023@gmail.com |

## Growth Partners (Active - from @users spreadsheet)
| Email | Password | TL | Manager | Legacy CRM Email |
|-------|----------|-----|---------|-----------------|
| mohammadwameez607@gmail.com | C865cLzckips4yC | Pinky | Teja | Same |
| regurivijayendra@gmail.com | vijay@12345 | Pinky | Teja | Same |
| jkavithabhai@gmail.com | vishnu404 | Pinky | Teja | Same |
| gujjarisaikiran13@gmail.com | Gujjari@21 | Pinky | Teja | No CRM account |
| pushparajbha911@gmail.com | ragini | Anusha | Saikiran | Same |
| gosangideevenadevaswamy@gmail.com | Divi@8074 | Anusha | Saikiran | No CRM account |
| srivallisiri537@gmail.com | santhi | Anusha | Saikiran | No CRM account |
| lellachandana24@gmail.com | mahi@123 | Pinky | Teja | No CRM account |
| nani9346480@gmail.com | Anil@123 | Anusha | Saikiran | Same |
| banothunithinnaik@gmail.com | Nithin@123 | Anusha | Saikiran | Same |
| nalavonilakshmipriya@gmail.com | ammu@2006 | Anusha | Saikiran | Same |
| kemidiraju134@gmail.com | rajuking@225 | Anusha | Saikiran | Same |
| meghanaaaa.36@gmail.com | Meghana@0260 | Anusha | Saikiran | Same |
| mivimivi51@gmail.com | Rishi@7650 | Anusha | Saikiran | No CRM account |
| masoommd7472@gmai.com | masoom@123 | Anusha | Saikiran | masoommd7472@gmail.com (typo in Connect) |
| pillalamarrishivasai@gmail.com | Shivasai939@ | Pinky | Teja | Same |
| asma.sultana0r@gmail.com | Asma@0309 | Anusha | Saikiran | Same |

## HR Account
| Email | Password | Role | Notes |
|-------|----------|------|-------|
| test_hr_user@bankezee.com | hrpassword123 | hr | HR access for attendance/leave |

## Application URLs
- **Preview URL**: https://responsive-crm-app-1.preview.emergentagent.com
- **Production URL**: connect.bankezee.com

## Hierarchy Structure
```
Admin (admin@bankezee.com)
├── Operations (rama@bankezee.com, ops@bankezee.com)
├── Manager: Teja (teja@bankezee.com)
│   ├── TL: Pinky (pinkynagulapally@gmail.com) - 5 team members
│   │   ├── Wamiz (mohammadwameez607@gmail.com)
│   │   ├── Vijayendra (regurivijayendra@gmail.com)
│   │   ├── Vishnu (jkavithabhai@gmail.com)
│   │   ├── Shiva (pillalamarrishivasai@gmail.com)
│   │   └── Chandana (lellachandana24@gmail.com)
│   └── G Saikiran (gujjarisaikiran13@gmail.com) - acts as sub-manager
│       └── TL: Anusha (yarragondaanusha@gmail.com) - 11 team members
│           ├── Pushpa, Deevena, Shanthi, Anil, Nithin
│           ├── Priya, Raju, Meghana, Rishikesh
│           ├── Masoom, Asma
└── HR (test_hr_user@bankezee.com)
```

## User Consolidation Summary (September 3, 2026)
- **19 active GP accounts** from @users spreadsheet
- **2 Team Leaders**: Anusha (11 members), Pinky (5 members)
- **97 users deactivated** (not in @users list)
- **1 CRM-to-Connect mapping**: Pinky (akshaya03302023@gmail.com → pinkynagulapally@gmail.com)
- All GP passwords updated to match Connect column in @users

## Notes
- Connect is now the ONLY operational login system
- Legacy CRM accounts are mapped to Connect users (historical data preserved)
- Users NOT in @users spreadsheet have been deactivated (is_active=false)
- Historical file ownership and activities are NOT modified
- All role-based accounts are seeded on backend startup
