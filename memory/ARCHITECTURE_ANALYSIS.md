# BANKEZEE CONNECT - COMPREHENSIVE ARCHITECTURE ANALYSIS

## 📊 EXECUTIVE SUMMARY

This analysis examines the existing BankEzee Connect codebase to identify current architecture, 
data structures, and implementation gaps before implementing the comprehensive upgrade.

---

## 1. CURRENT LEAD SCHEMA

**Location:** `/app/backend/routes/leads.py` (lines 219-240)

```python
lead_doc = {
    "name": str,
    "phone": str,
    "email": str (optional),
    "source": str (optional),
    "city": str (optional),
    "status": str (default: "new"),
    "notes": str (optional),
    "custom_fields": dict,
    "assigned_to": str (user_id, optional),
    "telecaller_name": str (optional),
    "created_at": datetime,
    "updated_at": datetime,
    "created_by": str (user_id),
    # Also tracked:
    "last_call_at": datetime,
    "last_call_outcome": str,
    "last_call_duration": int,
    "last_verified_call_at": datetime,
    "last_verified_call_duration": int,
    "last_verified_call_type": str
}
```

**GAPS IDENTIFIED:**
- ❌ No `archived` field
- ❌ No `invalid` or `invalid_reason` field
- ❌ No `normalized_phone` field
- ❌ No `import_batch_id` field
- ❌ No `is_suppressed` field
- ❌ No `never_called` tracking field
- ❌ No assignment history

---

## 2. CURRENT USER/ROLE SCHEMA

**Location:** `/app/backend/models/schemas.py`

```python
UserCreate:
    email: str
    password: str
    name: str
    role: str  # "admin", "telecaller"

UserUpdate:
    email: Optional[str]
    password: Optional[str]
    name: Optional[str]
    role: Optional[str]
    is_active: Optional[bool]
    file_goal: Optional[int]
```

**EXISTING ROLES:**
- `admin` - Full access
- `telecaller` - Agent/calling access

**GAPS IDENTIFIED:**
- ❌ No `hr` role
- ❌ No `manager` or `ops` role
- ❌ No `team_lead` role
- ❌ No permissions system (role-based checks are scattered)
- ❌ No team/department structure

---

## 3. ALL MONGODB COLLECTIONS (Referenced in Code)

| Collection | Purpose | Route File |
|------------|---------|------------|
| `leads` | Customer/prospect data | leads.py |
| `users` | User accounts | users.py, auth.py |
| `call_logs` | Call outcomes (web) | calls.py |
| `verified_call_logs` | Mobile synced calls | calls.py |
| `call_sessions` | Active call tracking | calls.py |
| `daily_sessions` | Daily login/activity stats | activities.py |
| `activity_logs` | User activity pings | activities.py, auth.py |
| `attendance` | Check-in/out records | attendance.py |
| `wfh_requests` | WFH applications | attendance.py |
| `wfh_approvals` | WFH approval records | attendance.py |
| `leave_approvals` | Leave records | attendance.py |
| `attendance_settings` | Office settings | attendance.py |
| `attendance_audit` | Audit trail | attendance.py |
| `offices` | Office locations | attendance.py |
| `follow_ups` | Scheduled follow-ups | (referenced) |
| `recordings` | Call recordings metadata | recordings.py |

**GAPS IDENTIFIED:**
- ❌ No `suppression_list` collection
- ❌ No `import_batches` collection
- ❌ No `audit_logs` collection (general)
- ❌ No `assignment_history` collection
- ❌ No `notifications` collection
- ❌ No `email_queue` collection

---

## 4. EXISTING MONGODB INDEXES

**CURRENT STATE:** No custom indexes found in code. Only default `_id` indexes exist.

**RECOMMENDED INDEXES (from data_cleanup.py):**
```python
("leads", [("assigned_to", 1), ("status", 1)])
("leads", [("created_at", -1)])
("leads", [("phone", 1)])
("leads", [("name", "text"), ("email", "text")])
("call_logs", [("user_id", 1), ("created_at", -1)])
("call_logs", [("lead_id", 1)])
("verified_call_logs", [("user_id", 1), ("call_timestamp", -1)])
("verified_call_logs", [("phone_number", 1)])
("daily_sessions", [("user_id", 1), ("date", -1)])
("attendance", [("user_id", 1), ("attendance_date", -1)])
("attendance", [("attendance_date", -1)])
("activity_logs", [("user_id", 1), ("timestamp", -1)])
("activity_logs", [("timestamp", -1)])
```

---

## 5. EXISTING TTL INDEXES

**CURRENT STATE:** None configured. No automatic data expiration.

