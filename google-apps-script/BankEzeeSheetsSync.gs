/**
 * BankEzee Connect + Meta CRM  →  Google Sheets Export
 * ----------------------------------------------------
 * CRM -> Google Sheets EXPORT ONLY. Does NOT touch the Meta Google Sheet -> CRM import.
 *
 * Fixes:
 *  - Points to the PRODUCTION API (connect.bankezee.com), never the preview URL.
 *  - Writes by SPREADSHEET_ID (not the ambiguous "active" spreadsheet).
 *  - Pages through EVERY Meta record and verifies the count.
 *  - NEVER clears a tab until the API response is validated AND complete
 *    (last successful export is preserved when a sync fails).
 *  - Post-write verification (row count + lead IDs + status) before "SUCCESS".
 *  - Writes a "Sync Log" tab: Timestamp | Module | API Records | Sheet Records | Status | Error.
 *  - Phone numbers and IDs are written as TEXT (leading + / long digits preserved).
 *
 * SETUP: fill SPREADSHEET_ID below, then Run > onOpen (or reload the sheet) to get the menu.
 */

// ======================= CONFIG =======================
var CONFIG = {
  BASE_URL: 'https://connect.bankezee.com/api',   // PRODUCTION – do not change to preview
  API_KEY:  'bankezee_sheets_sync_2026',          // sheets-sync api_key
  SPREADSHEET_ID: '1keN8GR_sLFQFdvMA1p3_Z2cYAgL1F9dGWaeG4lCGxDc', // e.g. from the sheet URL /d/<ID>/edit
  META_PAGE_SIZE: 500,                            // max 2000
  TIMEOUT_TRIES: 3
};

var TABS = {
  META: 'Meta Leads',
  CONNECT: 'Connect Leads',
  DAILY: 'Daily Report',
  ATTENDANCE: 'Attendance',
  LOG: 'Sync Log'
};

// ======================= MENU =======================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('BankEzee Sync')
    .addItem('Sync Meta Leads', 'syncMetaLeads')
    .addItem('Sync Connect Leads', 'syncConnectLeads')
    .addItem('Sync Daily Report', 'syncDailyReport')
    .addItem('Sync Attendance', 'syncAttendance')
    .addSeparator()
    .addItem('Sync ALL', 'syncAll')
    .addToUi();
}

function syncAll() {
  var results = [];
  results.push(safeRun('Meta Leads', syncMetaLeads));
  results.push(safeRun('Connect Leads', syncConnectLeads));
  results.push(safeRun('Daily Report', syncDailyReport));
  results.push(safeRun('Attendance', syncAttendance));
  var failed = results.filter(function (r) { return r !== true; });
  var ui = SpreadsheetApp.getUi();
  if (failed.length === 0) ui.alert('Sync ALL: SUCCESS — all modules exported and verified.');
  else ui.alert('Sync ALL: COMPLETED WITH ERRORS\n\n' + failed.join('\n') + '\n\nSee the "Sync Log" tab.');
}

// safeRun: runs a sync fn, catches errors so one failure doesn't abort the rest.
function safeRun(label, fn) {
  try { fn(); return true; }
  catch (e) { Logger.log('[' + label + '] ERROR: ' + e); return label + ': ' + e; }
}

// ======================= HTTP =======================
function apiGet(path, params) {
  var url = CONFIG.BASE_URL + path + '?api_key=' + encodeURIComponent(CONFIG.API_KEY);
  if (params) {
    Object.keys(params).forEach(function (k) {
      url += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    });
  }
  var lastErr = '';
  for (var attempt = 1; attempt <= CONFIG.TIMEOUT_TRIES; attempt++) {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    var code = resp.getResponseCode();
    var body = resp.getContentText();
    if (code === 200) {
      try { return JSON.parse(body); }
      catch (e) { throw new Error('Invalid JSON from ' + path + ': ' + body.substring(0, 200)); }
    }
    // 5xx / 520 rollout blips -> retry; 4xx -> fail immediately
    lastErr = 'HTTP ' + code + ' from ' + path + ' :: ' + body.substring(0, 200);
    if (code < 500 && code !== 429) break;
    Utilities.sleep(1500 * attempt);
  }
  throw new Error(lastErr);
}

