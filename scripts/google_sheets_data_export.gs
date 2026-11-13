/**
 * Bankezee Connect – Legacy Data Archive (Google Apps Script)
 * Pulls every record behind the Connect "Data" tab (all pages; active, archived and invalid) into this Google Sheet,
 * de-duplicated by the original record ID, then verifies counts against production.
 * Paste into Extensions → Apps Script of the target sheet, save, reload the sheet, use the "Bankezee Export" menu.
 */
const DEFAULT_BASE_URL = 'https://connect.bankezee.com';
const PAGE_SIZE = 300;                 // API maximum
const RUN_MS = 5 * 60 * 1000;          // stay under the 6-minute Apps Script limit
const DATASETS = [
  { label: 'Active',             params: { archived: 'false', is_invalid: 'false' } },
  { label: 'Archived',           params: { archived: 'true',  is_invalid: 'false' } },
  { label: 'Invalid',            params: { archived: 'false', is_invalid: 'true' } },
  { label: 'Archived + Invalid', params: { archived: 'true',  is_invalid: 'true' } },
];
const PASS_SORTS = ['created_at', 'updated_at', 'name'];   // gap-filling passes if counts don't match
const CORE = ['id', 'legacy_crm_id', 'name', 'phone', 'alternate_phone', 'email', 'company_name', 'city', 'employment_type', 'salary',
  'requirement', 'loan_amount', 'status', 'file_status', 'last_call_outcome', 'call_count', 'last_call_at', 'next_follow_up', 'assigned_to',
  'telecaller_name', 'telecaller_email', 'assigned_at', 'last_assigned_at', 'previous_gps', 'team', 'tl_name',
  'source', 'import_batch_id', 'notes', 'remarks', 'archived', 'is_invalid', 'created_at', 'updated_at'];
const REC_HEADERS = ['Dataset'].concat(CORE, ['other_fields_json']);
const CALL_HEADERS = ['record_id', 'call_id', 'created_at', 'user_id', 'user_name', 'outcome', 'duration_seconds',
  'direction', 'notes', 'is_previous_agent_history', 'source', 'other_fields_json'];
const REC_SHEET = 'Records', CALL_SHEET = 'Call History', SUM_SHEET = 'Summary';

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Bankezee Export')
    .addItem('1. Set up connection', 'setupConnection')
    .addItem('2. Start / restart records export', 'startExport')
    .addItem('Continue records export now', 'continueExport')
    .addItem('3. Verify counts', 'verifyCounts')
    .addSeparator()
    .addItem('4. Export call history (optional)', 'startCallHistory')
    .addItem('Continue call history now', 'continueCallHistory')
    .addSeparator()
    .addItem('Stop all scheduled runs', 'stopTriggers')
    .addToUi();
}

/* ---------- connection ---------- */
function setupConnection() {
  const ui = SpreadsheetApp.getUi(), p = PropertiesService.getUserProperties();
  const url = ui.prompt('CRM address', `Leave blank for ${DEFAULT_BASE_URL}`, ui.ButtonSet.OK_CANCEL);
  if (url.getSelectedButton() !== ui.Button.OK) return;
  const email = ui.prompt('Admin email (Connect CRM admin account)', ui.ButtonSet.OK_CANCEL);
  if (email.getSelectedButton() !== ui.Button.OK) return;
  const pw = ui.prompt('Admin password (stored only in your private Apps Script user properties)', ui.ButtonSet.OK_CANCEL);
  if (pw.getSelectedButton() !== ui.Button.OK) return;
  p.setProperties({ BASE_URL: (url.getResponseText().trim() || DEFAULT_BASE_URL).replace(/\/$/, ''),
                    EMAIL: email.getResponseText().trim(), PASSWORD: pw.getResponseText() });
  CacheService.getUserCache().remove('TOKEN');
  token_();
  ui.alert('Connected. Now run "2. Start / restart records export".');
}

