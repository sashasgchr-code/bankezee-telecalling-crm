# BANKEZEE Connect CRM - Test Credentials

## Admin Accounts
| Email | Password | Name |
|-------|----------|------|
| admin@bankezee.com | ConnectSasha12!! | Admin |
| teja@bankezee.com | tejasme12 | Teja |
| rama@bankezee.com | rama@bzc12 | Rama |
| manager@bankezee.com | mgr@bzc12 | Manager |
| manager2@bankezee.com | mgr12@bzc!! | Manager 2 |

## Growth Partner (GP) Test Accounts
| Email | Password | Role | Notes |
|-------|----------|------|-------|
| yarragondaanusha@gmail.com | AnushaGP123! | sales_agent | Has 14 mapped files. Use for GP RBAC acceptance testing |

## Telecaller Test Account
| Email | Password | Name |
|-------|----------|------|
| agent@test.com | agent123 | Test Agent |

## HR Test Account
| Email | Password | Name |
|-------|----------|------|
| TEST_hr_user@bankezee.com | HrTest12!! | HR User |

## Application URLs
- **Preview URL**: https://responsive-crm-app-1.preview.emergentagent.com
- **Production URL**: connect.bankezee.com

## Mobile App
- Platform: React Native (Expo)
- Build: EAS Build (see `/app/mobile-app/EAS_BUILD_GUIDE.md`)
- API Base: https://responsive-crm-app-1.preview.emergentagent.com/api

## Notes
- All admin accounts are seeded automatically on backend startup
- Use telecaller account to test telecaller-specific features
- Mobile app requires physical Android device for call/recording features
- HR role can access Attendance/Leave but NOT customer data (leads/calls)
- Email notifications require RESEND_API_KEY in /app/backend/.env