**RECOMMENDATION:**
- `activity_logs`: TTL of 30 days
- `call_sessions` (completed): TTL of 30 days

---

## 6. DATA PAGINATION - CURRENT IMPLEMENTATION

**Location:** `/app/backend/routes/leads.py` (lines 19-80)

```python
@router.get("/leads")
async def get_leads(
    status: Optional[str] = None,
    assigned_to: Optional[str] = None,
    search: Optional[str] = None,
    last_call_outcome: Optional[str] = None,
    # NO pagination parameters exist!
)
```

**CURRENT BEHAVIOR:**
- ❌ NO server-side pagination
- ❌ Loads ALL matching leads (`to_list(10000)`)
- ❌ Frontend receives entire dataset
- ❌ No `skip`, `limit`, `page` parameters

**IMPACT:** Will cause severe performance issues with large datasets (>5000 leads).

---

## 7. FILTERING/SEARCH - FRONTEND VS BACKEND

**BACKEND (leads.py lines 42-62):**
```python
if search:
    normalized_search = ''.join(filter(str.isdigit, search))
    search_conditions = [
        {"name": {"$regex": search, "$options": "i"}},
        {"email": {"$regex": search, "$options": "i"}},
        {"phone": {"$regex": search, "$options": "i"}}
    ]
    if normalized_search and len(normalized_search) >= 3:
        search_conditions.append({"phone": {"$regex": normalized_search + "$", "$options": "i"}})
    query["$or"] = search_conditions
```

**CURRENT FILTERS AVAILABLE:**
- ✅ `status` - Backend
- ✅ `assigned_to` - Backend
- ✅ `search` (name/email/phone) - Backend
- ✅ `last_call_outcome` - Backend

**GAPS:**
- ❌ No `source` filter
- ❌ No `import_date` / date range filter
- ❌ No `last_called_date` filter
- ❌ No `never_called` filter
- ❌ No `archived` filter
- ❌ No `import_batch_id` filter
- ❌ No multi-select outcome filter

---

## 8. SELECT / SELECT ALL - CURRENT IMPLEMENTATION

**Location:** `/app/frontend/src/pages/admin/Leads.js` (lines 90-96)

```javascript
const selectAll = () => {
    if (selectedLeads.length === leads.length) {
        setSelectedLeads([]);
    } else {
        setSelectedLeads(leads.map(l => l.id));
    }
};
```

**CURRENT BEHAVIOR:**
- ❌ Select All only selects currently loaded leads
- ❌ If only 50 are displayed, only 50 are selected
- ❌ No "Select all 1,342 matching records" functionality
- ❌ Bulk operations send array of IDs from frontend

**IMPACT:** Cannot perform bulk operations on filtered results exceeding display limit.

---

## 9. LEAD STATUS STORAGE

**Location:** `/app/backend/routes/leads.py`

```python
statuses = ['new', 'not_interested', 'follow_up', 'presentation', 'leads', 'file']
```

**Storage:** `status` field in leads collection (string, lowercase)

**GAPS:**
- ❌ No `archived` status
- ❌ No `invalid` status
- ❌ Status history not tracked

---

## 10. CALL OUTCOME STORAGE & LATEST OUTCOME

**Location:** `/app/backend/routes/calls.py` (lines 178-200)

**Valid Outcomes:**
```python
outcomes = ["connected", "no_answer", "busy", "switched_off", "not_connecting", "wrong_number", "voicemail"]
```

**Storage:** `call_logs` collection with:
- `outcome`: string
- `lead_id`: reference to lead
- `user_id`: who made the call
- `created_at`: timestamp

**Latest Outcome Tracking:**
```python
# On lead update after call:
"last_call_at": now,
"last_call_outcome": log.outcome,
"last_call_duration": log.duration
```

**GAPS:**
- ❌ No `interested`, `not_interested`, `follow_up`, `call_back`, `customer_rejected` outcomes
- ❌ History is in call_logs, but not easily searchable

---

## 11. WRONG NUMBER HANDLING - CURRENT IMPLEMENTATION

**CURRENT:** When "wrong_number" is selected as call outcome:
- ✅ Recorded in call_logs with outcome="wrong_number"
- ✅ Lead's last_call_outcome updated to "wrong_number"
- ❌ Lead NOT marked as invalid
- ❌ Lead NOT removed from calling queue
- ❌ Phone NOT added to suppression list
- ❌ Phone CAN be re-imported

**IMPACT:** Wrong numbers keep appearing in calling lists.

---

## 12. DUPLICATE LEAD/NUMBER DETECTION

**CURRENT IMPLEMENTATION:** None