function token_(force) {
  const cache = CacheService.getUserCache();
  let t = force ? null : cache.get('TOKEN');
  if (t) return t;
  const p = PropertiesService.getUserProperties().getProperties();
  if (!p.EMAIL) throw new Error('Run "1. Set up connection" first.');
  const r = UrlFetchApp.fetch(`${p.BASE_URL}/api/auth/login`, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ email: p.EMAIL, password: p.PASSWORD, platform: 'web' }) });
  if (r.getResponseCode() !== 200) throw new Error(`Login failed (${r.getResponseCode()}): ${r.getContentText().slice(0, 200)}`);
  const body = JSON.parse(r.getContentText());
  if (!body.user || body.user.role !== 'admin') throw new Error('This account is not an admin — admin access is needed to see all records.');
  t = body.token;
  cache.put('TOKEN', t, 6 * 3600);
  return t;
}

function url_(path, params) {
  const base = PropertiesService.getUserProperties().getProperty('BASE_URL');
  const q = Object.keys(params || {}).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
  return `${base}${path}${q ? '?' + q : ''}`;
}

function api_(path, params) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = UrlFetchApp.fetch(url_(path, params), { headers: { Authorization: `Bearer ${token_(attempt > 0 && attempt % 2 === 1)}` }, muteHttpExceptions: true });
    const code = r.getResponseCode();
    if (code === 200) return JSON.parse(r.getContentText());
    if (code !== 401 && code < 500 && code !== 429) throw new Error(`${path} failed (${code}): ${r.getContentText().slice(0, 200)}`);
    Utilities.sleep(2000 * (attempt + 1));
  }
  throw new Error(`${path} kept failing after retries`);
}

/* ---------- sheet helpers ---------- */
function sheet_(name, headers) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  sh.getRange(1, 1, sh.getMaxRows(), headers.length).setNumberFormat('@');   // IDs, phones, dates stay as text
  return sh;
}

function keyCol_(sh, col) {
  const n = sh.getLastRow() - 1;
  const set = {};
  if (n > 0) sh.getRange(2, col, n, 1).getValues().forEach(r => { if (r[0] !== '') set[String(r[0])] = true; });
  return set;
}

function append_(sh, rows, width) {
  if (!rows.length) return;
  const start = sh.getLastRow() + 1;
  if (sh.getMaxRows() < start + rows.length) sh.insertRowsAfter(sh.getMaxRows(), start + rows.length - sh.getMaxRows() + 1000);
  const rng = sh.getRange(start, 1, rows.length, width);
  rng.setNumberFormat('@');
  rng.setValues(rows);
}

function cell_(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 45000 ? s.slice(0, 45000) + '…[truncated]' : s;
}

function recordRow_(label, lead) {
  const id = lead.id || lead._id;
  const extra = {};
  Object.keys(lead).forEach(k => { if (CORE.indexOf(k) < 0 && k !== '_id') extra[k] = lead[k]; });
  if (lead._id && lead._id !== id) extra._id = lead._id;
  return [label].concat(CORE.map(k => cell_(k === 'id' ? id : lead[k])), [cell_(extra)]);
}

/* ---------- triggers / progress ---------- */
function schedule_(fn) {
  stopTriggers();
  ScriptApp.newTrigger(fn).timeBased().everyMinutes(1).create();
}
function stopTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
}
function getProg_(k) { const v = PropertiesService.getDocumentProperties().getProperty(k); return v ? JSON.parse(v) : null; }
function setProg_(k, v) { PropertiesService.getDocumentProperties().setProperty(k, JSON.stringify(v)); }

/* ---------- records export ---------- */
function startExport() {
  token_();
  sheet_(REC_SHEET, REC_HEADERS);
  setProg_('REC', { pass: 0, ds: 0, page: 1, done: false, started: new Date().toISOString() });
  schedule_('continueExport');
  continueExport();
}