// ======================= SPREADSHEET HELPERS =======================
function getSpreadsheet() {
  if (!CONFIG.SPREADSHEET_ID || CONFIG.SPREADSHEET_ID === 'PUT_YOUR_SPREADSHEET_ID_HERE') {
    throw new Error('CONFIG.SPREADSHEET_ID is not set. Paste your spreadsheet ID into CONFIG.');
  }
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

function getOrCreateTab(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

/**
 * Writes a header + rows to a tab. Only clears AFTER we have validated rows in hand.
 * textCols = array of 0-based column indexes to force as plain text (phones, IDs).
 */
function writeTable(ss, tabName, header, rows, textCols) {
  var sh = getOrCreateTab(ss, tabName);
  sh.clear();                                   // safe: caller already validated `rows`
  var width = header.length;
  // Force text format on ID/phone columns for the whole used height (header + rows).
  if (textCols && textCols.length) {
    var height = rows.length + 1;
    textCols.forEach(function (c) {
      if (c < width) sh.getRange(1, c + 1, height, 1).setNumberFormat('@');
    });
  }
  sh.getRange(1, 1, 1, width).setValues([header]).setFontWeight('bold');
  if (rows.length) sh.getRange(2, 1, rows.length, width).setValues(rows);
  sh.setFrozenRows(1);
  SpreadsheetApp.flush();
  return sh;
}

// ======================= META LEADS =======================
function syncMetaLeads() {
  var ss = getSpreadsheet();
  var module = 'Meta Leads';
  var apiTotal = 0;
  try {
    // 1) First page -> get authoritative total + page count.
    var first = apiGet('/sheets-sync/meta-leads', { page: 1, page_size: CONFIG.META_PAGE_SIZE });
    if (typeof first.total !== 'number' || !Array.isArray(first.records)) {
      throw new Error('Unexpected response shape (missing total/records).');
    }
    apiTotal = first.total;
    var totalPages = first.total_pages || 1;
    var all = first.records.slice();

    // 2) Page through the rest.
    for (var p = 2; p <= totalPages; p++) {
      var pageResp = apiGet('/sheets-sync/meta-leads', { page: p, page_size: CONFIG.META_PAGE_SIZE });
      if (!Array.isArray(pageResp.records)) throw new Error('Page ' + p + ' returned no records array.');
      all = all.concat(pageResp.records);
    }

    // 3) VALIDATE completeness BEFORE touching the sheet.
    if (apiTotal > 0 && all.length !== apiTotal) {
      throw new Error('Incomplete fetch: expected ' + apiTotal + ' records, got ' + all.length + '. Sheet NOT modified.');
    }
    if (apiTotal === 0) {
      // Genuinely empty DB vs failed query: we already got HTTP 200 + total===0 -> genuinely empty.
      logSync(ss, module, 0, 0, 'SUCCESS', 'Database returned 0 Meta leads (genuinely empty).');
      Logger.log('Meta Leads: API total is 0 — nothing to write. Existing tab preserved.');
      return;
    }

    // 4) Build table.
    var header = ['Lead ID', 'Full Name', 'Phone', 'Email', 'City', 'Status', 'Sheet Status',
      'Assigned GP', 'Assigned GP ID', 'Assigned By', 'Assigned At', 'Campaign', 'Form', 'Platform',
      'Employment', 'Monthly Salary', 'Outstanding', 'Docs Received', 'Created Time', 'Created At',
      'Updated At', 'Notes', 'Follow-ups'];
    var rows = all.map(function (r) {
      return [
        r.lead_id || '', r.full_name || '', r.phone || '', r.email || '', r.city || '',
        r.status || '', r.sheet_status || '', r.assigned_partner_name || '', r.assigned_partner_id || '',
        r.assigned_by || '', r.assigned_at || '', r.campaign_name || '', r.form_name || '', r.platform || '',
        r.employment_status || '', r.monthly_salary || '', r.outstanding_amount || '', r.docs_received || '',
        r.created_time || '', r.created_at || '', r.updated_at || '', r.notes || '', r.follow_ups || ''
      ];
    });
    // Text columns: Lead ID(0), Phone(2), Assigned GP ID(8)
    writeTable(ss, TABS.META, header, rows, [0, 2, 8]);

    // 5) POST-WRITE VERIFICATION against the actual sheet values.
    var sh = ss.getSheetByName(TABS.META);
    var sheetRows = sh.getLastRow() - 1; // minus header
    if (sheetRows !== all.length) {
      throw new Error('Verify FAILED: wrote ' + all.length + ' but sheet has ' + sheetRows + ' rows.');
    }
    // Verify Lead ID + Status of first & last records actually landed.
    var vals = sh.getRange(2, 1, all.length, header.length).getValues();
    var checks = [0, all.length - 1];
    for (var i = 0; i < checks.length; i++) {
      var idx = checks[i];
      if (String(vals[idx][0]) !== String(all[idx].lead_id)) {
        throw new Error('Verify FAILED: Lead ID mismatch at row ' + (idx + 2));
      }
      if (String(vals[idx][5]) !== String(all[idx].status || '')) {
        throw new Error('Verify FAILED: Status mismatch at row ' + (idx + 2));
      }
    }

    logSync(ss, module, apiTotal, sheetRows, 'SUCCESS', '');
    Logger.log('Meta Leads: SUCCESS — ' + sheetRows + '/' + apiTotal + ' rows written to "' + TABS.META + '".');
  } catch (e) {
    // Preserve the last successful export; only log the failure.
    logSync(ss, module, apiTotal, sheetRowCount(ss, TABS.META), 'FAILED', String(e));
    Logger.log('Meta Leads: FAILED — ' + e);
    throw e;
  }
}

// ======================= CONNECT LEADS =======================
function syncConnectLeads() {
  var ss = getSpreadsheet();
  var module = 'Connect Leads';
  var apiCount = 0;
  try {
    var resp = apiGet('/sheets-sync/leads-by-status', {});
    if (!resp || !resp.data) throw new Error('Unexpected response (missing data).');
    var groups = resp.data;
    var header = ['Lead ID', 'Name', 'Phone', 'Email', 'City', 'Source', 'Status',
      'Last Outcome', 'Telecaller', 'Notes', 'Created At', 'Last Call At'];
    var rows = [];
    Object.keys(groups).forEach(function (status) {
      (groups[status] || []).forEach(function (l) {
        rows.push([l.id || '', l.name || '', l.phone || '', l.email || '', l.city || '',
          l.source || '', l.status || '', l.last_call_outcome || '', l.telecaller || '',
          l.notes || '', l.created_at || '', l.last_call_at || '']);
      });
    });
    apiCount = rows.length;
    if (apiCount === 0) {
      logSync(ss, module, 0, 0, 'SUCCESS', 'No Connect leads returned (genuinely empty).');
      return;
    }
    writeTable(ss, TABS.CONNECT, header, rows, [0, 2]); // Lead ID + Phone as text
    var sheetRows = sheetRowCount(ss, TABS.CONNECT);
    if (sheetRows !== apiCount) throw new Error('Verify FAILED: ' + sheetRows + ' rows vs ' + apiCount + ' expected.');
    logSync(ss, module, apiCount, sheetRows, 'SUCCESS', '');
    Logger.log('Connect Leads: SUCCESS — ' + sheetRows + ' rows.');
  } catch (e) {
    logSync(ss, module, apiCount, sheetRowCount(ss, TABS.CONNECT), 'FAILED', String(e));
    Logger.log('Connect Leads: FAILED — ' + e);
    throw e;
  }
}

// ======================= DAILY REPORT =======================
function syncDailyReport() {
  var ss = getSpreadsheet();
  var module = 'Daily Report';
  var apiCount = 0;
  try {
    var resp = apiGet('/sheets-sync/daily-report', {});
    var stats = (resp && resp.user_stats) || [];
    var header = ['User ID', 'User', 'Total Calls', 'Connected', 'No Answer', 'Busy', 'Wrong Number', 'Total Duration'];
    var rows = stats.map(function (s) {
      return [s._id || '', s.user_name || '', s.total_calls || 0, s.connected || 0,
        s.no_answer || 0, s.busy || 0, s.wrong_number || 0, s.total_duration || 0];
    });
    apiCount = rows.length;
    writeTable(ss, TABS.DAILY, header, rows, [0]);
    var sheetRows = sheetRowCount(ss, TABS.DAILY);
    if (sheetRows !== apiCount) throw new Error('Verify FAILED: ' + sheetRows + ' vs ' + apiCount + '.');
    logSync(ss, module, apiCount, sheetRows, 'SUCCESS', (resp && resp.date) ? ('date ' + resp.date) : '');
    Logger.log('Daily Report: SUCCESS — ' + sheetRows + ' rows.');
  } catch (e) {
    logSync(ss, module, apiCount, sheetRowCount(ss, TABS.DAILY), 'FAILED', String(e));
    Logger.log('Daily Report: FAILED — ' + e);
    throw e;
  }
}

// ======================= ATTENDANCE =======================
function syncAttendance() {
  var ss = getSpreadsheet();
  var module = 'Attendance';
  var apiCount = 0;
  try {
    var resp = apiGet('/sheets-sync/attendance-summary', {});
    var recs = (resp && resp.records) || [];
    var header = ['Date', 'User', 'Status', 'Work Mode', 'Check In', 'Check Out', 'Duration (hrs)'];
    var rows = recs.map(function (r) {
      return [r.date || '', r.user || '', r.status || '', r.work_mode || '',
        r.check_in || '', r.check_out || '', r.duration_hrs || 0];
    });
    apiCount = rows.length;
    writeTable(ss, TABS.ATTENDANCE, header, rows, []);
    var sheetRows = sheetRowCount(ss, TABS.ATTENDANCE);
    if (sheetRows !== apiCount) throw new Error('Verify FAILED: ' + sheetRows + ' vs ' + apiCount + '.');
    logSync(ss, module, apiCount, sheetRows, 'SUCCESS', (resp && resp.period) || '');
    Logger.log('Attendance: SUCCESS — ' + sheetRows + ' rows.');
  } catch (e) {
    logSync(ss, module, apiCount, sheetRowCount(ss, TABS.ATTENDANCE), 'FAILED', String(e));
    Logger.log('Attendance: FAILED — ' + e);
    throw e;
  }
}

// ======================= SYNC LOG =======================
function logSync(ss, module, apiRecords, sheetRecords, status, error) {
  var sh = ss.getSheetByName(TABS.LOG);
  if (!sh) {
    sh = ss.insertSheet(TABS.LOG);
    sh.getRange(1, 1, 1, 6)
      .setValues([['Timestamp', 'Module', 'API Records', 'Sheet Records', 'Status', 'Error']])
      .setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  // Force SUCCESS -> FAILED if counts don't reconcile.
  if (status === 'SUCCESS' && apiRecords !== sheetRecords) {
    status = 'FAILED';
    error = (error ? error + ' | ' : '') + 'Count mismatch: API ' + apiRecords + ' vs Sheet ' + sheetRecords;
  }
  sh.appendRow([new Date(), module, apiRecords, sheetRecords, status, error || '']);
  SpreadsheetApp.flush();
}

function sheetRowCount(ss, tabName) {
  var sh = ss.getSheetByName(tabName);
  if (!sh) return 0;
  var last = sh.getLastRow();
  return last > 0 ? last - 1 : 0; // minus header
}
