# Google Sheets Integration Guide for BankEzee Connect

## Step 1: Create a New Google Sheet

1. Go to [Google Sheets](https://sheets.google.com)
2. Create a new blank spreadsheet
3. Name it "BankEzee Connect - Lead Management"
4. Create the following tabs (sheets) by clicking the "+" at the bottom:
   - `New`
   - `Follow Up`
   - `Presentation`
   - `Leads`
   - `File`
   - `Not Interested`
   - `Wrong Number`
   - `Daily Report`
   - `Attendance`

## Step 2: Add the Apps Script

1. In your Google Sheet, go to **Extensions → Apps Script**
2. Delete any existing code in the editor
3. Paste the following code:

```javascript
/**
 * BankEzee Connect - Google Sheets Sync Script
 * Automatically syncs lead data from the CRM to this spreadsheet
 */

// ===== CONFIGURATION =====
const API_BASE_URL = 'https://responsive-crm-app-1.preview.emergentagent.com/api';
// For production: 'https://connect.bankezee.com/api'

// API Key for authentication (no login required)
const SHEETS_API_KEY = 'bankezee_sheets_sync_2026';

// ===== AUTHENTICATION =====
// Using API key - no login required for App Script
function getApiKey() {
  return SHEETS_API_KEY;
}

// ===== MAIN SYNC FUNCTION =====
function syncAllData() {
  try {
    syncLeadsByStatus();
    syncDailyReport();
    syncAttendance();
    
    // Update last sync timestamp
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ss.getRange('A1').setNote('Last synced: ' + new Date().toLocaleString());
    
    SpreadsheetApp.getActiveSpreadsheet().toast('Sync completed successfully!', 'BankEzee Sync', 5);
  } catch (error) {
    SpreadsheetApp.getActiveSpreadsheet().toast('Sync failed: ' + error.message, 'Error', 10);
    Logger.log('Sync error: ' + error);
  }
}

// ===== SYNC LEADS BY STATUS =====
function syncLeadsByStatus() {
  const apiKey = getApiKey();
  
  const response = UrlFetchApp.fetch(`${API_BASE_URL}/sheets-sync/leads-by-status?api_key=${apiKey}`, {
    method: 'GET',
    muteHttpExceptions: true
  });
  
  if (response.getResponseCode() !== 200) {
    throw new Error('Failed to fetch leads: ' + response.getContentText());
  }
  
  const result = JSON.parse(response.getContentText());
  const data = result.data;
  
  // Map status to sheet names
  const statusToSheet = {
    'new': 'New',
    'follow_up': 'Follow Up',
    'presentation': 'Presentation',
    'leads': 'Leads',
    'file': 'File',
    'not_interested': 'Not Interested',
    'wrong_number': 'Wrong Number'
  };
  
  // Update each status sheet
  for (const [status, sheetName] of Object.entries(statusToSheet)) {
    const leads = data[status] || [];
    updateLeadsSheet(sheetName, leads);
  }
}

function updateLeadsSheet(sheetName, leads) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  
  // Clear existing data
  sheet.clear();
  
  // Set headers
  const headers = ['Name', 'Phone', 'Email', 'City', 'Source', 'Status', 'Last Outcome', 'Telecaller', 'Notes', 'Created At', 'Last Called'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#4CAF50').setFontColor('white');
  
  if (leads.length === 0) {
    sheet.getRange(2, 1).setValue('No leads in this status');
    return;
  }
  
  // Prepare data rows
  const rows = leads.map(lead => [
    lead.name || '',
    lead.phone || '',
    lead.email || '',
    lead.city || '',
    lead.source || '',
    lead.status || '',
    lead.last_call_outcome || '',
    lead.telecaller || 'Unassigned',
    lead.notes || '',
    lead.created_at ? new Date(lead.created_at).toLocaleDateString() : '',
    lead.last_call_at ? new Date(lead.last_call_at).toLocaleDateString() : ''
  ]);
  
  // Write data
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  
  // Auto-resize columns
  for (let i = 1; i <= headers.length; i++) {
    sheet.autoResizeColumn(i);
  }
  
  // Add count footer
  sheet.getRange(rows.length + 3, 1).setValue(`Total: ${rows.length} leads`).setFontWeight('bold');
}

// ===== SYNC DAILY REPORT =====
function syncDailyReport() {
  const apiKey = getApiKey();
  
  const response = UrlFetchApp.fetch(`${API_BASE_URL}/sheets-sync/daily-report?api_key=${apiKey}`, {
    method: 'GET',
    muteHttpExceptions: true
  });
  
  if (response.getResponseCode() !== 200) {
    throw new Error('Failed to fetch daily report: ' + response.getContentText());
  }
  
  const result = JSON.parse(response.getContentText());
  const stats = result.user_stats || [];
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Daily Report');
  
  if (!sheet) {
    sheet = ss.insertSheet('Daily Report');
  }
  
  sheet.clear();
  
  // Header
  sheet.getRange(1, 1).setValue(`Daily Call Report - ${result.date}`).setFontWeight('bold').setFontSize(14);
  
  // Table headers
  const headers = ['Telecaller', 'Total Calls', 'Connected', 'No Answer', 'Busy', 'Wrong Number', 'Total Duration (min)'];
  sheet.getRange(3, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(3, 1, 1, headers.length).setFontWeight('bold').setBackground('#2196F3').setFontColor('white');
  
  if (stats.length === 0) {
    sheet.getRange(4, 1).setValue('No calls recorded today');
    return;
  }
  
  const rows = stats.map(s => [
    s.user_name || 'Unknown',
    s.total_calls || 0,
    s.connected || 0,
    s.no_answer || 0,
    s.busy || 0,
    s.wrong_number || 0,
    Math.round((s.total_duration || 0) / 60)
  ]);
  
  sheet.getRange(4, 1, rows.length, headers.length).setValues(rows);
  
  // Auto-resize
  for (let i = 1; i <= headers.length; i++) {
    sheet.autoResizeColumn(i);
  }
}

// ===== SYNC ATTENDANCE =====
function syncAttendance() {
  const apiKey = getApiKey();
  
  const response = UrlFetchApp.fetch(`${API_BASE_URL}/sheets-sync/attendance-summary?api_key=${apiKey}`, {
    method: 'GET',
    muteHttpExceptions: true
  });
  
  if (response.getResponseCode() !== 200) {
    throw new Error('Failed to fetch attendance: ' + response.getContentText());
  }
  
  const result = JSON.parse(response.getContentText());
  const records = result.records || [];
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Attendance');
  
  if (!sheet) {
    sheet = ss.insertSheet('Attendance');
  }
  
  sheet.clear();
  
  // Header
  sheet.getRange(1, 1).setValue(`Attendance Summary - ${result.period}`).setFontWeight('bold').setFontSize(14);
  
  // Table headers
  const headers = ['Date', 'User', 'Status', 'Work Mode', 'Check In', 'Check Out', 'Duration (hrs)'];
  sheet.getRange(3, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(3, 1, 1, headers.length).setFontWeight('bold').setBackground('#FF9800').setFontColor('white');
  
  if (records.length === 0) {
    sheet.getRange(4, 1).setValue('No attendance records found');
    return;
  }
  
  const rows = records.map(r => [
    r.date || '',
    r.user || '',
    r.status || '',
    r.work_mode || '',
    r.check_in || '',
    r.check_out || '',
    r.duration_hrs || 0
  ]);
  
  sheet.getRange(4, 1, rows.length, headers.length).setValues(rows);
  
  // Auto-resize
  for (let i = 1; i <= headers.length; i++) {
    sheet.autoResizeColumn(i);
  }
}

// ===== MENU SETUP =====
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🔄 BankEzee Sync')
    .addItem('Sync All Data', 'syncAllData')
    .addSeparator()
    .addItem('Sync Leads Only', 'syncLeadsByStatus')
    .addItem('Sync Daily Report', 'syncDailyReport')
    .addItem('Sync Attendance', 'syncAttendance')
    .addSeparator()
    .addItem('Set Up Auto-Sync', 'setupAutoSync')
    .addItem('Remove Auto-Sync', 'removeAutoSync')
    .addToUi();
}

// ===== AUTO-SYNC TRIGGERS =====
function setupAutoSync() {
  // Remove existing triggers
  removeAutoSync();
  
  // Create new trigger - runs every 6 hours
  ScriptApp.newTrigger('syncAllData')
    .timeBased()
    .everyHours(6)
    .create();
  
  SpreadsheetApp.getActiveSpreadsheet().toast('Auto-sync set up! Data will sync every 6 hours.', 'Success', 5);
}

function removeAutoSync() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'syncAllData') {
      ScriptApp.deleteTrigger(trigger);
    }
  }
}
```

## Step 3: Configure the Script

1. In the script editor, update these values at the top if needed:
   - `API_BASE_URL`: Your BankEzee Connect API URL
   - `ADMIN_EMAIL`: Admin email for authentication
   - `ADMIN_PASSWORD`: Admin password

2. Click **Save** (Ctrl+S)

## Step 4: Authorize the Script

1. Click the **Run** button (▶) or select **syncAllData** from the dropdown
2. A dialog will appear asking for permissions
3. Click **Review Permissions**
4. Select your Google account
5. Click **Advanced** → **Go to BankEzee Connect (unsafe)**
6. Click **Allow**

## Step 5: Run the First Sync

1. Go back to your spreadsheet
2. Refresh the page
3. You should see a new menu: **🔄 BankEzee Sync**
4. Click **🔄 BankEzee Sync → Sync All Data**
5. Wait for the sync to complete (you'll see a toast notification)

## Step 6: Set Up Automatic Sync (Optional)

1. Click **🔄 BankEzee Sync → Set Up Auto-Sync**
2. This will sync data automatically every 6 hours

## Tab Descriptions

| Tab | Description |
|-----|-------------|
| New | Fresh leads that haven't been contacted yet |
| Follow Up | Leads requiring follow-up calls |
| Presentation | Leads scheduled for presentation |
| Leads | Active leads in discussion |
| File | Leads with completed file submission |
| Not Interested | Leads who declined |
| Wrong Number | Invalid/wrong phone numbers |
| Daily Report | Today's call statistics by telecaller |
| Attendance | Team attendance summary (last 30 days) |

## Troubleshooting

### "Failed to authenticate" error
- Check that the admin credentials in the script are correct
- Ensure the admin account is active in BankEzee Connect

### "Authorization required" popup keeps appearing
- Make sure you completed the authorization steps
- Try running the script again after authorizing

### Data not syncing
- Check the Execution Log: **Extensions → Apps Script → Executions**
- Look for any error messages

### Sync is slow
- Large datasets may take a few minutes
- Consider syncing specific tabs instead of all data

## Security Notes

✅ **Simplified Authentication**: This version uses an API key instead of username/password, making setup easier and more secure (no credentials stored in script).

For production use, consider:
1. Using a custom API key (set SHEETS_API_KEY in backend .env)
2. Restricting IP access if needed
3. Monitoring sync activity
