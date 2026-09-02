# BANKEZEE Connect CRM - Test Credentials

## Admin Account
| Email | Password | Role |
|-------|----------|------|
| admin@bankezee.com | ConnectSasha12!! | admin |

## HR Account
| Email | Password | Role |
|-------|----------|------|
| hr@neosales.in | HrNeo12!! | hr |

## Manager Accounts
| Email | Password | Role | Notes |
|-------|----------|------|-------|
| teja@bankezee.com | tejasme12 | manager | Can manage team hierarchy |
| saikiran@bankezee.com | saikiran12 | manager | Can manage team hierarchy |

## Operations Accounts
| Email | Password | Role | Notes |
|-------|----------|------|-------|
| rama@bankezee.com | rama@bzc12 | ops | Full CRM operational access |
| ops@bankezee.com | ops@bzc12 | ops | Full CRM operational access |

## Growth Partner (GP) Test Accounts
| Email | Password | Role | Notes |
|-------|----------|------|-------|
| yarragondaanusha@gmail.com | AnushaGP123! | growth_partner | Has 14 mapped files. Can be set as TL for testing |

## Application URLs
- **Preview URL**: https://responsive-crm-app-1.preview.emergentagent.com
- **Production URL**: connect.bankezee.com

## Role Hierarchy
```
Admin (Full Access)
├── HR (Attendance/Leave only)
├── Manager (Team management)
│   ├── Team Lead (GP with is_tl=true)
│   │   └── Growth Partners
│   └── Growth Partners (direct reports)
└── Operations (Cross-team CRM access)
```

## RBAC Summary
| Role | CRM Data | Bank Processing | User Approval | Team View | Attendance |
|------|----------|-----------------|---------------|-----------|------------|
| Admin | All | Yes | Yes | All | All |
| HR | No | No | No | No | All |
| Manager | Team Only | No | Team Only | Team | Team |
| Ops | All | Yes | No | All | No |
| Growth Partner | Own Only | No | No | Own | Own |
| GP + TL | Own + Team | No | No | Own + Team | Own + Team |

## Notes
- Team Lead (TL) is NOT a separate role - it's a GP with `is_tl=true`
- Legacy roles (telecaller, sales_agent, team_leader, partner) are treated as growth_partner
- Manager/TL assignments do NOT change historical file ownership
- All role-based accounts are seeded on backend startup