**Import Process (leads.py lines 164-260):**
```python
# NO duplicate checking!
if leads_to_insert:
    result = await db.leads.insert_many(leads_to_insert)
```

**GAPS:**
- ❌ No phone number normalization before insert
- ❌ No duplicate phone check
- ❌ No suppression list check
- ❌ All imported leads are inserted regardless of duplicates

---

## 13. IMPORT FUNCTIONALITY - CURRENT STATE

**Location:** `/app/backend/routes/leads.py` (lines 164-260)

**Supported Formats:** CSV, XLSX, XLS

**Current Fields:**
- name (required)
- phone (required)
- email, source, city, status, notes, telecaller

**Statistics Returned:**
- total_imported
- assigned count
- unassigned count

**GAPS:**
- ❌ No import_batch_id tracking
- ❌ No duplicate detection
- ❌ No suppression list checking
- ❌ No import history storage
- ❌ No "Duplicates Skipped" count
- ❌ No "Suppressed Numbers Skipped" count

---

## 14. CALL_LOGS vs VERIFIED_CALL_LOGS INTERACTION

**call_logs Collection:**
- Created by: Web app call outcomes, Mobile post-call modal
- Fields: lead_id, user_id, duration, outcome, notes, source (web/mobile)

**verified_call_logs Collection:**
- Created by: Mobile "Sync Call Logs" (Android native call log)
- Fields: phone_number, user_id, duration_seconds, call_type, call_timestamp

**Current Merge (reports.py lines 251-430):**
- Detailed calls report queries BOTH collections
- Shows source = "web" or "mobile"

**GAPS:**
- ❌ verified_call_logs may duplicate call_logs entries
- ❌ No deduplication logic
- ❌ Talk time could be counted twice

---

## 15. MOBILE/WEB CALL DUPLICATE RISK

**Scenario:**
1. Agent makes call from mobile app
2. Post-call modal → creates entry in `call_logs` (source=mobile)
3. Agent taps "Sync Call Logs" → creates entry in `verified_call_logs`
4. Reports query both → same call counted twice

**IMPACT:** Inflated call counts and talk time in reports.

---

## 16. TALK TIME CALCULATION

**Location:** `/app/backend/routes/reports.py`

**Current Method:**
```python
# From call_logs
total_call_seconds = sum(log.get("duration", 0) for log in call_logs)
# From verified_call_logs (separate)
verified_talk_time = sum(log.get("duration_seconds", 0) for log in verified_logs)
```

**GAPS:**
- ❌ No deduplication between collections
- ❌ Potential double-counting

---

## 17. ATTENDANCE STORAGE & TIMESTAMPS

**Location:** `/app/backend/routes/attendance.py`

**Storage:** UTC internally, converted to IST for display

**Schema:**
```python
{
    "user_id": str,
    "attendance_date": datetime (UTC),
    "check_in_time": datetime (UTC),
    "check_out_time": datetime (UTC),
    "work_mode": str ("OFFICE", "WORK_FROM_HOME", "LEAVE"),
    "attendance_status": str ("PRESENT", "LATE", "ABSENT", etc.),
    "check_in_distance_from_office": int,
    "working_minutes": int,
    "late_minutes": int
}
```

**IST Handling:** ✅ Properly implemented using `zoneinfo("Asia/Kolkata")`

---

## 18. EXISTING WFH FUNCTIONALITY

**Location:** `/app/backend/routes/attendance.py`

**Current Features:**
- ✅ WFH request by employee
- ✅ Admin WFH assignment
- ✅ WFH approval model exists
- ✅ Integrates with attendance (work_mode = "WORK_FROM_HOME")

**Schema (wfh_approvals):**
```python
{
    "user_id": str,
    "date": datetime,
    "status": str ("APPROVED", "REJECTED"),
    "admin_notes": str,
    "approved_by": str,
    "approved_at": datetime
}
```

---

## 19. EXISTING LEAVE FUNCTIONALITY

**Location:** `/app/backend/models/attendance_schemas.py`

**LeaveApproval Schema:**
```python
class LeaveApproval(BaseModel):
    user_id: str
    start_date: str
    end_date: str
    leave_type: Optional[str]  # "GENERAL", "SICK", "CASUAL", "PAID"
    reason: Optional[str]
```

**GAPS:**
- ❌ No "Apply for Leave" endpoint for employees
- ❌ No leave request history for employees
- ❌ No leave balance tracking
- ❌ No approval workflow (pending → approved/rejected)
- ❌ Leave is admin-initiated only

---

## 20. EXISTING ROLES & PERMISSION IMPLEMENTATION

**Current Roles:**
- `admin` - Full access
- `telecaller` - Limited access