function continueExport() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(1000)) return;                       // a run is already in progress
  try {
    const t0 = Date.now();
    let prog = getProg_('REC');
    if (!prog || prog.done) { stopTriggers(); return; }
    const sh = sheet_(REC_SHEET, REC_HEADERS);
    const seen = keyCol_(sh, REC_HEADERS.indexOf('id') + 1);   // original record ID column
    while (Date.now() - t0 < RUN_MS) {
      const ds = DATASETS[prog.ds];
      const res = api_('/api/leads', Object.assign({}, ds.params, { page: prog.page, page_size: PAGE_SIZE,
        sort_by: PASS_SORTS[prog.pass], sort_order: 'asc' }));
      const rows = [];
      (res.leads || []).forEach(l => { const id = String(l.id || l._id); if (!seen[id]) { seen[id] = true; rows.push(recordRow_(ds.label, l)); } });
      append_(sh, rows, REC_HEADERS.length);
      if (res.pagination.has_next) prog.page += 1;
      else if (prog.ds < DATASETS.length - 1) { prog.ds += 1; prog.page = 1; }
      else {
        const gaps = verifyCounts(true);
        if (gaps > 0 && prog.pass < PASS_SORTS.length - 1) { prog.pass += 1; prog.ds = 0; prog.page = 1; }   // re-scan in another order to fill gaps
        else { prog.done = true; prog.finished = new Date().toISOString(); setProg_('REC', prog); stopTriggers(); return; }
      }
      setProg_('REC', prog);
    }
  } finally { lock.releaseLock(); }
}

/* ---------- verification ---------- */
function verifyCounts(silent) {
  const ss = SpreadsheetApp.getActive();
  const sh = sheet_(REC_SHEET, REC_HEADERS);
  const n = sh.getLastRow() - 1;
  const H = REC_HEADERS;
  const iDs = 0, iId = H.indexOf('id'), iAs = H.indexOf('assigned_to'), iSt = H.indexOf('status'), iCr = H.indexOf('created_at');
  const data = n > 0 ? sh.getRange(2, 1, n, H.length).getValues() : [];
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const ids = {}; let dup = 0;
  const per = {}; DATASETS.forEach(d => per[d.label] = { rows: 0, assigned: 0, unassigned: 0 });
  let sheetUnused = 0;
  data.forEach(r => {
    if (ids[r[iId]]) dup++; ids[r[iId]] = true;
    const p = per[r[iDs]]; if (!p) return;
    p.rows++; if (String(r[iAs]).trim()) p.assigned++; else p.unassigned++;
    if (r[iSt] === 'new' && r[iCr] && new Date(String(r[iCr]).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(r[iCr]) ? '' : 'Z')) < today) sheetUnused++;
  });
  const out = [['Dataset', 'Production total', 'Sheet rows', 'Difference', 'Production unassigned', 'Sheet unassigned',
    'Production assigned', 'Sheet assigned', 'Checked at']];
  let gaps = 0, tot = { src: 0, rows: 0, srcU: 0, shU: 0, srcA: 0, shA: 0 };
  const at = new Date().toISOString();
  DATASETS.forEach(d => {
    const src = api_('/api/leads', Object.assign({}, d.params, { page: 1, page_size: 10 })).pagination.total_count;
    const srcU = api_('/api/leads', Object.assign({}, d.params, { page: 1, page_size: 10, assigned_to: 'unassigned' })).pagination.total_count;
    const p = per[d.label];
    gaps += Math.max(0, src - p.rows);
    out.push([d.label, src, p.rows, p.rows - src, srcU, p.unassigned, src - srcU, p.assigned, at]);
    tot.src += src; tot.rows += p.rows; tot.srcU += srcU; tot.shU += p.unassigned; tot.srcA += src - srcU; tot.shA += p.assigned;
  });
  out.push(['ALL RECORDS', tot.src, tot.rows, tot.rows - tot.src, tot.srcU, tot.shU, tot.srcA, tot.shA, at]);
  let dashUnused = '';
  try { dashUnused = api_('/api/dashboard/stats', {}).unused_data; } catch (e) { dashUnused = 'unavailable: ' + e.message; }
  const notes = [[''], [`Dashboard "Unused Data" (production, now): ${dashUnused}  ·  Sheet rows with status "new" created before today (UTC): ${sheetUnused}`],
    [`Duplicate record IDs in sheet: ${dup}`],
    [`Difference = Sheet rows − Production total. Positive values usually mean records were added/changed in production during the export; negative values mean rows still missing (re-run Continue).`],
    [`Records export progress: ${JSON.stringify(getProg_('REC'))}`]];
  let sum = ss.getSheetByName(SUM_SHEET) || ss.insertSheet(SUM_SHEET, 0);
  sum.clear();
  sum.getRange(1, 1, out.length, out[0].length).setValues(out);
  sum.getRange(1, 1, 1, out[0].length).setFontWeight('bold');
  sum.getRange(out.length + 1, 1, notes.length, 1).setValues(notes);
  if (!silent) SpreadsheetApp.getUi().alert(`Verified. Production ${tot.src} · Sheet ${tot.rows} · Missing ${gaps} · Duplicates ${dup}. See the Summary tab.`);
  return gaps;
}

