/**
 * Bankezee Connect → Google Sheet: copies ALL records from the Connect "Data" tab (every status, assigned + unassigned,
 * active + archived + invalid) into the sheet below. Safe to re-run: rows are de-duplicated by record ID.
 * Setup: fill CONFIG, run exportAll once (approve permissions). It schedules itself every minute until finished.
 */
const CONFIG = {
  SHEET_ID: '1XRt1zgoB2nT2nZonXTuuFfSyxTUckcx1MzlajW4Pwg8',
  TAB: 'Data',
  BASE_URL: 'https://connect.bankezee.com',
  EMAIL: 'ADMIN_EMAIL_HERE',        // Connect CRM admin login
  PASSWORD: 'ADMIN_PASSWORD_HERE',
};
const SETS = [{ archived: 'false', is_invalid: 'false' }, { archived: 'true', is_invalid: 'false' },
              { archived: 'false', is_invalid: 'true' }, { archived: 'true', is_invalid: 'true' }];
const FIRST = ['id', 'legacy_crm_id', 'name', 'phone', 'email', 'company_name', 'city', 'status', 'last_call_outcome',
  'call_count', 'last_call_at', 'assigned_to', 'telecaller_name', 'telecaller_email', 'source', 'notes', 'archived',
  'is_invalid', 'created_at', 'updated_at'];

function exportAll() {
  PropertiesService.getScriptProperties().setProperty('PROG', JSON.stringify({ set: 0, page: 1 }));
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('continueExport').timeBased().everyMinutes(1).create();
  continueExport();
}

function continueExport() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const t0 = Date.now(), props = PropertiesService.getScriptProperties();
    const prog = JSON.parse(props.getProperty('PROG') || 'null');
    if (!prog) return;
    const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    const sh = ss.getSheetByName(CONFIG.TAB) || ss.insertSheet(CONFIG.TAB);
    let headers = sh.getLastRow() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
    const seen = {};
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(r => seen[r[0]] = 1);
    const token = login_();
    while (Date.now() - t0 < 4.5 * 60 * 1000) {
      const res = get_(token, '/api/leads', Object.assign({ page: prog.page, page_size: 300, sort_by: 'created_at', sort_order: 'asc' }, SETS[prog.set]));
      const leads = (res.leads || []).filter(l => !seen[String(l.id || l._id)]);
      if (leads.length) {
        leads.forEach(l => Object.keys(l).forEach(k => { if (headers.indexOf(k) < 0) headers.push(k); }));
        if (!headers.length || headers[0] !== 'id') headers = FIRST.concat(headers.filter(h => FIRST.indexOf(h) < 0));
        sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
        const rows = leads.map(l => { seen[String(l.id || l._id)] = 1; return headers.map(h => cell_(h === 'id' ? (l.id || l._id) : l[h])); });
        const rng = sh.getRange(sh.getLastRow() + 1, 1, rows.length, headers.length);
        rng.setNumberFormat('@');                         // keep phones / IDs / dates as text
        rng.setValues(rows);
      }
      if (res.pagination.has_next) prog.page++;
      else if (prog.set < SETS.length - 1) { prog.set++; prog.page = 1; }
      else { finish_(sh, token); props.deleteProperty('PROG'); return; }
      props.setProperty('PROG', JSON.stringify(prog));
    }
  } finally { lock.releaseLock(); }
}

function finish_(sh, token) {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  let total = 0, unassigned = 0;
  SETS.forEach(s => {
    total += get_(token, '/api/leads', Object.assign({ page: 1, page_size: 10 }, s)).pagination.total_count;
    unassigned += get_(token, '/api/leads', Object.assign({ page: 1, page_size: 10, assigned_to: 'unassigned' }, s)).pagination.total_count;
  });
  const rows = sh.getLastRow() - 1;
  const ss = sh.getParent(), sum = ss.getSheetByName('Export Check') || ss.insertSheet('Export Check');
  sum.clear().getRange(1, 1, 6, 2).setValues([
    ['Checked at', new Date().toISOString()], ['CRM total records', total], ['Rows in sheet', rows],
    ['Difference (sheet − CRM)', rows - total], ['CRM assigned', total - unassigned], ['CRM unassigned', unassigned]]);
}

function login_() {
  const r = UrlFetchApp.fetch(CONFIG.BASE_URL + '/api/auth/login', { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ email: CONFIG.EMAIL, password: CONFIG.PASSWORD, platform: 'web' }) });
  if (r.getResponseCode() !== 200) throw new Error('CRM login failed: ' + r.getContentText().slice(0, 200));
  return JSON.parse(r.getContentText()).token;
}

function get_(token, path, params) {
  const q = Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&');
  for (let i = 0; i < 4; i++) {
    const r = UrlFetchApp.fetch(CONFIG.BASE_URL + path + '?' + q, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    if (r.getResponseCode() === 200) return JSON.parse(r.getContentText());
    Utilities.sleep(3000 * (i + 1));
  }
  throw new Error('CRM request failed: ' + path);
}

function cell_(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 45000 ? s.slice(0, 45000) + '…' : s;
}