**Permission Enforcement:**
```python
# Admin check (utils/auth.py)
async def require_admin(current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
```

**GAPS:**
- ❌ No centralized permission system
- ❌ Role checks scattered throughout code
- ❌ No granular permissions (view vs edit vs delete)
- ❌ No team/department-based access control

---

## 21. EXISTING EMAIL INFRASTRUCTURE

**CURRENT STATE:** None

**GAPS:**
- ❌ No email service configured
- ❌ No SMTP/SendGrid/Resend integration
- ❌ No notification system
- ❌ No email queue

---

## 22. GOOGLE SHEETS INTEGRATION

**CURRENT STATE:** None

**GAPS:**
- ❌ No Google Sheets API integration
- ❌ No backup/sync functionality
- ❌ No service account configuration

---

## 23. ACTIVITY LOG FREQUENCY & DATABASE GROWTH

**Activity Ping Frequency:** Every 30 seconds per active user

**Calculation:**
- 10 active users × 8 hours/day × 120 pings/hour = 9,600 records/day
- 30 days = 288,000 records/month

**Collections at Risk:**
| Collection | Growth Rate | Risk |
|------------|-------------|------|
| activity_logs | ~10,000/day | 🔴 HIGH |
| call_sessions | ~100/day | 🟡 MEDIUM |
| call_logs | ~100/day | 🟢 LOW |
| verified_call_logs | ~100/day | 🟢 LOW |
| daily_sessions | ~10/day | 🟢 LOW |

---

## 24. COLLECTIONS SAFE FOR TTL/RETENTION

**Safe for TTL (30 days):**
- `activity_logs` - Raw pings not needed after summary
- `call_sessions` - Temporary tracking data

**Safe for Retention (365 days):**
- `call_logs` - Historical call data
- `verified_call_logs` - Mobile sync data
- `daily_sessions` - Daily summaries

**DO NOT AUTO-DELETE:**
- `leads` - Customer data
- `users` - Account data
- `attendance` - Legal/HR records
- `wfh_approvals` - HR records
- `leave_approvals` - HR records

---

## 25. CONFLICTS WITH REQUESTED ARCHITECTURE

| Request | Current State | Conflict Level |
|---------|---------------|----------------|
| Server-side pagination | No pagination | 🔴 HIGH - Requires API changes |
| Suppression list | No concept | 🟡 MEDIUM - New feature |
| Wrong number handling | Just an outcome | 🟡 MEDIUM - Behavior change |
| Select all filtered | Client-side only | 🔴 HIGH - Architecture change |
| HR role | Doesn't exist | 🟡 MEDIUM - New role |
| Email notifications | No email service | 🟡 MEDIUM - New integration |
| Google Sheets backup | Doesn't exist | 🟡 MEDIUM - New integration |
| Multi-select outcome filter | Single select only | 🟢 LOW - Filter enhancement |

---

## 🚀 PROPOSED IMPLEMENTATION STAGES

### Stage 1: Data Filters/Search/Pagination
- Add server-side pagination (skip, limit, page, pageSize)
- Add missing filters (source, date range, never_called, multi-outcome)
- Add "X matching leads" count endpoint

### Stage 2: Bulk Selection/Reassignment
- Add "select all filtered" functionality
- Server-side bulk operations endpoint
- Assignment history tracking

### Stage 3: Wrong-Number Suppression
- Create suppression_list collection
- Update wrong_number handling
- Add phone normalization
- Block suppressed numbers on import

### Stage 4: Archive/Import Management
- Add archived field to leads
- Create import_batches collection
- Track import history with statistics

### Stage 5: Excel Exports
- Create export endpoints (filtered, selected, full)
- Server-side Excel generation
- Large export queuing

### Stage 6: Canonical Call-Log Cleanup
- Deduplication logic
- Merge verified_call_logs into call_logs
- Unified talk time calculation

### Stage 7: Attendance + Leave + WFH
- Employee leave application
- Approval workflow
- Leave balance tracking

### Stage 8: HR Role/Permissions
- Create HR role
- Centralized permission system
- Role-based API enforcement

### Stage 9: Email Notifications
- Email service integration (Resend recommended)
- Notification templates
- Email queue for reliability

### Stage 10: Google Sheets Backup
- Service account configuration
- Sync scheduler
- Summary worksheets

### Stage 11: Database Retention/Index Optimization
- Create recommended indexes
- TTL indexes for temporary data
- Cleanup scripts with dry-run

---

**⚠️ IMPORTANT:** This analysis is based on the PREVIEW environment code. 
Production data patterns may differ. Recommend running similar analysis 
on production before executing destructive operations.