/* ---------- call history (one request per record with calls) ---------- */
function startCallHistory() {
  token_();
  sheet_(CALL_SHEET, CALL_HEADERS);
  setProg_('CALL', { idx: 0, done: false, calls: 0, failed: [] });
  schedule_('continueCallHistory');
  continueCallHistory();
}

function continueCallHistory() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(1000)) return;
  try {
    const t0 = Date.now();
    let prog = getProg_('CALL');
    if (!prog || prog.done) { stopTriggers(); return; }
    const rec = sheet_(REC_SHEET, REC_HEADERS), H = REC_HEADERS;
    const n = rec.getLastRow() - 1;
    const data = n > 0 ? rec.getRange(2, 1, n, H.length).getValues() : [];
    const iId = H.indexOf('id'), iCc = H.indexOf('call_count'), iLc = H.indexOf('last_call_at'), iLo = H.indexOf('last_call_outcome');
    const targets = data.filter(r => Number(r[iCc]) > 0 || r[iLc] || r[iLo] || !['new', ''].includes(String(r[H.indexOf('status')]))).map(r => String(r[iId]));
    const sh = sheet_(CALL_SHEET, CALL_HEADERS);
    const seen = keyCol_(sh, 2);
    const tok = token_();
    while (Date.now() - t0 < RUN_MS && prog.idx < targets.length) {
      const batch = targets.slice(prog.idx, prog.idx + 40);
      const reqs = batch.map(id => ({ url: url_(`/api/leads/${encodeURIComponent(id)}/call-logs`), headers: { Authorization: `Bearer ${tok}` }, muteHttpExceptions: true }));
      const rows = [];
      UrlFetchApp.fetchAll(reqs).forEach((r, i) => {
        if (r.getResponseCode() !== 200) { if (prog.failed.length < 500) prog.failed.push(batch[i]); return; }
        (JSON.parse(r.getContentText()) || []).forEach(c => {
          const cid = String(c.id || c._id || `${batch[i]}|${c.created_at}|${c.user_id}`);
          if (seen[cid]) return; seen[cid] = true;
          const known = ['lead_id', 'id', '_id', 'created_at', 'user_id', 'user_name', 'outcome', 'duration', 'duration_seconds', 'direction', 'notes', 'is_previous_agent_history', 'source'];
          const extra = {}; Object.keys(c).forEach(k => { if (known.indexOf(k) < 0) extra[k] = c[k]; });
          rows.push([batch[i], cid, c.created_at, c.user_id, c.user_name, c.outcome, c.duration_seconds != null ? c.duration_seconds : c.duration,
            c.direction, c.notes, c.is_previous_agent_history, c.source, extra].map(cell_));
        });
      });
      append_(sh, rows, CALL_HEADERS.length);
      prog.calls += rows.length;
      prog.idx += batch.length;
      setProg_('CALL', prog);
    }
    if (prog.idx >= targets.length) { prog.done = true; prog.targets = targets.length; setProg_('CALL', prog); stopTriggers(); }
  } finally { lock.releaseLock(); }
}
