# BankEzee Connect CRM - Product Requirements Document

## Overview
BankEzee Connect is a comprehensive CRM platform for loan processing, integrating legacy OLD CRM data with modern Connect functionality.

## Current State (December 2, 2025)

### Deployment Status: READY FOR PRODUCTION

### Accepted Dashboard Metrics (Frozen)
| Metric | Value |
|--------|-------|
| Total Files | 514 |
| Login | 317 |
| Approved | 116 |
| Total Approved | ₹16.25 Cr |
| Disbursed | 96 |
| Total Disbursed | ₹13.84 Cr |
| Final Rejections | 280 |
| Amt in Pipeline | ₹1.84 Cr |

### Frozen Calculation Rules
- **Login**: Based on Files that historically reached Login through activities OR have login_done=yes eligibility history
- **Approved**: Based on historical Approved progression/activity
- **Disbursed**: Based on historical Disbursed progression/activity
- **Total Approved Amount**: Uses additional_data.loan_amount_required
- **Total Disbursed Amount**: Uses additional_data.loan_amount_required
- **Pipeline**: Uses eligibility/Login/pipeline calculation
- **Loans by Type**: Uses additional_data.type_of_loan

### Implemented Features
1. **Files Dashboard** - Complete CRM metrics and KPIs
2. **File Detail Page** - Full CRM workspace (Customer, Employment, Loans, Requirements)
3. **24 CRM Statuses** - Complete workflow from new → disbursed/rejected
4. **Bank Eligibilities** - Per-file tracking for 27 banks
5. **Star Rating** - Data completeness + CIBIL + FOIR algorithm
6. **Reports Suite**:
   - Daily Report
   - Rejected Cases (Bank-level)
   - GP Performance (Current/Spillover)
   - Bank Performance
   - TAT Report
   - Quality Report
7. **Policy Master** - 40+ fields for bank requirements
8. **Document Workflow** - 19 document types with Required/Pending/Uploaded tracking
9. **Data → File Conversion** - Idempotent with prefill
10. **Commission Module** - CRUD + aggregations + source_name snapshot
11. **Eligibility Calculation** - Auto-check against bank policies
12. **CSV Exports** - Dashboard, Rejected, GP Performance, Commission
13. **Activity Log** - Color-coded with icons
14. **User Mapping** - Legacy CRM user → Connect user mapping preserved

### Connect Features (Preserved)
- Data management and calling
- Attendance tracking
- Leave management
- User/GP management
- Real-time dashboard

### Data Sources
- 445 files from legacy_crm_google_sheet
- 66 files from old_crm_csv
- 3 test records
- **Total: 514 files**

### Authentication
- Admin: admin@bankezee.com / ConnectSasha12!!
- Operations: ops@bankezee.com

### Technical Stack
- Frontend: React with Shadcn/UI
- Backend: FastAPI
- Database: MongoDB
- Mobile: Expo React Native (EAS build pending)

## Deferred Items
- Android EAS/Gradle build fix
- In-Progress count reconciliation (25 vs 17)
- Additional legacy data investigation

## Future Enhancements
- Mobile app APK generation
- Enhanced GP performance analytics
- Automated commission calculations
- Integration with banking APIs

---
*Last Updated: December 2, 2025*
*Status: Ready for Production Deployment*
