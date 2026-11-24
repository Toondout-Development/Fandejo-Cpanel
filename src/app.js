const $ = (s, r = document) => r.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtSize = b => b == null ? '–' : b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB';

let csrf = '';
const LOGO_SVG = `<svg viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="fg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="var(--accent)"/><stop offset="100%" stop-color="var(--accent2)"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="var(--bg)" stroke="var(--line)" stroke-width="2"/><path d="M7 9h18l-2 4H9z" fill="url(#fg)"/><rect x="9" y="15" width="14" height="3.2" rx="1.6" fill="var(--accent)"/><rect x="11" y="20.5" width="10" height="3.2" rx="1.6" fill="var(--cyan)"/></svg>`;

// Seamless migration of localStorage keys from codename Typhon -> Fandejo
for (const k of ['prefs', 'saved', 'history']) {
    if (!localStorage['fandejo_' + k] && localStorage['typhon_' + k]) {
        localStorage['fandejo_' + k] = localStorage['typhon_' + k];
    }
}

function getPrefs() {
    try { return { engine: 'InnoDB', collation: 'utf8mb4_unicode_ci', perPage: 50, ...JSON.parse(localStorage.fandejo_prefs || '{}') }; }
    catch { return { engine: 'InnoDB', collation: 'utf8mb4_unicode_ci', perPage: 50 }; }
}
function savePrefs(p) {
    const next = { ...getPrefs(), ...p };
    localStorage.fandejo_prefs = JSON.stringify(next);
    if (p.perPage) S.browse.per = +p.perPage;
    return next;
}
function collSelectOpts(sel, blankLabel = '') {
    const groups = S.meta?.collations && Object.keys(S.meta.collations).length
        ? S.meta.collations
        : { utf8mb4: ['utf8mb4_unicode_ci', 'utf8mb4_general_ci', 'utf8mb4_bin', 'utf8mb4_0900_ai_ci'], utf8mb3: ['utf8mb3_general_ci', 'utf8mb3_unicode_ci'], latin1: ['latin1_swedish_ci', 'latin1_general_ci'] };
    let h = blankLabel ? `<option value="">${esc(blankLabel)}</option>` : '';
    for (const [cs, list] of Object.entries(groups)) {
        h += `<optgroup label="${esc(cs)}">${list.map(c => `<option value="${esc(c)}" ${c === sel ? 'selected' : ''}>${esc(c)}</option>`).join('')}</optgroup>`;
    }
    return h;
}
function engineSelectOpts(sel) {
    const list = S.meta?.engines?.length ? S.meta.engines : ['InnoDB', 'MyISAM', 'MEMORY', 'Aria', 'CSV'];
    return list.map(e => `<option value="${esc(e)}" ${e === sel ? 'selected' : ''}>${esc(e)}</option>`).join('');
}

const S = { version: 'v1.0.2', driver: null, user: null, dbs: [], tables: {}, meta: null, db: null, table: null, tab: 'browse', filter: '', browse: { page: 1, per: getPrefs().perPage, sort: '', dir: 'asc', search: '', filters: [], showFilterBar: false }, fkBack: [], sql: '' };

function showLicenseModal() {
    modal(`<div style="width:min(580px,85vw)"><h3>Fandejo ${esc(S.version)} — License & Attribution</h3>
      <div class="doc-body" style="font-size:13px;color:var(--mute)">
        <p style="color:var(--text)"><b>Copyright © 2026 <a href="https://toondout.com" target="_blank" rel="noopener" style="color:var(--accent)">Toondout</a>.</b> Canonical repository: <a href="https://github.com/Toondout-Development/Fandejo" target="_blank" rel="noopener" style="color:var(--cyan)">github.com/Toondout-Development/Fandejo</a></p>
        <p><b>Free to Use:</b> Fandejo is free to download, install, and run for personal, educational, internal business, or commercial database administration.</p>
        <p><b>Contributions Welcome:</b> Personal/internal forks and Pull Requests back to <a href="https://github.com/Toondout-Development/Fandejo" target="_blank" rel="noopener" style="color:var(--cyan)">Toondout-Development/Fandejo</a> are encouraged.</p>
        <p><b>No Public Redistribution or Rebranding:</b> Redistributing modified or rebranded copies, or offering Fandejo as a third-party hosted service without prior written permission from Toondout, is prohibited. See the repository <code>LICENSE</code> file for full terms.</p>
      </div>
    </div>`, () => {});
    const cancelBtn = $('#mx');
    if (cancelBtn) cancelBtn.style.display = 'none';
}

async function api(a, body = {}) {
    const r = await fetch('api.live.php?a=' + a, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF': csrf }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({ error: 'Invalid server response' }));
    if (!r.ok || j.error) { if (r.status === 401 && a !== 'login') return boot(); throw new Error(j.error || 'Request failed'); }
    return j;
}
function toast(m, err = false) {
    const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = m;
    $('#toasts').append(t); setTimeout(() => t.remove(), 4000);
}
const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };
function modal(html, onSubmit) {
    const d = $('#modal'); d.innerHTML = `<form class="form" method="dialog">${html}<div class="row"><span class="spacer" style="flex:1"></span><button type="button" value="x" id="mx">Cancel</button><button class="primary" id="mok">OK</button></div></form>`;
    $('#mx').onclick = () => d.close();
    const form = $('form', d);
    form.onsubmit = guard(async e => {
        e.preventDefault(); await onSubmit(Object.fromEntries(new FormData(e.target)));
        if (d.firstElementChild === form) d.close(); // onSubmit may have opened another dialog in its place
    });
    if (!d.open) d.showModal();
}
const confirmDo = (msg, fn) => modal(`<h3>Confirm</h3><p>${esc(msg)}</p>`, fn);

/* ---------- URL hash routing & boot / login ---------- */
let suppressHashSync = false;
function buildHash() {
    const enc = encodeURIComponent;
    if (!S.db) return '#' + enc(S.tab || 'home');
    if (!S.table) return '#' + enc(S.db) + '//' + enc(S.tab || 'tables');
    return '#' + enc(S.db) + '/' + enc(S.table) + '/' + enc(S.tab || 'browse');
}
function syncHash() {
    if (suppressHashSync) return;
    const h = buildHash();
    if (location.hash !== h) history.pushState(null, '', h);
}
async function applyHashState() {
    const raw = location.hash.replace(/^#/, '');
    if (!raw) return;
    const parts = raw.split('/').map(s => { try { return decodeURIComponent(s); } catch { return s; } });
    if (parts.length === 1) {
        S.db = null; S.table = null; S.tab = parts[0] || 'home';
    } else {
        const [db, tb, tab] = parts;
        if (db && S.dbs.some(d => d.name === db)) {
            S.db = db;
            if (!S.tables[S.db]) await loadTables(S.db);
            S.table = (tb && (S.tables[S.db] || []).some(t => t.name === tb)) ? tb : null;
            S.tab = tab || (S.table ? 'browse' : 'tables');
        } else {
            S.db = null; S.table = null; S.tab = 'home';
        }
    }
}
window.addEventListener('hashchange', guard(async () => {
    if (!S.driver) return;
    suppressHashSync = true;
    try {
        await applyHashState();
        render();
    } finally {
        suppressHashSync = false;
    }
}));

async function boot() {
    const s = await (await fetch('api.live.php?a=session')).json();
    if (s.version) S.version = s.version;
    if (!s.auth) return loginView(s);
    csrf = (await (await fetch('api.live.php?a=csrf')).json()).csrf;
    S.driver = s.driver; S.user = s.user; S.sqliteDirs = s.sqlite_dirs || [];
    await loadDbs();
    suppressHashSync = true;
    try { await applyHashState(); } finally { suppressHashSync = false; }
    layout();
}
function loginView(s = {}) {
    if (s.version) S.version = s.version;
    const needSetup = !!s.sqlite_setup;
    const dirs = (s.sqlite_dirs || []).join(', ') || 'data/';
    $('#app').innerHTML = `<div class="login"><form class="card" id="lf"><div class="brand-mark">${LOGO_SVG}<h1>Fandejo</h1><span class="badge" style="margin-left:auto">${esc(S.version)}</span></div><span style="color:var(--mute)">A modern foundry for MariaDB, MySQL, and SQLite3</span>
    <label>Engine<select name="driver"><option value="mysql">MySQL / MariaDB</option><option value="sqlite">SQLite3 (Sandboxed Catalog)</option></select></label>
    <div id="my"><label>Host<input name="host" value="127.0.0.1"></label><label>Port<input name="port" value="3306"></label></div>
    <div id="sq" hidden>
      <div class="msg" style="margin:0;font-size:12px">
        <b>SQLite Directory Sandbox:</b><br><code style="word-break:break-all">${esc(dirs)}</code>
        ${needSetup ? `<br><span style="color:var(--accent)">First-time SQLite setup: enter an admin username & password below to initialize <code>config.php</code> with an Argon2id hash.</span>` : ''}
      </div>
      ${needSetup ? `<input type="hidden" name="setup_sqlite" value="1">` : ''}
    </div>
    <label>Username<input name="user" value="${needSetup ? 'admin' : 'root'}" required></label>
    <label>Password<input name="pass" type="password" placeholder="${needSetup ? 'Min 6 characters for SQLite setup' : ''}"></label>
    <button class="primary" id="lbtn">Sign in</button>
    <div class="brand-foot"><span>© 2026 <a href="https://toondout.com" target="_blank" rel="noopener">Toondout</a></span><span><a href="https://github.com/Toondout-Development/Fandejo" target="_blank" rel="noopener">GitHub</a> · <a href="#" id="l-lic">License</a></span></div></form></div>`;
    const lic = $('#l-lic');
    if (lic) lic.onclick = e => { e.preventDefault(); showLicenseModal(); };
    const f = $('#lf');
    f.driver.onchange = () => {
        const isSq = f.driver.value === 'sqlite';
        $('#my').hidden = isSq;
        $('#sq').hidden = !isSq;
        if (isSq && f.user.value === 'root') f.user.value = 'admin';
        else if (!isSq && f.user.value === 'admin') f.user.value = 'root';
        $('#lbtn').textContent = isSq && needSetup ? 'Initialize SQLite Auth & Sign in' : 'Sign in';
    };
    f.onsubmit = guard(async e => { e.preventDefault(); const r = await api('login', Object.fromEntries(new FormData(f))); csrf = r.csrf; await boot(); });
}
async function loadDbs() {
    const [dRes, mRes] = await Promise.all([api('databases'), S.meta ? Promise.resolve(S.meta) : api('server_meta').catch(() => null)]);
    S.dbs = dRes.databases.map(d => typeof d === 'string' ? { name: d } : d);
    if (mRes) S.meta = mRes;
    if (S.db && !S.dbs.some(d => d.name === S.db)) { S.db = null; S.table = null; }
}
async function loadTables(db) { S.tables[db] = (await api('tables', { db })).tables; }

/* ---------- layout ---------- */
function promptNewDb() {
    const my = S.driver === 'mysql';
    const dirs = S.sqliteDirs || [];
    modal(`<h3>New ${my ? 'database' : 'SQLite database file'}</h3>
      ${!my && dirs.length > 1 ? `<label>Target Sandbox Directory<select name="dir_idx">${dirs.map((d, i) => `<option value="${i}">${esc(d)}</option>`).join('')}</select></label>` : ''}
      <label>${my ? 'Name' : 'File name'}<input name="name" placeholder="${my ? 'my_database' : 'app_data.sqlite'}" required autofocus></label>
      ${my ? `<label>Default Collation<select name="collation">${collSelectOpts(getPrefs().collation)}</select></label>`
           : `<small style="color:var(--mute)">Created inside ${dirs.length > 1 ? 'the selected' : 'sandbox'} directory (<code>.sqlite</code> added automatically if omitted).</small>`}`, async v => {
        if (!my && v.dir_idx && +v.dir_idx > 0) v.name = `@${v.dir_idx}:${v.name}`;
        const r = await api('create_db', v);
        await loadDbs();
        S.db = (!my && v.dir_idx && +v.dir_idx > 0) ? `@${v.dir_idx}:${r.name}` : (r.name || v.name);
        S.table = null; S.tab = 'tables';
        await loadTables(S.db); layout(); toast('Database created');
    });
}
async function manageSqliteDirs() {
    const r = await api('sqlite_dirs');
    modal(`<div style="width:min(640px,85vw)"><h3>📁 Manage SQLite Sandbox Directories</h3>
      <p style="color:var(--mute);font-size:12px;margin-top:0">Fandejo treats these directories as your SQLite database catalog. Only <code>.sqlite</code>, <code>.sqlite3</code>, and <code>.db</code> files directly inside these folders can be accessed.${!r.allow_any_dir && r.base_root ? ` New directories added via the UI must be inside <code>${esc(r.base_root)}</code> (or add external paths in <code>config.php</code>).` : ''}</p>
      <div id="sd-list"></div>
      <button type="button" id="sd-add" style="margin:6px 0 12px">+ Add directory path</button>
      <label class="pc"><input type="checkbox" name="create_missing" checked><span>Create missing directories</span><small>Automatically mkdir any new directory path if it does not exist yet</small></label>
      <div class="msg" style="margin-top:10px;font-size:12px">Note: For SQLite to run transactions in WAL/journal mode, the PHP process must have write permission on both the <code>.sqlite</code> file and its parent directory.</div>
    </div>`, async f => {
        const dirs = [...$('#sd-list').querySelectorAll('input.sd-inp')].map(i => i.value.trim()).filter(Boolean);
        const res = await api('set_sqlite_dirs', { dirs, create_missing: !!f.create_missing });
        S.sqliteDirs = res.dirs;
        await loadDbs();
        layout();
        toast('SQLite sandbox directories updated');
    });
    const host = $('#sd-list');
    const addRow = (d = { path: '', exists: null }) => {
        const row = document.createElement('div');
        row.className = 'rl-row';
        row.style.marginBottom = '6px';
        const badge = d.exists === null ? ''
            : !d.exists ? `<span class="badge warn" title="Directory does not exist">missing</span>`
            : `<span class="badge ${d.writable ? '' : 'warn'}" title="${d.writable ? 'Readable & writable' : 'Read-only for PHP'}">${d.files} db · ${d.writable ? 'rw' : 'ro'}</span>`;
        row.innerHTML = `<input class="sd-inp" value="${esc(d.path)}" placeholder="/var/www/data" style="flex:1;font-family:ui-monospace,monospace">${badge}<button type="button" class="ghost danger" title="Remove directory">✕</button>`;
        row.querySelector('button').onclick = () => { if (host.children.length > 1) row.remove(); };
        host.append(row);
    };
    (r.dirs.length ? r.dirs : [{ path: '', exists: null }]).forEach(addRow);
    $('#sd-add').onclick = () => addRow();
}
function layout() {
    $('#app').innerHTML = `<div class="layout"><aside><div class="head"><span id="brand" class="brand-mark" style="cursor:pointer" title="Go to Home dashboard">${LOGO_SVG}<span>Fandejo</span></span><span>
      <button class="ghost" id="theme" title="Toggle Dark / Light theme">◐</button><button class="ghost" id="out" title="Sign out">⏻</button></span></div>
      <input class="search" id="flt" placeholder="Filter…" value="${esc(S.filter)}"><div class="tree" id="tree"></div>
      <div style="padding:10px;display:flex;flex-direction:column;gap:8px"><button id="newdb" style="width:100%">+ New database</button>
      <div class="brand-foot"><span>${esc(S.version)} · © <a href="https://toondout.com" target="_blank" rel="noopener">Toondout</a></span><span><a href="https://github.com/Toondout-Development/Fandejo" target="_blank" rel="noopener">GitHub</a> · <a href="#" id="s-lic">License</a></span></div></div></aside>
      <main><div class="top"><div class="crumbs" id="crumbs"></div><button id="ghome">⌂ Home</button><button id="gusers">Users</button><button id="gsql">SQL</button></div><div id="tabs" class="tabs"></div><div class="content" id="content"></div></main></div>`;
    if ($('#s-lic')) $('#s-lic').onclick = e => { e.preventDefault(); showLicenseModal(); };
    $('#theme').onclick = () => { const r = document.documentElement; r.dataset.theme = r.dataset.theme === 'light' ? '' : 'light'; localStorage.theme = r.dataset.theme; };
    $('#out').onclick = async () => { await api('logout'); location.reload(); };
    $('#flt').oninput = e => { S.filter = e.target.value; tree(); $('#flt').focus(); };
    $('#newdb').onclick = promptNewDb;
    const goHome = () => { S.db = null; S.table = null; S.tab = 'home'; render(); };
    $('#brand').onclick = goHome;
    $('#ghome').onclick = goHome;
    $('#gsql').onclick = () => { S.tab = 'sql'; render(); };
    if ($('#gusers')) $('#gusers').onclick = () => { S.db = null; S.table = null; S.tab = 'users'; render(); };
    render();
}
function tree() {
    const f = S.filter.toLowerCase(), el = $('#tree'); if (!el) return;
    el.innerHTML = S.dbs.filter(d => !f || d.name.toLowerCase().includes(f) || (S.tables[d.name] || []).some(t => t.name.toLowerCase().includes(f))).map(d => {
        const open = S.db === d.name;
        let h = `<div class="node db ${open && !S.table ? 'active' : ''}" data-db="${esc(d.name)}"><span>${open ? '▾' : '▸'} 🗄 ${esc(d.label || d.name)}</span><small>${d.tables ?? ''}</small></div>`;
        if (open) h += (S.tables[d.name] || []).filter(t => !f || t.name.toLowerCase().includes(f)).map(t => `<div class="node tb ${S.table === t.name ? 'active' : ''}" data-db="${esc(d.name)}" data-tb="${esc(t.name)}"><span>${t.type?.includes('VIEW') || t.type === 'view' ? '👁' : '▦'} ${esc(t.name)}</span><small>${t.rows ?? ''}</small></div>`).join('');
        return h;
    }).join('') || `<div class="empty">${S.driver === 'sqlite' ? 'No SQLite files in sandbox yet' : 'Nothing found'}</div>`;
    el.querySelectorAll('.node').forEach(n => n.onclick = guard(async () => {
        S.db = n.dataset.db; S.table = n.dataset.tb || null; S.tab = S.table ? 'browse' : 'tables';
        S.fkBack = [];
        S.browse = { ...S.browse, page: 1, per: getPrefs().perPage, sort: '', search: '', filters: [], showFilterBar: false };
        if (!S.tables[S.db] || !S.table) await loadTables(S.db);
        render();
    }));
}
function render() {
    tree();
    $('#crumbs').innerHTML = S.db ? `<a href="#" id="chome" class="crumb">Fandejo</a> / <a href="#" id="cdb" class="crumb">${esc(S.db)}</a>${S.table ? ' / <b>' + esc(S.table) + '</b>' : ''}` : '<b>Fandejo</b> <span style="color:var(--mute)">/ Foundry Dashboard</span>';
    if ($('#chome')) $('#chome').onclick = e => { e.preventDefault(); S.fkBack = []; S.db = null; S.table = null; S.tab = 'home'; render(); };
    if ($('#cdb')) $('#cdb').onclick = guard(async e => { e.preventDefault(); S.fkBack = []; S.table = null; S.tab = 'tables'; await loadTables(S.db); render(); });
    const tabs = S.table ? [['browse', 'Browse'], ['structure', 'Structure'], ['sql', 'SQL'], ['insert', 'Insert'], ['export', 'Export'], ['import', 'Import'], ['ops', 'Operations']]
        : S.db ? [['tables', 'Tables'], ['sql', 'SQL'], ['newtable', 'New table'], ['routines', S.driver === 'mysql' ? 'Views / Routines / Triggers' : 'Views & Triggers'], ['export', 'Export'], ['import', 'Import'], ['dropdb', 'Operations']]
            : [['home', 'Dashboard'], ...(S.driver === 'mysql' ? [['processes', 'Processes']] : []), ['users', 'Users'], ['sql', 'SQL'], ['export', 'Export DB'], ['import', 'Import DB']];
    if (!tabs.some(t => t[0] === S.tab)) S.tab = tabs[0][0];
    syncHash();
    $('#tabs').innerHTML = tabs.map(([k, l]) => `<div class="tab ${S.tab === k ? 'active' : ''}" data-k="${k}">${l}</div>`).join('');
    $('#tabs').querySelectorAll('.tab').forEach(t => t.onclick = () => { S.tab = t.dataset.k; render(); });
    const view = { home: dbsHome, processes: processesView, browse, structure, sql: sqlView, insert: insertView, ops, tables: tablesView, newtable: newTable, routines: dbObjectsView, export: exportView, import: importView, dropdb, users }[S.tab];
    guard(view)();
}
const C = () => $('#content');

/* ---------- views ---------- */
async function tablesView() {
    const t = S.tables[S.db] || [], my = S.driver === 'mysql';
    const dbObj = S.dbs.find(d => d.name === S.db);
    C().innerHTML = `<div class="bar">${my && dbObj?.collation ? `<span class="badge">Database Collation: <b>${esc(dbObj.collation)}</b></span><button class="ghost" id="edbc">Change…</button>` : ''}<span class="spacer"></span><button id="nv-btn">+ New View</button><button class="primary" id="nt-btn">+ New Table</button></div>
      ${t.length ? `<div class="tw"><table><tr><th>Table / View</th><th>Type</th>${my ? '<th>Engine</th><th>Collation</th>' : ''}<th>Rows</th><th>Size</th><th></th></tr>${t.map(x => `<tr><td><a href="#" data-t="${esc(x.name)}" style="color:var(--accent)"><b>${x.type?.includes('VIEW') || x.type === 'view' ? '👁 ' : ''}${esc(x.name)}</b></a>${x.comment ? `<br><small style="color:var(--mute)">${esc(x.comment)}</small>` : ''}</td><td>${esc(x.type)}</td>${my ? `<td>${esc(x.engine ?? '–')}</td><td><small>${esc(x.collation ?? '–')}</small></td>` : ''}<td>${x.rows ?? '–'}</td><td>${fmtSize(x.size)}</td><td class="act"><button data-d="${esc(x.name)}" class="danger">Drop</button></td></tr>`).join('')}</table></div>` : '<div class="empty">No tables yet</div>'}`;
    if ($('#edbc')) $('#edbc').onclick = () => { S.tab = 'dropdb'; render(); };
    if ($('#nt-btn')) $('#nt-btn').onclick = () => { S.tab = 'newtable'; render(); };
    if ($('#nv-btn')) $('#nv-btn').onclick = () => viewEditor();
    C().querySelectorAll('[data-t]').forEach(a => a.onclick = e => { e.preventDefault(); S.fkBack = []; S.table = a.dataset.t; S.tab = 'browse'; S.browse = { ...S.browse, page: 1, sort: '', search: '', filters: [], showFilterBar: false }; render(); });
    C().querySelectorAll('[data-d]').forEach(b => b.onclick = () => confirmDo(`Drop ${b.dataset.d}?`, async () => { await api('drop_table', { db: S.db, table: b.dataset.d }); await loadTables(S.db); render(); }));
}

const FILTER_OPS = [
    ['=', '= (equals)', true],
    ['!=', '!= (not equal)', true],
    ['CONTAINS', 'contains (%val%)', true],
    ['STARTS', 'starts with (val%)', true],
    ['ENDS', 'ends with (%val)', true],
    ['LIKE', 'LIKE (custom %)', true],
    ['NOT LIKE', 'NOT LIKE', true],
    ['>', '> (greater than)', true],
    ['>=', '>= (at least)', true],
    ['<', '< (less than)', true],
    ['<=', '<= (at most)', true],
    ['IN', 'IN (comma-separated)', true],
    ['NOT IN', 'NOT IN (comma-separated)', true],
    ['IS NULL', 'IS NULL', false],
    ['IS NOT NULL', 'IS NOT NULL', false],
    ['EMPTY', "is empty ('')", false],
    ['NOT EMPTY', 'is not empty', false],
];
const opNeedsVal = op => FILTER_OPS.find(o => o[0] === op)?.[2] !== false;

async function browse() {
    const B = S.browse;
    B.filters ??= [];
    const r = await api('browse', { db: S.db, table: S.table, ...B });
    const pages = Math.max(1, Math.ceil(r.total / r.per));
    const keyCols = r.key_cols?.length ? r.key_cols : r.pk;
    const canEdit = !r.is_view && keyCols.length > 0;
    const uk = r.uk || [];
    const fkMap = r.fks || {};
    const noKeyNotice = r.key_type === 'all' ? `<span class="badge warn" title="This table has no PRIMARY or UNIQUE key. Edits and deletes match all column values${S.driver === 'mysql' ? ' (with LIMIT 1)' : ''}.">⚠ No PK (full-row match)</span>` : '';

    const defCol = r.columns[0] || '';
    const filterBarHtml = (B.showFilterBar || B.filters.length > 0) ? `<div class="dash-card" style="padding:10px 14px;margin-bottom:12px">
      <div class="bar" style="margin-bottom:${B.filters.length ? '8px' : '0'}">
        <small style="color:var(--mute);font-weight:700;text-transform:uppercase;letter-spacing:.04em">WHERE Filter</small>
        <select id="f-col">${r.columns.map(c => `<option value="${esc(c)}" ${c === (B.draftCol || defCol) ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <select id="f-op">${FILTER_OPS.map(([k, l]) => `<option value="${esc(k)}" ${k === (B.draftOp || '=') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
        <input id="f-val" placeholder="Value…" value="${esc(B.draftVal || '')}" ${opNeedsVal(B.draftOp || '=') ? '' : 'hidden'} style="width:200px">
        <button class="primary" id="f-add">+ Apply</button>
        ${B.filters.length || B.search ? `<button class="ghost danger" id="f-clr">Clear all</button>` : ''}
      </div>
      ${B.filters.length ? `<div class="chips" style="margin-top:4px">${B.filters.map((f, idx) => `<span class="chip" style="display:inline-flex;align-items:center;gap:6px;border-color:var(--accent)"><b>${esc(f.col)}</b> <span style="color:var(--accent)">${esc(f.op)}</span> ${opNeedsVal(f.op) ? `<code>${esc(f.val)}</code>` : ''}<a href="#" data-rmf="${idx}" style="color:var(--danger);text-decoration:none;font-weight:700" title="Remove filter">✕</a></span>`).join('')}</div>` : ''}
    </div>` : '';

    const prevNav = S.fkBack?.length ? S.fkBack[S.fkBack.length - 1] : null;
    const backBtnHtml = prevNav ? `<button id="fk-back" class="primary" title="Return to ${esc(prevNav.db !== S.db ? prevNav.db + '.' : '')}${esc(prevNav.table)} (${esc(prevNav.viaCol)} = ${esc(prevNav.viaVal)})">← Back to ${esc(prevNav.table)}</button>` : '';
    C().innerHTML = `<div class="bar">${backBtnHtml}<input id="bs" placeholder="Search all columns…" value="${esc(B.search)}" style="width:230px"><button id="btf" class="${B.filters.length ? 'primary' : ''}" title="Filter by specific column (uses indexes)">⧩ Filter${B.filters.length ? ` (${B.filters.length})` : ''}</button><span class="badge">${r.total} rows</span>${noKeyNotice}${r.is_view ? '<span class="badge">👁 Read-only view</span>' : ''}<button id="bcsv" title="Download the current search, filters, and sort as CSV">⬇ CSV</button>
      <span id="bulk-bar" class="row" hidden style="margin-left:6px;padding-left:10px;border-left:1px solid var(--line)">
        <span class="badge" id="bulk-cnt">0 selected</span>
        ${canEdit ? `<button id="bulk-edit" class="primary" title="Edit selected rows (batch or individually)">✎ Edit</button>` : ''}
        <button id="bulk-csv" title="Export selected rows as CSV">⬇ CSV</button>
        <button id="bulk-sql" title="Export selected rows as SQL INSERT statements">⬇ SQL</button>
        ${canEdit ? `<button id="bulk-del" class="danger" title="Delete selected rows">🗑 Delete</button>` : ''}
      </span>
      <span class="spacer"></span>
      <button id="pp" ${B.page <= 1 ? 'disabled' : ''}>‹</button><span>Page ${r.page} / ${pages}</span><button id="np" ${B.page >= pages ? 'disabled' : ''}>›</button>
      <select id="per">${[25, 50, 100, 250].map(n => `<option ${n === r.per ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      ${filterBarHtml}
      <div class="tw"><table><tr>${r.rows.length ? `<th style="width:1%;cursor:default"><input type="checkbox" id="sel-all" title="Select all rows on this page"></th>` : ''}${canEdit ? '<th></th>' : ''}${r.columns.map(c => {
          const fk = fkMap[c];
          const fkIcon = fk ? `<span style="color:var(--cyan)" title="Foreign key → ${esc(fk.ref_table)}.${esc(fk.ref_col)}">🔗</span> ` : '';
          return `<th data-c="${esc(c)}">${r.pk.includes(c) ? '<span class="pk" title="Primary key">🔑</span> ' : (uk.includes(c) ? '<span class="pk" title="Unique key">◈</span> ' : '')}${fkIcon}${esc(c)}${B.sort === c ? (B.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>`;
      }).join('')}</tr>
      ${r.rows.map((row, i) => `<tr data-ri="${i}"><td><input type="checkbox" class="rchk" data-i="${i}"></td>${canEdit ? `<td class="act"><button class="ghost" data-e="${i}" title="Edit row">✎</button><button class="ghost" data-cp="${i}" title="Copy / duplicate row">⧉</button><button class="ghost danger" data-x="${i}" title="Delete row">🗑</button></td>` : ''}${r.columns.map(c => {
          if (row[c] === null) return `<td class="null" data-cell="${i}" data-col="${esc(c)}" title="${canEdit ? 'Double-click to edit inline' : ''}">NULL</td>`;
          const fk = fkMap[c];
          const fkLink = fk ? ` <a href="#" class="crumb" data-fk-col="${esc(c)}" data-fk-val="${esc(row[c])}" title="Jump to ${esc(fk.ref_table)}.${esc(fk.ref_col)} = ${esc(row[c])}" style="font-size:11px;margin-left:4px">↗</a>` : '';
          return `<td data-cell="${i}" data-col="${esc(c)}" title="${esc(row[c])}${canEdit ? ' (Double-click to edit)' : ''}">${esc(row[c])}${fkLink}</td>`;
      }).join('')}</tr>`).join('')}</table></div>
      ${r.rows.length ? '' : '<div class="empty">No rows</div>'}`;
    $('#bs').onkeydown = e => { if (e.key === 'Enter') { B.search = e.target.value; B.page = 1; render(); } };
    $('#btf').onclick = () => { B.showFilterBar = !B.showFilterBar; render(); };
    if ($('#f-op')) {
        const syncOp = () => {
            B.draftCol = $('#f-col').value;
            B.draftOp = $('#f-op').value;
            $('#f-val').hidden = !opNeedsVal(B.draftOp);
        };
        $('#f-col').onchange = syncOp;
        $('#f-op').onchange = syncOp;
        const applyFilter = () => {
            const col = $('#f-col').value, op = $('#f-op').value, val = $('#f-val').value;
            if (!col) return;
            B.filters.push({ col, op, val: opNeedsVal(op) ? val : '' });
            B.draftVal = '';
            B.page = 1;
            render();
        };
        $('#f-add').onclick = applyFilter;
        $('#f-val').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); applyFilter(); } };
        $('#f-val').oninput = e => { B.draftVal = e.target.value; };
    }
    if ($('#f-clr')) $('#f-clr').onclick = () => { B.filters = []; B.search = ''; B.page = 1; render(); };
    C().querySelectorAll('[data-rmf]').forEach(a => a.onclick = e => { e.preventDefault(); B.filters.splice(+a.dataset.rmf, 1); B.page = 1; render(); });
    $('#bcsv').onclick = guard(() => exportCSV({ table: S.table, search: B.search, filters: B.filters, sort: B.sort, dir: B.dir, header: true, delimiter: ',' }));
    $('#pp').onclick = () => { B.page--; render(); }; $('#np').onclick = () => { B.page++; render(); };
    $('#per').onchange = e => { B.per = +e.target.value; B.page = 1; render(); };
    C().querySelectorAll('th[data-c]').forEach(th => th.onclick = () => { B.dir = B.sort === th.dataset.c && B.dir === 'asc' ? 'desc' : 'asc'; B.sort = th.dataset.c; render(); });
    const keyOf = row => {
        const useAll = r.key_type === 'all' || (r.key_type === 'unique' && keyCols.some(k => row[k] === null));
        return Object.fromEntries((useAll ? r.columns : keyCols).map(k => [k, row[k]]));
    };

    // Bulk row selection (with Shift-click range support) & bulk actions
    const rowChecks = [...C().querySelectorAll('.rchk')];
    let lastIdx = -1;
    const syncBulk = () => {
        const sel = rowChecks.filter(c => c.checked).map(c => +c.dataset.i);
        const bar = $('#bulk-bar');
        if (bar) {
            bar.hidden = sel.length === 0;
            $('#bulk-cnt').textContent = `${sel.length} selected`;
        }
        const sa = $('#sel-all');
        if (sa) {
            sa.checked = rowChecks.length > 0 && sel.length === rowChecks.length;
            sa.indeterminate = sel.length > 0 && sel.length < rowChecks.length;
        }
        return sel;
    };
    if ($('#sel-all')) {
        $('#sel-all').onchange = e => { rowChecks.forEach(c => { c.checked = e.target.checked; }); syncBulk(); };
    }
    rowChecks.forEach((chk, idx) => {
        chk.onclick = e => {
            if (e.shiftKey && lastIdx >= 0 && lastIdx !== idx) {
                const [from, to] = [Math.min(lastIdx, idx), Math.max(lastIdx, idx)];
                for (let k = from; k <= to; k++) rowChecks[k].checked = chk.checked;
            }
            lastIdx = idx;
            syncBulk();
        };
    });
    if ($('#bulk-csv')) {
        $('#bulk-csv').onclick = () => {
            const selRows = syncBulk().map(i => r.rows[i]);
            if (!selRows.length) return;
            const csv = '\uFEFF' + toCSV(r.columns, selRows.map(row => r.columns.map(c => row[c])));
            download(new Blob([csv], { type: 'text/csv' }), `${S.table}_selected.csv`);
            toast(`Exported ${selRows.length} row(s) to CSV`);
        };
    }
    if ($('#bulk-sql')) {
        $('#bulk-sql').onclick = () => {
            const selRows = syncBulk().map(i => r.rows[i]);
            if (!selRows.length) return;
            const qId = id => S.driver === 'mysql' ? '`' + id.replace(/`/g, '``') + '`' : '"' + id.replace(/"/g, '""') + '"';
            const qVal = v => v === null ? 'NULL' : "'" + String(v).replace(/'/g, "''") + "'";
            const T = (S.driver === 'mysql' ? qId(S.db) + '.' : '') + qId(S.table);
            const colList = r.columns.map(qId).join(', ');
            const vals = selRows.map(row => '(' + r.columns.map(c => qVal(row[c])).join(', ') + ')').join(',\n');
            const sql = `-- Fandejo Selected Rows Export (${selRows.length} rows)\nINSERT INTO ${T} (${colList}) VALUES\n${vals};\n`;
            download(new Blob([sql], { type: 'application/sql' }), `${S.table}_selected.sql`);
            toast(`Exported ${selRows.length} row(s) to SQL`);
        };
    }
    if ($('#bulk-edit')) {
        $('#bulk-edit').onclick = () => {
            const sel = syncBulk();
            if (!sel.length) return;
            openBulkEditModal(sel.map(i => r.rows[i]), r, keyOf);
        };
    }
    if ($('#bulk-del')) {
        $('#bulk-del').onclick = () => {
            const sel = syncBulk();
            if (!sel.length) return;
            confirmDo(`Delete ${sel.length} selected row(s) from ${S.table}?`, async () => {
                const res = await api('bulk_delete', { db: S.db, table: S.table, keys: sel.map(i => keyOf(r.rows[i])) });
                toast(`Deleted ${res.affected} row(s)`);
                render();
            });
        };
    }
    const jumpToFk = async (colName, val) => {
        const fk = fkMap[colName];
        if (!fk) return;
        S.fkBack ??= [];
        S.fkBack.push({
            db: S.db,
            table: S.table,
            viaCol: colName,
            viaVal: val,
            browse: JSON.parse(JSON.stringify(S.browse)),
        });
        const targetDb = fk.ref_db || S.db;
        if (targetDb !== S.db) {
            S.db = targetDb;
            await loadTables(S.db);
        }
        S.table = fk.ref_table;
        S.tab = 'browse';
        S.browse = { ...S.browse, page: 1, sort: '', search: '', filters: [{ col: fk.ref_col, op: '=', val }], showFilterBar: true };
        render();
    };
    if ($('#fk-back')) {
        $('#fk-back').onclick = guard(async () => {
            const prev = S.fkBack.pop();
            if (!prev) return;
            if (prev.db !== S.db) {
                S.db = prev.db;
                await loadTables(S.db);
            }
            S.table = prev.table;
            S.tab = 'browse';
            S.browse = prev.browse;
            render();
        });
    }
    C().querySelectorAll('[data-fk-col]').forEach(a => a.onclick = guard(async e => {
        e.preventDefault(); e.stopPropagation();
        await jumpToFk(a.dataset.fkCol, a.dataset.fkVal);
    }));
    C().querySelectorAll('[data-x]').forEach(b => b.onclick = () => confirmDo(r.key_type === 'all' ? 'Delete this row? (Table has no primary/unique key — matching all column values)' : 'Delete this row?', async () => { await api('delete', { db: S.db, table: S.table, key: keyOf(r.rows[b.dataset.x]) }); render(); }));
    C().querySelectorAll('[data-cp]').forEach(b => b.onclick = () => {
        const row = r.rows[b.dataset.cp];
        const meta = r.col_meta || {};
        modal(`<div style="width:min(600px,80vw)"><h3>⧉ Copy / Duplicate row</h3><p style="color:var(--mute);font-size:12px;margin-top:0">Pre-filled from selected row. Auto-increment primary keys are skipped by default so a new ID is assigned.</p>${r.columns.map(c => {
            const m = { ...(meta[c] || { base: 'VARCHAR' }), fk: fkMap[c] };
            const isAiPk = !!m.ai || (r.pk.length === 1 && r.pk.includes(c) && ['INT', 'INTEGER', 'BIGINT', 'SMALLINT', 'TINYINT', 'MEDIUMINT'].includes((m.base || '').toUpperCase()));
            return renderFieldInput(c, m, isAiPk ? '' : row[c], true, m.extra || (isAiPk ? 'auto_increment' : ''), isAiPk || row[c] === null);
        }).join('')}</div>`, async f => {
            const values = {};
            r.columns.forEach(c => {
                if (!f['s_' + c]) {
                    const base = (meta[c]?.base || '').toUpperCase();
                    let v = f['v_' + c];
                    if (['DATETIME', 'TIMESTAMP'].includes(base)) v = v.replace('T', ' ');
                    values[c] = v;
                }
            });
            await api('insert', { db: S.db, table: S.table, values });
            toast('Row duplicated');
            render();
        });
        wireFieldInputs($('#modal form'));
    });
    if (canEdit) {
        C().querySelectorAll('td[data-cell]').forEach(td => {
            td.ondblclick = () => {
                if (td.querySelector('.inl-wrap')) return;
                const rIdx = +td.dataset.cell, col = td.dataset.col;
                const row = r.rows[rIdx], m = (r.col_meta || {})[col] || { base: 'VARCHAR', null: true };
                const base = (m.base || '').toUpperCase();
                const origVal = row[col];
                const vStr = origVal === null ? '' : String(origVal);

                const wrap = document.createElement('div');
                wrap.className = 'row inl-wrap';
                wrap.style.gap = '4px';

                let inp;
                if (base === 'ENUM' && m.values?.length) {
                    inp = document.createElement('select');
                    inp.innerHTML = m.values.map(v => `<option ${v === vStr ? 'selected' : ''}>${esc(v)}</option>`).join('');
                } else {
                    inp = document.createElement('input');
                    inp.value = vStr;
                }
                inp.style.cssText = 'padding:3px 6px;min-width:90px;flex:1;font-family:var(--font-mono);font-size:12px';
                wrap.append(inp);

                let nullBtn = null;
                if (m.null) {
                    nullBtn = document.createElement('button');
                    nullBtn.type = 'button';
                    nullBtn.className = 'ghost';
                    nullBtn.style.cssText = 'padding:2px 6px;font-size:11px';
                    nullBtn.textContent = 'NULL';
                    nullBtn.title = 'Set column to NULL';
                    wrap.append(nullBtn);
                }

                td.classList.remove('null');
                td.innerHTML = '';
                td.append(wrap);
                inp.focus();
                if (inp.select) inp.select();

                let done = false;
                const restore = (val) => {
                    if (val === null) {
                        td.className = 'null';
                        td.textContent = 'NULL';
                    } else {
                        td.className = '';
                        const fk = fkMap[col];
                        const fkLink = fk ? ` <a href="#" class="crumb" data-fk-col="${esc(col)}" data-fk-val="${esc(val)}" title="Jump to ${esc(fk.ref_table)}.${esc(fk.ref_col)} = ${esc(val)}" style="font-size:11px;margin-left:4px">↗</a>` : '';
                        td.innerHTML = esc(val) + fkLink;
                        const a = td.querySelector('[data-fk-col]');
                        if (a) a.onclick = guard(async e => {
                            e.preventDefault(); e.stopPropagation();
                            await jumpToFk(a.dataset.fkCol, a.dataset.fkVal);
                        });
                        td.title = `${val} (Double-click to edit)`;
                    }
                };
                const commit = async (newVal) => {
                    if (done) return;
                    done = true;
                    if (newVal !== null && ['DATETIME', 'TIMESTAMP'].includes(base)) newVal = String(newVal).replace('T', ' ');
                    if (newVal === origVal || (newVal !== null && origVal !== null && String(newVal) === String(origVal))) {
                        return restore(origVal);
                    }
                    try {
                        const rowKey = keyOf(row);
                        await api('update', { db: S.db, table: S.table, key: rowKey, values: { [col]: newVal } });
                        row[col] = newVal;
                        restore(newVal);
                        toast(`Updated ${col}`);
                    } catch (e) {
                        restore(origVal);
                        toast(e.message, true);
                    }
                };
                const cancel = () => {
                    if (done) return;
                    done = true;
                    restore(origVal);
                };

                if (nullBtn) nullBtn.onmousedown = e => { e.preventDefault(); commit(null); };
                inp.onkeydown = e => {
                    if (e.key === 'Enter') { e.preventDefault(); commit(inp.value); }
                    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
                };
                if (inp.tagName === 'SELECT') inp.onchange = () => commit(inp.value);
                inp.onblur = () => commit(inp.value);
            };
        });
    }
    C().querySelectorAll('[data-e]').forEach(b => b.onclick = () => {
        const row = r.rows[b.dataset.e];
        const meta = r.col_meta || {};
        const warnHtml = r.key_type === 'all' ? `<div class="msg" style="margin-top:0">This table has no primary or unique key; matching row by all current column values${S.driver === 'mysql' ? ' (<code>LIMIT 1</code>)' : ''}.</div>` : '';
        modal(`<div style="width:min(600px,80vw)"><h3>Edit row</h3>${warnHtml}${r.columns.map(c => renderFieldInput(c, { ...(meta[c] || { base: 'VARCHAR' }), fk: fkMap[c] }, row[c], false)).join('')}</div>`, async f => {
            const values = {};
            r.columns.forEach(c => {
                const base = (meta[c]?.base || '').toUpperCase();
                let nv = f['n_' + c] ? null : f['v_' + c];
                if (nv !== null && ['DATETIME', 'TIMESTAMP'].includes(base)) nv = nv.replace('T', ' ');
                if (nv !== row[c] && String(nv) !== String(row[c])) values[c] = nv;
                else if (nv === null && row[c] !== null) values[c] = null;
            });
            if (!Object.keys(values).length) return;
            await api('update', { db: S.db, table: S.table, key: keyOf(row), values }); toast('Row updated'); render();
        });
        wireFieldInputs($('#modal form'));
    });
}

function nowISO(base) {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    const dt = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    const tm = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    if (base === 'DATE') return dt;
    if (base === 'TIME') return tm;
    if (base === 'YEAR') return String(d.getFullYear());
    return `${dt} ${tm}`;
}

function renderFieldInput(name, pt, val, isInsert = false, extra = '', hasDef = false, prefix = '') {
    const fn = prefix + name;
    const base = (pt?.base || '').toUpperCase();
    const isNull = val === null;
    const vStr = isNull ? '' : String(val ?? '');
    let inputHtml = '';
    if (base === 'DATE') {
        inputHtml = `<input name="v_${esc(fn)}" value="${esc(vStr.slice(0, 10))}" placeholder="YYYY-MM-DD" style="flex:1;font-family:ui-monospace,monospace">
          <button type="button" data-cal="${esc(fn)}" data-base="DATE" title="Open calendar picker">📅</button>
          <button type="button" class="ghost" data-now="${esc(fn)}" data-base="DATE" title="Fill today's date">Today</button>`;
    } else if (base === 'DATETIME' || base === 'TIMESTAMP') {
        const dtVal = vStr ? vStr.replace('T', ' ').slice(0, 19) : '';
        inputHtml = `<input name="v_${esc(fn)}" value="${esc(dtVal)}" placeholder="YYYY-MM-DD HH:MM:SS" style="flex:1;font-family:ui-monospace,monospace">
          <button type="button" data-cal="${esc(fn)}" data-base="${base}" title="Open date & time picker">📅</button>
          <button type="button" class="ghost" data-now="${esc(fn)}" data-base="${base}" title="Fill current date & time">Now</button>`;
    } else if (base === 'TIME') {
        inputHtml = `<input type="time" step="1" name="v_${esc(fn)}" value="${esc(vStr.slice(0, 8))}" style="flex:1">
          <button type="button" class="ghost" data-now="${esc(fn)}" data-base="TIME" title="Fill current time">Now</button>`;
    } else if (base === 'YEAR') {
        inputHtml = `<input type="number" min="1901" max="2155" placeholder="YYYY" name="v_${esc(fn)}" value="${esc(vStr)}" style="flex:1">
          <button type="button" class="ghost" data-now="${esc(fn)}" data-base="YEAR">This year</button>`;
    } else if (base === 'ENUM' && pt.values?.length) {
        inputHtml = `<select name="v_${esc(fn)}" style="flex:1">${pt.values.map(v => `<option ${v === vStr ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
    } else if (['TEXT', 'MEDIUMTEXT', 'LONGTEXT', 'JSON'].includes(base)) {
        inputHtml = `<textarea name="v_${esc(fn)}" rows="2" style="flex:1">${esc(vStr)}</textarea>`;
    } else {
        inputHtml = `<input name="v_${esc(fn)}" value="${esc(vStr)}" style="flex:1">`;
    }
    const fkBtn = pt?.fk
        ? `<button type="button" data-fk-pick="${esc(fn)}" data-ref-db="${esc(pt.fk.ref_db || S.db)}" data-ref-tb="${esc(pt.fk.ref_table)}" data-ref-col="${esc(pt.fk.ref_col)}" title="Pick value from ${esc(pt.fk.ref_table)}.${esc(pt.fk.ref_col)}">🔗 Pick</button>`
        : '';
    const toggleBox = isInsert
        ? `<label style="flex-direction:row;gap:4px"><input type="checkbox" name="s_${esc(fn)}" ${/auto_?increment|rowid auto/i.test(extra) || hasDef ? 'checked' : ''}>skip / default</label>`
        : `<label style="flex-direction:row;gap:4px"><input type="checkbox" name="n_${esc(fn)}" ${isNull ? 'checked' : ''}>NULL</label>`;
    const fkBadge = pt?.fk ? ` <span style="color:var(--cyan)" title="Foreign key">→ ${esc(pt.fk.ref_table)}.${esc(pt.fk.ref_col)}</span>` : '';
    return `<label><span>${esc(name)} <small style="color:var(--mute)">${esc(pt?.raw_type || base)} ${esc(extra)}${fkBadge}</small></span><div class="row" style="position:relative">${inputHtml}${fkBtn}${toggleBox}</div></label>`;
}

function openBulkEditModal(selRows, r, keyOf) {
    const meta = r.col_meta || {};
    const fkMap = r.fks || {};
    const rowLabel = (row, idx) => {
        const k = keyOf(row);
        const parts = Object.entries(k).filter(([c]) => c !== '__rowid__').slice(0, 3).map(([c, v]) => `${c}=${v ?? 'NULL'}`);
        return parts.length ? `Row #${idx + 1} (${parts.join(', ')})` : `Row #${idx + 1}`;
    };

    modal(`<div style="width:min(680px,85vw)">
      <h3>Edit ${selRows.length} selected row(s)</h3>
      <div style="display:flex;flex-direction:column;gap:12px">
        ${selRows.map((row, idx) => `<fieldset class="pg" style="margin:0"><legend><b>${esc(rowLabel(row, idx))}</b></legend>
          <div class="form">${r.columns.map(c => renderFieldInput(c, { ...(meta[c] || { base: 'VARCHAR' }), fk: fkMap[c] }, row[c], false, '', false, `r${idx}_`)).join('')}</div>
        </fieldset>`).join('')}
      </div>
    </div>`, async f => {
        const updates = [];
        selRows.forEach((row, idx) => {
            const values = {};
            r.columns.forEach(c => {
                const pfx = `r${idx}_${c}`;
                const base = (meta[c]?.base || '').toUpperCase();
                let nv = f['n_' + pfx] ? null : f['v_' + pfx];
                if (nv !== null && ['DATETIME', 'TIMESTAMP'].includes(base)) nv = nv.replace('T', ' ');
                if (nv !== row[c] && String(nv) !== String(row[c])) values[c] = nv;
                else if (nv === null && row[c] !== null) values[c] = null;
            });
            if (Object.keys(values).length) updates.push({ key: keyOf(row), values });
        });
        if (!updates.length) return;
        const res = await api('bulk_update', { db: S.db, table: S.table, updates });
        toast(`Updated ${res.affected} row(s)`);
        render();
    });

    wireFieldInputs($('#modal form'));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
let activeCal = null;
function closeCal() { if (activeCal) { activeCal.remove(); activeCal = null; } }
document.addEventListener('mousedown', e => { if (activeCal && !activeCal.contains(e.target) && !e.target.closest('[data-cal],[data-fk-pick]')) closeCal(); });

function openCalPicker(btn, inp, withTime, onPick) {
    if (activeCal && activeCal._inp === inp) return closeCal();
    closeCal();
    const now = new Date(), pad = n => String(n).padStart(2, '0');
    const m = String(inp.value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    let yr = m ? +m[1] : now.getFullYear(), mo = m ? +m[2] - 1 : now.getMonth(), dy = m ? +m[3] : now.getDate();
    let hr = m && m[4] ? +m[4] : now.getHours(), mn = m && m[5] ? +m[5] : now.getMinutes(), sc = m && m[6] ? +m[6] : now.getSeconds();
    if (yr < 1900 || yr > 2100) yr = now.getFullYear();

    const pop = document.createElement('div');
    pop.className = 'cal-pop';
    pop._inp = inp;
    activeCal = pop;

    const commit = (closeAfter = true) => {
        const maxD = new Date(yr, mo + 1, 0).getDate();
        if (dy > maxD) dy = maxD;
        const dateStr = `${yr}-${pad(mo + 1)}-${pad(dy)}`;
        inp.value = withTime ? `${dateStr} ${pad(hr)}:${pad(mn)}:${pad(sc)}` : dateStr;
        onPick();
        if (closeAfter) closeCal(); else drawGrid();
    };

    const years = [];
    for (let y = now.getFullYear() + 15; y >= 1900; y--) years.push(y);

    pop.innerHTML = `<div class="cal-head">
        <button type="button" class="ghost" data-nav="-1" title="Previous month">‹</button>
        <select class="cal-mo">${MONTHS.map((n, i) => `<option value="${i}" ${i === mo ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <select class="cal-yr">${years.map(y => `<option value="${y}" ${y === yr ? 'selected' : ''}>${y}</option>`).join('')}</select>
        <button type="button" class="ghost" data-nav="1" title="Next month">›</button>
      </div>
      <div class="cal-dow">${['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => `<span>${d}</span>`).join('')}</div>
      <div class="cal-grid"></div>
      ${withTime ? `<div class="cal-time">
        <span>Time</span>
        <input type="number" min="0" max="23" class="cal-h" value="${pad(hr)}">:
        <input type="number" min="0" max="59" class="cal-m" value="${pad(mn)}">:
        <input type="number" min="0" max="59" class="cal-s" value="${pad(sc)}">
        <button type="button" class="primary cal-ok" style="margin-left:auto;padding:4px 10px">Set</button>
      </div>` : ''}`;

    const moSel = pop.querySelector('.cal-mo'), yrSel = pop.querySelector('.cal-yr'), grid = pop.querySelector('.cal-grid');

    const drawGrid = () => {
        moSel.value = String(mo); yrSel.value = String(yr);
        const firstDow = new Date(yr, mo, 1).getDay();
        const daysInMo = new Date(yr, mo + 1, 0).getDate();
        const prevDays = new Date(yr, mo, 0).getDate();
        let html = '';
        for (let i = firstDow - 1; i >= 0; i--) html += `<button type="button" class="cal-day mute" data-pm="-1" data-d="${prevDays - i}">${prevDays - i}</button>`;
        for (let d = 1; d <= daysInMo; d++) {
            const isToday = yr === now.getFullYear() && mo === now.getMonth() && d === now.getDate();
            html += `<button type="button" class="cal-day ${d === dy ? 'sel' : ''} ${isToday ? 'today' : ''}" data-pm="0" data-d="${d}">${d}</button>`;
        }
        const total = firstDow + daysInMo, rem = (7 - (total % 7)) % 7;
        for (let d = 1; d <= rem; d++) html += `<button type="button" class="cal-day mute" data-pm="1" data-d="${d}">${d}</button>`;
        grid.innerHTML = html;
        grid.querySelectorAll('.cal-day').forEach(b => b.onclick = () => {
            const pm = +b.dataset.pm;
            if (pm !== 0) { mo += pm; if (mo < 0) { mo = 11; yr--; } else if (mo > 11) { mo = 0; yr++; } }
            dy = +b.dataset.d;
            commit(!withTime);
        });
    };

    moSel.onchange = () => { mo = +moSel.value; drawGrid(); };
    yrSel.onchange = () => { yr = +yrSel.value; drawGrid(); };
    pop.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => {
        mo += +b.dataset.nav;
        if (mo < 0) { mo = 11; yr--; } else if (mo > 11) { mo = 0; yr++; }
        drawGrid();
    });
    if (withTime) {
        const syncT = () => {
            hr = Math.min(23, Math.max(0, +pop.querySelector('.cal-h').value || 0));
            mn = Math.min(59, Math.max(0, +pop.querySelector('.cal-m').value || 0));
            sc = Math.min(59, Math.max(0, +pop.querySelector('.cal-s').value || 0));
        };
        pop.querySelectorAll('.cal-time input').forEach(i => i.oninput = syncT);
        pop.querySelector('.cal-ok').onclick = () => { syncT(); commit(true); };
    }

    drawGrid();
    btn.parentElement.appendChild(pop);
}

function openFkPicker(btn, inp, onPick) {
    if (activeCal && activeCal._inp === inp) return closeCal();
    closeCal();
    const refDb = btn.dataset.refDb || S.db, refTb = btn.dataset.refTb, refCol = btn.dataset.refCol;
    const pop = document.createElement('div');
    pop.className = 'cal-pop';
    pop.style.width = '340px';
    pop._inp = inp;
    activeCal = pop;

    pop.innerHTML = `<div class="bar" style="margin-bottom:6px">
        <b style="font-size:12px">🔗 ${esc(refTb)}.${esc(refCol)}</b>
        <span class="spacer"></span>
        <button type="button" class="ghost" id="fk-x" style="padding:2px 6px">✕</button>
      </div>
      <input id="fk-q" placeholder="Search ${esc(refTb)}…" style="width:100%;margin-bottom:6px;font-size:12px;padding:5px 8px">
      <div id="fk-list" style="max-height:210px;overflow:auto;display:flex;flex-direction:column;gap:3px"><div class="empty" style="padding:12px">Loading…</div></div>`;

    btn.parentElement.appendChild(pop);
    pop.querySelector('#fk-x').onclick = closeCal;
    const qInp = pop.querySelector('#fk-q'), listEl = pop.querySelector('#fk-list');
    qInp.focus();

    let timer;
    const loadItems = async (q = '') => {
        try {
            const res = await api('fk_lookup', { db: S.db, ref_db: refDb, ref_table: refTb, ref_col: refCol, q });
            if (!res.items.length) {
                listEl.innerHTML = `<div class="empty" style="padding:12px">No matching rows in ${esc(refTb)}</div>`;
                return;
            }
            listEl.innerHTML = res.items.map(it => `<button type="button" class="ghost" data-fkv="${esc(it.val)}" style="text-align:left;display:flex;justify-content:space-between;gap:8px;padding:5px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg)">
              <b style="color:var(--accent);font-family:var(--font-mono)">${esc(it.val)}</b>
              <span style="color:var(--mute);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">${esc(it.label)}</span>
            </button>`).join('');
            listEl.querySelectorAll('[data-fkv]').forEach(b => b.onclick = () => {
                inp.value = b.dataset.fkv;
                onPick();
                closeCal();
            });
        } catch (e) {
            listEl.innerHTML = `<div class="msg err">${esc(e.message)}</div>`;
        }
    };
    qInp.oninput = () => { clearTimeout(timer); timer = setTimeout(() => loadItems(qInp.value), 160); };
    loadItems();
}

function wireFieldInputs(root) {
    root.querySelectorAll('[data-now]').forEach(b => b.onclick = () => {
        const inp = root.elements['v_' + b.dataset.now];
        if (inp) {
            inp.value = nowISO(b.dataset.base);
            const chk = root.elements['n_' + b.dataset.now] || root.elements['s_' + b.dataset.now];
            if (chk) chk.checked = false;
        }
    });
    root.querySelectorAll('[data-cal]').forEach(b => b.onclick = () => {
        const col = b.dataset.cal, inp = root.elements['v_' + col];
        if (!inp) return;
        openCalPicker(b, inp, ['DATETIME', 'TIMESTAMP'].includes(b.dataset.base), () => {
            const chk = root.elements['n_' + col] || root.elements['s_' + col];
            if (chk) chk.checked = false;
        });
    });
    root.querySelectorAll('[data-fk-pick]').forEach(b => b.onclick = () => {
        const col = b.dataset.fkPick, inp = root.elements['v_' + col];
        if (!inp) return;
        openFkPicker(b, inp, () => {
            const chk = root.elements['n_' + col] || root.elements['s_' + col];
            if (chk) chk.checked = false;
        });
    });
    root.querySelectorAll('input[name^="v_"],textarea[name^="v_"],select[name^="v_"]').forEach(inp => {
        inp.addEventListener('input', () => {
            const col = inp.name.slice(2);
            const chk = root.elements['n_' + col] || root.elements['s_' + col];
            if (chk && inp.value !== '') chk.checked = false;
        });
    });
}

const TYPE_GROUPS = [
    ['Integer', ['TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'INTEGER', 'BIGINT']], ['Decimal', ['DECIMAL', 'FLOAT', 'DOUBLE', 'REAL', 'NUMERIC']],
    ['Text', ['CHAR', 'VARCHAR', 'TINYTEXT', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT', 'ENUM', 'SET', 'JSON']],
    ['Date & time', ['DATE', 'TIME', 'DATETIME', 'TIMESTAMP', 'YEAR']], ['Binary', ['BINARY', 'VARBINARY', 'TINYBLOB', 'BLOB', 'MEDIUMBLOB', 'LONGBLOB', 'BIT', 'BOOLEAN']],
];
const SQLITE_UNSUPPORTED_TYPES = ['ENUM', 'SET', 'YEAR', 'BIT', 'MEDIUMINT', 'TINYTEXT', 'MEDIUMTEXT', 'LONGTEXT', 'TINYBLOB', 'MEDIUMBLOB', 'LONGBLOB'];
const typeGroupsForDriver = () => S.driver === 'sqlite'
    ? TYPE_GROUPS.map(([g, l]) => [g, l.filter(t => !SQLITE_UNSUPPORTED_TYPES.includes(t))])
    : TYPE_GROUPS;
const T_INT = ['TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'INTEGER', 'BIGINT'], T_NUM = [...T_INT, 'DECIMAL', 'FLOAT', 'DOUBLE', 'REAL', 'NUMERIC'], T_TEXT = ['CHAR', 'VARCHAR', 'TINYTEXT', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT', 'ENUM', 'SET'];
const T_LEN = ['TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'BIGINT', 'DECIMAL', 'FLOAT', 'DOUBLE', 'CHAR', 'VARCHAR', 'BINARY', 'VARBINARY', 'BIT', 'DATETIME', 'TIMESTAMP', 'TIME'];
const COLLATIONS = ['utf8mb4_unicode_ci', 'utf8mb4_general_ci', 'utf8mb4_bin', 'utf8mb4_0900_ai_ci', 'utf8mb3_general_ci', 'latin1_swedish_ci', 'latin1_general_ci'];

async function structure() {
    const [r, ix, fk, tr] = await Promise.all([
        api('structure', { db: S.db, table: S.table }),
        api('indexes', { db: S.db, table: S.table }),
        api('foreign_keys', { db: S.db, table: S.table }),
        api('triggers', { db: S.db, table: S.table }).catch(() => ({ triggers: [] })),
    ]);
    const my = S.driver === 'mysql';
    const isView = !!r.is_view;
    const isSingleCol = r.columns.length <= 1;
    C().innerHTML = `${isView ? `<div class="bar"><span class="badge">👁 SQL View</span><button class="primary" id="ev-btn">✎ Edit View Definition</button></div>` : `<div class="bar"><button class="primary" id="ac">+ Add column</button></div>`}
    <div class="tw"><table><tr><th>#</th><th>Name</th><th>Type</th><th>Null</th><th>Key</th><th>Default</th><th>Extra</th>${my ? '<th>Comment</th>' : ''}${!isView ? '<th></th>' : ''}</tr>${r.columns.map((c, i) => {
        const cantDropSqlite = !my && (c.key === 'PRI' || isSingleCol);
        const dropTitle = !my && c.key === 'PRI' ? 'SQLite cannot drop a PRIMARY KEY column without rebuilding the table' : (isSingleCol ? 'Cannot drop the only column in a table' : '');
        return `<tr><td>${i + 1}</td><td><b>${c.key === 'PRI' ? '<span class="pk">🔑</span> ' : ''}${esc(c.name)}</b></td><td>${esc(c.type)}</td><td>${c.null ? 'YES' : 'NO'}</td><td>${esc(c.key)}</td><td>${c.def.mode === 'null' ? '<i>NULL</i>' : c.def.mode === 'none' ? '<i style="color:var(--mute)">none</i>' : esc(c.def.value)}</td><td>${esc(c.extra)}</td>${my ? `<td>${esc(c.comment)}</td>` : ''}${!isView ? `<td class="act"><button class="ghost" data-ec="${i}">${my ? 'Edit' : 'Rename'}</button><button class="danger ghost" data-dc="${esc(c.name)}" ${cantDropSqlite ? `disabled title="${esc(dropTitle)}"` : ''}>Drop</button></td>` : ''}</tr>`;
    }).join('')}</table></div>
    ${!isView ? `<div class="bar" style="margin-top:22px"><h3 style="margin:0">Indexes</h3><span class="spacer"></span><button id="ai">+ Add index</button></div>
    ${ix.indexes.length ? `<div class="tw"><table><tr><th>Name</th><th>Type</th><th>Columns</th><th>Method</th><th>Cardinality</th><th></th></tr>${ix.indexes.map((i, n) => `<tr><td><b>${esc(i.name)}</b></td><td><span class="lvl lvl-${i.type === 'PRIMARY' ? 'global' : i.type === 'UNIQUE' ? 'table' : 'database'}">${i.type}</span></td><td>${i.columns.map(c => `<span class="chip">${esc(c.name)}${c.length ? `(${esc(c.length)})` : ''}${c.desc ? ' ↓' : ''}</span>`).join(' ')}</td><td>${esc(i.method)}</td><td>${esc(i.cardinality ?? '–')}</td><td class="act">${i.droppable ? `<button class="danger ghost" data-di="${n}">Drop</button>` : ''}</td></tr>`).join('')}</table></div>` : '<div class="empty">No indexes</div>'}
    <div class="bar" style="margin-top:22px"><h3 style="margin:0">Foreign keys</h3><span class="spacer"></span><button id="af" ${fk.supported ? '' : 'disabled title="SQLite foreign keys can only be defined at CREATE TABLE time"'}>+ Add foreign key</button></div>
    ${fk.foreign_keys.length ? `<div class="tw"><table><tr><th>Name</th><th>Columns</th><th>References</th><th>On delete</th><th>On update</th><th></th></tr>${fk.foreign_keys.map((f, n) => `<tr><td><b>${esc(f.name)}</b></td><td>${f.pairs.map(x => `<span class="chip">${esc(x.col)}</span>`).join(' ')}</td><td>${esc((f.ref_db && f.ref_db !== S.db ? f.ref_db + '.' : '') + f.ref_table)} (${f.pairs.map(x => esc(x.ref)).join(', ')})</td><td>${esc(f.on_delete)}</td><td>${esc(f.on_update)}</td><td class="act">${f.droppable ? `<button class="danger ghost" data-df="${n}">Drop</button>` : ''}</td></tr>`).join('')}</table></div>` : '<div class="empty">No foreign keys</div>'}` : ''}
    <div class="bar" style="margin-top:22px"><h3 style="margin:0">Triggers</h3><span class="spacer"></span><button id="atr">+ Add trigger</button></div>
    ${(tr.triggers || []).length ? `<div class="tw"><table><tr><th>Name</th><th>Timing</th><th>Event</th><th>Statement / Body</th><th></th></tr>${tr.triggers.map((t, n) => `<tr><td><b>${esc(t.name)}</b></td><td><span class="badge">${esc(t.timing)}</span></td><td><span class="lvl lvl-database">${esc(t.event)}</span></td><td><code style="font-size:12px">${esc(t.body)}</code></td><td class="act"><button class="danger ghost" data-dtr="${n}">Drop</button></td></tr>`).join('')}</table></div>` : '<div class="empty">No triggers on this ' + (isView ? 'view' : 'table') + '</div>'}
    <h3>CREATE statement</h3><pre>${esc(r.create)}</pre>`;
    if ($('#ev-btn')) $('#ev-btn').onclick = () => viewEditor({ name: S.table, select: r.view_select || r.create });
    C().querySelectorAll('[data-dc]:not([disabled])').forEach(b => b.onclick = () => confirmDo(`Drop column ${b.dataset.dc}? Its data will be lost.`, async () => { await api('drop_column', { db: S.db, table: S.table, column: b.dataset.dc }); render(); }));
    C().querySelectorAll('[data-ec]').forEach(b => b.onclick = () => columnEditor(r.columns, r.columns[b.dataset.ec]));
    if ($('#ac')) $('#ac').onclick = () => columnEditor(r.columns, null);
    if ($('#ai')) $('#ai').onclick = () => indexEditor(r.columns);
    if ($('#af') && fk.supported) $('#af').onclick = () => fkEditor(r.columns);
    if ($('#atr')) $('#atr').onclick = () => triggerEditor(S.table, isView);
    C().querySelectorAll('[data-di]').forEach(b => b.onclick = () => { const i = ix.indexes[b.dataset.di]; confirmDo(`Drop ${i.type === 'PRIMARY' ? 'the primary key' : 'index ' + i.name}?`, async () => { await api('drop_index', { db: S.db, table: S.table, name: i.name }); toast('Index dropped'); render(); }); });
    C().querySelectorAll('[data-df]').forEach(b => b.onclick = () => { const f = fk.foreign_keys[b.dataset.df]; confirmDo(`Drop foreign key ${f.name}?`, async () => { await api('drop_fk', { db: S.db, table: S.table, name: f.name }); toast('Foreign key dropped'); render(); }); });
    C().querySelectorAll('[data-dtr]').forEach(b => b.onclick = () => { const t = tr.triggers[b.dataset.dtr]; confirmDo(`Drop trigger ${t.name}?`, async () => { await api('drop_trigger', { db: S.db, name: t.name }); toast('Trigger dropped'); render(); }); });
}

function viewEditor(existing = null) {
    const isEdit = !!existing;
    const defName = existing?.name || '';
    const defSel = existing?.select || (S.tables[S.db]?.[0] ? `SELECT * FROM ${S.driver === 'mysql' ? '`' + S.tables[S.db][0].name + '`' : '"' + S.tables[S.db][0].name + '"'}` : 'SELECT 1 AS id');
    modal(`<div style="width:min(660px,85vw)"><h3>${isEdit ? '✎ Edit View ' + esc(defName) : '👁 New SQL View'}</h3>
      <label>View Name<input name="name" value="${esc(defName)}" placeholder="v_active_users" required autofocus></label>
      <label><span>SELECT Query (without <code>CREATE VIEW … AS</code> prefix)</span>
        <textarea name="select" class="editor" style="height:140px" required>${esc(defSel)}</textarea>
      </label>
      <div class="sqlprev"><small>SQL preview</small><pre id="prev">…</pre></div></div>`, async f => {
        const res = await api('save_view', { db: S.db, name: f.name, select: f.select, old_name: isEdit ? defName : '', replace: isEdit });
        await loadTables(S.db);
        if (S.table) S.table = res.name;
        toast(isEdit ? 'View updated' : 'View created');
        render();
    });
    const form = $('#modal form');
    let t;
    const preview = () => {
        clearTimeout(t);
        t = setTimeout(async () => {
            try {
                const res = await api('save_view', { db: S.db, name: form.name.value, select: form.select.value, old_name: isEdit ? defName : '', replace: isEdit, dry: true });
                $('#prev').textContent = res.sql + ';';
            } catch (e) { $('#prev').textContent = '-- ' + e.message; }
        }, 150);
    };
    form.addEventListener('input', preview);
    preview();
}

function triggerEditor(defaultTable = '', isView = false) {
    const my = S.driver === 'mysql';
    const tbls = S.tables[S.db] || [];
    const timings = !my && isView ? ['INSTEAD OF'] : (my ? ['BEFORE', 'AFTER'] : ['BEFORE', 'AFTER', 'INSTEAD OF']);
    modal(`<div style="width:min(660px,85vw)"><h3>⚡ New Trigger</h3>
      <div class="ce-grid">
        <label>Trigger Name<input name="name" placeholder="trg_${esc(defaultTable || 'table')}_after_insert" required autofocus></label>
        <label>Target Table${!my ? ' / View' : ''}<select name="table">${tbls.map(t => `<option value="${esc(t.name)}" ${t.name === defaultTable ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
        <label>Timing<select name="timing">${timings.map(tm => `<option>${tm}</option>`).join('')}</select></label>
        <label>Event<select name="event"><option>INSERT</option><option>UPDATE</option><option>DELETE</option></select></label>
      </div>
      <label><span>Trigger Body (executed <code>FOR EACH ROW</code> inside <code>BEGIN … END</code>; reference <code>NEW.col</code> / <code>OLD.col</code>)</span>
        <textarea name="body" class="editor" style="height:120px" placeholder="SET NEW.updated_at = CURRENT_TIMESTAMP;" required></textarea>
      </label>
      <div class="sqlprev"><small>SQL preview</small><pre id="prev">…</pre></div></div>`, async f => {
        await api('create_trigger', { db: S.db, ...f });
        toast('Trigger created');
        render();
    });
    const form = $('#modal form');
    const body = () => ({ db: S.db, name: form.name.value, table: form.table.value, timing: form.timing.value, event: form.event.value, body: form.body.value });
    let t;
    const preview = () => {
        clearTimeout(t);
        t = setTimeout(async () => {
            try { $('#prev').textContent = (await api('create_trigger', { ...body(), dry: true })).sql + ';'; }
            catch (e) { $('#prev').textContent = '-- ' + e.message; }
        }, 150);
    };
    form.addEventListener('input', preview); form.addEventListener('change', preview);
    preview();
}

function routineEditor(existing = null) {
    const r = existing || { type: 'PROCEDURE', name: '', params: '', returns: 'INT', deterministic: false, body: 'SELECT 1;' };
    modal(`<div style="width:min(680px,85vw)"><h3>⚙ ${existing ? 'Edit ' + r.type + ' ' + esc(r.name) : 'New Stored Procedure / Function'}</h3>
      <div class="ce-grid">
        <label>Type<select name="type"><option value="PROCEDURE" ${r.type === 'PROCEDURE' ? 'selected' : ''}>PROCEDURE</option><option value="FUNCTION" ${r.type === 'FUNCTION' ? 'selected' : ''}>FUNCTION</option></select></label>
        <label>Name<input name="name" value="${esc(r.name)}" placeholder="sp_recalc_totals" required autofocus></label>
        <label>Parameters<input name="params" value="${esc(r.params || '')}" placeholder="IN user_id INT, OUT total DECIMAL(10,2)"></label>
        <label id="rt-ret" ${r.type === 'FUNCTION' ? '' : 'hidden'}>Returns Type<input name="returns" value="${esc(r.returns || 'INT')}" placeholder="INT or VARCHAR(255)"></label>
      </div>
      <label class="pc"><input type="checkbox" name="deterministic" ${r.deterministic ? 'checked' : ''}><span>DETERMINISTIC</span><small>Always produces the same result for the same input parameters</small></label>
      <label><span>Routine Body (wrapped in <code>BEGIN … END</code> automatically if omitted)</span>
        <textarea name="body" class="editor" style="height:140px" required>${esc(r.body || '')}</textarea>
      </label>
      <div class="sqlprev"><small>SQL preview</small><pre id="prev">…</pre></div></div>`, async f => {
        await api('create_routine', { db: S.db, ...f, deterministic: !!f.deterministic, replace: !!existing });
        toast('Routine saved');
        render();
    });
    const form = $('#modal form');
    const sync = () => { $('#rt-ret').hidden = form.type.value !== 'FUNCTION'; };
    const body = () => ({ db: S.db, type: form.type.value, name: form.name.value, params: form.params.value, returns: form.returns.value, deterministic: form.deterministic.checked, body: form.body.value });
    let t;
    const preview = () => {
        sync();
        clearTimeout(t);
        t = setTimeout(async () => {
            try { $('#prev').textContent = (await api('create_routine', { ...body(), dry: true })).sql + ';'; }
            catch (e) { $('#prev').textContent = '-- ' + e.message; }
        }, 150);
    };
    form.addEventListener('input', preview); form.addEventListener('change', preview);
    preview();
}

async function dbObjectsView() {
    const my = S.driver === 'mysql';
    const [trRes, rtRes] = await Promise.all([
        api('triggers', { db: S.db }).catch(() => ({ triggers: [] })),
        my ? api('routines', { db: S.db }).catch(() => ({ routines: [], events: [] })) : Promise.resolve({ routines: [], events: [] }),
    ]);
    const views = (S.tables[S.db] || []).filter(t => t.type?.includes('VIEW') || t.type === 'view');
    const trigs = trRes.triggers || [];
    const routs = rtRes.routines || [];
    const evts = rtRes.events || [];

    C().innerHTML = `<div class="bar"><h3 style="margin:0">👁 Views (${views.length})</h3><span class="spacer"></span><button class="primary" id="do-nv">+ New View</button></div>
      ${views.length ? `<div class="tw"><table><tr><th>View Name</th><th>Actions</th></tr>${views.map(v => `<tr><td><a href="#" data-vw="${esc(v.name)}" style="color:var(--accent)"><b>👁 ${esc(v.name)}</b></a></td><td class="act"><button class="ghost" data-evw="${esc(v.name)}">✎ Edit</button><button class="ghost danger" data-dvw="${esc(v.name)}">Drop</button></td></tr>`).join('')}</table></div>` : '<div class="empty" style="padding:18px">No views in this database</div>'}

      <div class="bar" style="margin-top:22px"><h3 style="margin:0">⚡ Triggers (${trigs.length})</h3><span class="spacer"></span><button class="primary" id="do-ntr">+ New Trigger</button></div>
      ${trigs.length ? `<div class="tw"><table><tr><th>Trigger</th><th>Table</th><th>Timing</th><th>Event</th><th>Body</th><th></th></tr>${trigs.map((t, i) => `<tr><td><b>${esc(t.name)}</b></td><td><a href="#" data-ttb="${esc(t.table)}" class="crumb">${esc(t.table)}</a></td><td><span class="badge">${esc(t.timing)}</span></td><td><span class="lvl lvl-database">${esc(t.event)}</span></td><td><code style="font-size:12px">${esc(t.body)}</code></td><td class="act"><button class="ghost danger" data-dtr="${i}">Drop</button></td></tr>`).join('')}</table></div>` : '<div class="empty" style="padding:18px">No triggers in this database</div>'}

      ${my ? `<div class="bar" style="margin-top:22px"><h3 style="margin:0">⚙ Stored Procedures & Functions (${routs.length})</h3><span class="spacer"></span><button class="primary" id="do-nrt">+ New Routine</button></div>
      ${routs.length ? `<div class="tw"><table><tr><th>Name</th><th>Type</th><th>Returns</th><th>Definition</th><th></th></tr>${routs.map((r, i) => `<tr><td><b>${esc(r.name)}</b></td><td><span class="lvl lvl-${r.type === 'FUNCTION' ? 'table' : 'database'}">${esc(r.type)}</span></td><td><code>${esc(r.returns || '–')}</code></td><td><code style="font-size:12px">${esc(r.body || r.sql)}</code></td><td class="act"><button class="ghost" data-rrun="${i}">▶ Call</button><button class="ghost danger" data-drt="${i}">Drop</button></td></tr>`).join('')}</table></div>` : '<div class="empty" style="padding:18px">No stored procedures or functions in this database</div>'}

      ${evts.length ? `<div class="bar" style="margin-top:22px"><h3 style="margin:0">⏱ Scheduled Events (${evts.length})</h3></div>
      <div class="tw"><table><tr><th>Event</th><th>Type</th><th>Schedule</th><th>Status</th><th>Definition</th></tr>${evts.map(e => `<tr><td><b>${esc(e.name)}</b></td><td>${esc(e.type)}</td><td>${esc(e.execute_at || ('EVERY ' + (e.interval_val || '') + ' ' + (e.interval_field || '')))}</td><td><span class="badge">${esc(e.status)}</span></td><td><code style="font-size:12px">${esc(e.body)}</code></td></tr>`).join('')}</table></div>` : ''}` : ''}`;

    $('#do-nv').onclick = () => viewEditor();
    $('#do-ntr').onclick = () => triggerEditor(S.tables[S.db]?.[0]?.name || '');
    if ($('#do-nrt')) $('#do-nrt').onclick = () => routineEditor();
    C().querySelectorAll('[data-vw]').forEach(a => a.onclick = e => { e.preventDefault(); S.table = a.dataset.vw; S.tab = 'browse'; render(); });
    C().querySelectorAll('[data-ttb]').forEach(a => a.onclick = e => { e.preventDefault(); S.table = a.dataset.ttb; S.tab = 'structure'; render(); });
    C().querySelectorAll('[data-evw]').forEach(b => b.onclick = guard(async () => {
        const st = await api('structure', { db: S.db, table: b.dataset.evw });
        viewEditor({ name: b.dataset.evw, select: st.view_select || st.create });
    }));
    C().querySelectorAll('[data-dvw]').forEach(b => b.onclick = () => confirmDo(`Drop view ${b.dataset.dvw}?`, async () => { await api('drop_table', { db: S.db, table: b.dataset.dvw }); await loadTables(S.db); render(); }));
    C().querySelectorAll('[data-dtr]').forEach(b => b.onclick = () => { const t = trigs[b.dataset.dtr]; confirmDo(`Drop trigger ${t.name}?`, async () => { await api('drop_trigger', { db: S.db, name: t.name }); toast('Trigger dropped'); render(); }); });
    C().querySelectorAll('[data-drt]').forEach(b => b.onclick = () => { const r = routs[b.dataset.drt]; confirmDo(`Drop ${r.type} ${r.name}?`, async () => { await api('drop_routine', { db: S.db, type: r.type, name: r.name }); toast('Routine dropped'); render(); }); });
    C().querySelectorAll('[data-rrun]').forEach(b => b.onclick = () => {
        const r = routs[b.dataset.rrun];
        S.sql = r.type === 'FUNCTION' ? `SELECT \`${r.name}\`();` : `CALL \`${r.name}\`();`;
        S.tab = 'sql';
        render();
    });
}

/* Reusable repeating-row list: rows built by rowHtml(i), "+" adds, "✕" removes. */
function rowList(host, rowHtml, onChange, initial = 1) {
    const add = () => { const d = document.createElement('div'); d.className = 'rl-row'; d.innerHTML = rowHtml() + '<button type="button" class="ghost danger" title="Remove">✕</button>'; d.querySelector('button').onclick = () => { if (host.children.length > 1) { d.remove(); onChange(); } }; host.append(d); };
    for (let i = 0; i < initial; i++) add();
    return { add: () => { add(); onChange(); }, rows: () => [...host.children] };
}
const colOptions = (cols, sel = '') => cols.map(c => `<option ${c.name === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('');

function indexEditor(cols) {
    const my = S.driver === 'mysql';
    modal(`<div style="width:min(600px,80vw)"><h3>Add index</h3><div class="ce-grid"><label>Name<input name="name" placeholder="${my ? '(auto)' : 'idx_name'}"></label>
      <label>Type<select name="type"><option value="INDEX">INDEX</option><option value="UNIQUE">UNIQUE</option>${my ? '<option value="PRIMARY">PRIMARY KEY</option><option value="FULLTEXT">FULLTEXT</option>' : ''}</select></label></div>
      <small style="color:var(--mute)">Columns (order matters)</small><div id="rl"></div><button type="button" id="rla" style="margin:6px 0 10px">+ Column</button>
      <div class="sqlprev"><small>SQL preview</small><pre id="prev">…</pre></div></div>`, async () => { await api('add_index', body()); toast('Index added'); render(); });
    const form = $('#modal form');
    const L = rowList($('#rl'), () => `<select class="c">${colOptions(cols)}</select>${my ? '<input class="len" size="5" placeholder="prefix len" title="Prefix length (optional)">' : ''}`, () => preview());
    $('#rla').onclick = L.add;
    const body = () => ({ db: S.db, table: S.table, name: form.name.value, type: form.type.value, columns: L.rows().map(r => ({ name: r.querySelector('.c').value, length: r.querySelector('.len')?.value || '' })) });
    let t; const preview = () => { clearTimeout(t); t = setTimeout(async () => { try { $('#prev').textContent = (await api('add_index', { ...body(), dry: true })).sql + ';'; } catch (e) { $('#prev').textContent = '-- ' + e.message; } }, 150); };
    form.addEventListener('input', preview); form.addEventListener('change', preview); preview();
}

async function fkEditor(cols) {
    const tbls = (S.tables[S.db] || []).filter(t => t.name !== S.table || true);
    let refCols = [];
    const loadRef = async name => { refCols = name ? (await api('structure', { db: S.db, table: name })).columns : []; };
    await loadRef(tbls[0]?.name);
    modal(`<div style="width:min(640px,80vw)"><h3>Add foreign key</h3><div class="ce-grid"><label>Name<input name="name" placeholder="(auto)"></label>
      <label>Referenced table<select name="ref_table">${tbls.map(t => `<option>${esc(t.name)}</option>`).join('')}</select></label>
      <label>On delete<select name="on_delete">${['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION', 'SET DEFAULT'].map(x => `<option>${x}</option>`).join('')}</select></label>
      <label>On update<select name="on_update">${['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION', 'SET DEFAULT'].map(x => `<option>${x}</option>`).join('')}</select></label></div>
      <small style="color:var(--mute)">Column mapping: this table → referenced table</small><div id="rl"></div><button type="button" id="rla" style="margin:6px 0 10px">+ Pair</button>
      <div class="msg">Both columns need compatible types, and the referenced columns need an index. Use the column editor first if not.</div>
      <div class="sqlprev"><small>SQL preview</small><pre id="prev">…</pre></div></div>`, async () => { await api('add_fk', body()); toast('Foreign key added'); render(); });
    const form = $('#modal form');
    const rowH = () => `<select class="c">${colOptions(cols)}</select><span>→</span><select class="r">${colOptions(refCols)}</select>`;
    const L = rowList($('#rl'), rowH, () => preview());
    $('#rla').onclick = L.add;
    const body = () => ({ db: S.db, table: S.table, name: form.name.value, ref_table: form.ref_table.value, on_delete: form.on_delete.value, on_update: form.on_update.value, pairs: L.rows().map(r => ({ col: r.querySelector('.c').value, ref: r.querySelector('.r').value })) });
    form.ref_table.onchange = guard(async () => { await loadRef(form.ref_table.value); L.rows().forEach(r => r.querySelector('.r').innerHTML = colOptions(refCols)); preview(); });
    let t; const preview = () => { clearTimeout(t); t = setTimeout(async () => { try { $('#prev').textContent = (await api('add_fk', { ...body(), dry: true })).sql + ';'; } catch (e) { $('#prev').textContent = '-- ' + e.message; } }, 150); };
    form.addEventListener('change', preview); preview();
}

function columnEditor(cols, col) {
    const my = S.driver === 'mysql', adding = !col;
    const c = col || { name: '', parsed: { base: 'VARCHAR', length: '255', values: [], unsigned: false }, null: !my, def: { mode: 'none', value: '' }, ai: false, on_update: false, collation: '', comment: '' };
    const pt = c.parsed, others = cols.filter(x => x.name !== c.name);
    const groups = typeGroupsForDriver();
    const typeOpts = groups.map(([g, l]) => `<optgroup label="${g}">${l.map(t => `<option ${t === pt.base ? 'selected' : ''}>${t}</option>`).join('')}</optgroup>`).join('');
    const lite = !my && !adding; // SQLite can only rename existing columns
    const html = `<div style="width:min(660px,80vw)"><h3>${adding ? 'Add column' : (my ? 'Edit column ' : 'Rename column ') + '<span style="color:var(--mute)">' + esc(c.name) + '</span>'}</h3>
      ${lite ? '<div class="msg">SQLite only supports renaming existing columns in place (<code>ALTER TABLE … RENAME COLUMN</code>). Type, nullability, and default changes require a table rebuild in the SQL editor.</div>' : ''}
      ${!my && adding ? '<div class="msg">In SQLite, adding a <code>NOT NULL</code> column to an existing table requires a non-NULL default value.</div>' : ''}
      <div class="ce-grid">
        <label>Name<input name="name" value="${esc(c.name)}" required autofocus></label>
        <label>Type<select name="type" ${lite ? 'disabled' : ''}>${typeOpts}</select></label>
        <label id="l-len">Length / precision<input name="length" value="${esc(pt.length)}" placeholder="e.g. 255 or 10,2"></label>
        <label id="l-vals" hidden style="grid-column:1/-1">Values (one per line)<textarea name="values" rows="4">${esc(pt.values.join('\n'))}</textarea></label>
        <label style="grid-column:1/-1">Default
          <div class="row">
            <select name="default_mode" style="width:140px"><option value="none">No default</option><option value="null">NULL</option><option value="value">Literal value</option><option value="expr">Expression</option></select>
            <input name="default" style="flex:1" value="${esc(c.def.value)}" placeholder="e.g. 0, or CURRENT_TIMESTAMP">
          </div>
          <div id="dt-presets" class="presets" style="margin:6px 0 0" hidden>
            <span style="font-size:11px;color:var(--mute);align-self:center">Quick presets:</span>
            <button type="button" class="preset" data-dp="now">CURRENT_TIMESTAMP (created_at)</button>
            ${my ? `<button type="button" class="preset" data-dp="upd">CURRENT_TIMESTAMP + ON UPDATE (updated_at)</button>` : ''}
            <button type="button" class="preset" data-dp="today">Literal Today / Now</button>
            <button type="button" class="preset" data-dp="clear">Clear default</button>
          </div>
        </label>
        ${my ? `<label style="grid-column:1/-1">Comment<input name="comment" value="${esc(c.comment || '')}"></label>
        <label style="grid-column:1/-1">Position<select name="after"><option value="">${adding ? 'At end of table' : 'Keep current position'}</option><option value="__FIRST__">First</option>${others.map(x => `<option value="${esc(x.name)}">After ${esc(x.name)}</option>`).join('')}</select></label>
        <details id="l-coll" style="grid-column:1/-1;font-size:12px;color:var(--mute)"><summary style="cursor:pointer">Advanced: Override table collation for this column</summary><div style="margin-top:6px"><select name="collation" style="width:100%">${collSelectOpts(c.collation || '', '— Inherit table default collation (recommended) —')}</select></div></details>` : ''}
      </div>
      <div class="ce-flags"><label class="pc"><input type="checkbox" name="null" ${c.null ? 'checked' : ''} ${lite ? 'disabled' : ''}><span>Nullable</span><small>Allow NULL values</small></label>
        ${my ? `<label class="pc" id="l-uns"><input type="checkbox" name="unsigned" ${pt.unsigned ? 'checked' : ''}><span>Unsigned</span><small>No negative numbers</small></label>
        <label class="pc" id="l-ai"><input type="checkbox" name="ai" ${c.ai ? 'checked' : ''}><span>Auto increment</span><small>Needs a key on the column</small></label>
        <label class="pc" id="l-ou"><input type="checkbox" name="on_update" ${c.on_update ? 'checked' : ''}><span>On update NOW()</span><small>Auto-update timestamp on row edit</small></label>` : ''}</div>
      ${!adding && my ? '<div class="msg">Changing a type may truncate or convert existing data.</div>' : ''}
      <div class="sqlprev"><small>SQL preview</small><pre id="prev">…</pre></div></div>`;
    modal(html, async () => { const r = await api(adding ? 'add_column' : 'alter_column', body()); toast(adding ? 'Column added' : 'Column updated'); render(); });
    const form = $('#modal form'), f = n => form.elements[n];
    f('default_mode').value = c.def.mode;
    const body = () => {
        const t = f('type').value;
        return { db: S.db, table: S.table, column: c.name, name: f('name').value, type: t, length: f('length').value, values: f('values').value.split('\n').map(x => x.trim()).filter(Boolean),
            null: f('null').checked, unsigned: my && f('unsigned').checked, ai: my && f('ai').checked, on_update: my && f('on_update').checked,
            default_mode: f('default_mode').value, default: f('default').value,
            collation: my ? f('collation').value : '', comment: my ? f('comment').value : '', after: my ? f('after').value : '' };
    };
    const sync = () => {
        const t = f('type').value, isDT = ['DATE', 'TIME', 'DATETIME', 'TIMESTAMP', 'YEAR'].includes(t);
        $('#l-len').hidden = !T_LEN.includes(t); $('#l-vals').hidden = !['ENUM', 'SET'].includes(t);
        $('#dt-presets').hidden = !isDT || lite;
        if (my) {
            $('#l-coll').hidden = !T_TEXT.includes(t);
            $('#l-uns').hidden = !T_NUM.includes(t);
            $('#l-ai').hidden = !T_INT.includes(t);
            $('#l-ou').hidden = !['DATETIME', 'TIMESTAMP'].includes(t);
        }
        const dm = f('default_mode').value, defInp = f('default');
        defInp.disabled = !['value', 'expr'].includes(dm);
        if (dm === 'value') {
            defInp.type = t === 'DATE' ? 'date' : t === 'TIME' ? 'time' : 'text';
            if (['DATETIME', 'TIMESTAMP'].includes(t)) defInp.placeholder = 'YYYY-MM-DD HH:MM:SS';
            else if (t === 'YEAR') defInp.placeholder = 'YYYY';
            else defInp.placeholder = 'Literal default value';
        } else {
            defInp.type = 'text';
            defInp.placeholder = dm === 'expr' ? 'e.g. CURRENT_TIMESTAMP' : '';
        }
        if (lite) form.querySelectorAll('input:not([name=name]),select,textarea').forEach(x => x.disabled = true);
    };
    let t;
    const preview = () => { sync(); clearTimeout(t); t = setTimeout(async () => { try { const r = await api(adding ? 'add_column' : 'alter_column', { ...body(), dry: true }); $('#prev').textContent = r.sql + ';'; } catch (e) { $('#prev').textContent = '-- ' + e.message; } }, 200); };
    form.querySelectorAll('[data-dp]').forEach(b => b.onclick = () => {
        const dp = b.dataset.dp, tp = f('type').value;
        if (dp === 'now' || dp === 'upd') {
            if (!['DATETIME', 'TIMESTAMP'].includes(tp) && tp === 'DATE') { f('default_mode').value = 'expr'; f('default').value = my ? 'CURDATE()' : 'CURRENT_DATE'; }
            else if (tp === 'TIME') { f('default_mode').value = 'expr'; f('default').value = my ? 'CURTIME()' : 'CURRENT_TIME'; }
            else { f('default_mode').value = 'expr'; f('default').value = 'CURRENT_TIMESTAMP'; }
            if (my && f('on_update')) f('on_update').checked = (dp === 'upd');
        } else if (dp === 'today') {
            f('default_mode').value = 'value';
            f('default').value = nowISO(tp).replace('T', ' ');
        } else if (dp === 'clear') {
            f('default_mode').value = 'none'; f('default').value = '';
            if (my && f('on_update')) f('on_update').checked = false;
        }
        preview();
    });
    form.addEventListener('input', preview); form.addEventListener('change', preview);
    preview();
}

/* ---------- SQL editor, saved queries & history ---------- */
const loadJSON = (k, def = []) => { try { return JSON.parse(localStorage[k] || '') || def; } catch { return def; } };
const saveJSON = (k, v) => { localStorage[k] = JSON.stringify(v); };

const SQL_KW = ['SELECT', 'FROM', 'WHERE', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'JOIN', 'ON', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT', 'OFFSET', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'UNION ALL', 'UNION', 'AND', 'OR', 'AS', 'IN', 'IS NULL', 'IS NOT NULL', 'ASC', 'DESC', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END'];
function formatSqlText(sql) {
    let out = '';
    let i = 0, n = sql.length, qt = null;
    while (i < n) {
        const ch = sql[i];
        if (qt) {
            out += ch;
            if (ch === '\\' && qt !== '`') { if (i + 1 < n) out += sql[++i]; }
            else if (ch === qt) {
                if (sql[i + 1] === qt) out += sql[++i];
                else qt = null;
            }
            i++;
            continue;
        }
        if (ch === "'" || ch === '"' || ch === '`') { qt = ch; out += ch; i++; continue; }
        if (ch === '-' && sql[i + 1] === '-') {
            const nl = sql.indexOf('\n', i + 2);
            if (nl === -1) { out += sql.slice(i); break; }
            out += sql.slice(i, nl + 1);
            i = nl + 1;
            continue;
        }
        if (/\s/.test(ch)) {
            while (i < n && /\s/.test(sql[i])) i++;
            out += ' ';
            continue;
        }
        out += ch;
        i++;
    }
    for (const kw of SQL_KW) {
        const re = new RegExp('\\b' + kw.replace(/\s+/g, '\\s+') + '\\b', 'gi');
        out = out.replace(re, kw);
    }
    out = out
        .replace(/\s+\b(FROM|WHERE|LEFT JOIN|RIGHT JOIN|INNER JOIN|JOIN|GROUP BY|HAVING|ORDER BY|LIMIT|VALUES|SET|UNION ALL|UNION)\b/g, '\n$1')
        .replace(/\s+\b(AND|OR)\b/g, '\n  $1')
        .replace(/;\s*/g, ';\n\n');
    return out.trim();
}

async function sqlView() {
    const qId = id => S.driver === 'mysql' ? '`' + id.replace(/`/g, '``') + '`' : '"' + id.replace(/"/g, '""') + '"';
    const def = S.sql || (S.table ? `SELECT * FROM ${qId(S.table)} LIMIT 50;` : '');
    const tcols = S.table ? ((await api('structure', { db: S.db, table: S.table }).catch(() => ({ columns: [] }))).columns || []) : [];

    C().innerHTML = `<div class="sql-layout">
      <div class="sql-main">
        ${S.table ? `<div class="presets" id="snippets">
          <button type="button" class="preset" data-s="sel">SELECT *</button>
          <button type="button" class="preset" data-s="cnt">COUNT(*)</button>
          <button type="button" class="preset" data-s="ins">INSERT</button>
          <button type="button" class="preset" data-s="upd">UPDATE</button>
          <button type="button" class="preset" data-s="del">DELETE</button>
          ${tcols.length ? `<span class="badge" style="align-self:center;margin-left:4px">Columns (click to insert):</span>` + tcols.map(c => `<button type="button" class="chip" style="cursor:pointer" data-col="${esc(c.name)}" title="${esc(c.type)}">${esc(c.name)}</button>`).join('') : ''}
        </div>` : ''}
        <textarea class="editor" id="ed" spellcheck="false" placeholder="Write SQL… (Ctrl+Enter to run, Tab to indent, or select part of the text to run only the selection)">${esc(def)}</textarea>
        <div class="bar" style="margin-top:8px">
          <button class="primary" id="run">▶ Run</button>
          <button id="expq" title="Run EXPLAIN / EXPLAIN QUERY PLAN on current query">🔍 Explain</button>
          <button id="fmtq" title="Format SQL keywords and clause line breaks">✨ Format</button>
          <button id="saveq">★ Save query</button>
          <button id="clearq" class="ghost">Clear</button>
          <label class="row" style="font-size:12px;color:var(--mute);margin-left:6px">Max rows
            <select id="sql-max">${[100, 500, 1000, 5000].map(n => `<option value="${n}" ${n === (S.sqlMaxRows || 1000) ? 'selected' : ''}>${n}</option>`).join('')}</select>
          </label>
          <span class="spacer"></span>
          <small style="color:var(--mute)">Ctrl+Enter to execute · Tab to indent</small>
        </div>
        <div id="res"></div>
      </div>
      <div class="sql-side">
        <div class="sql-tabs">
          <button type="button" class="${(S.sqlSide || 'saved') === 'saved' ? 'active' : ''}" data-st="saved">★ Saved</button>
          <button type="button" class="${S.sqlSide === 'history' ? 'active' : ''}" data-st="history">⏱ History</button>
        </div>
        <div class="bar" style="margin:8px 0">
          <input id="qf" placeholder="Filter queries…" value="${esc(S.qFilter || '')}" style="flex:1">
          ${S.sqlSide === 'history' ? '<button class="ghost danger" id="clrhist" title="Clear history">🗑</button>' : ''}
        </div>
        <div id="qlist" class="qlist"></div>
      </div>
    </div>`;

    const ed = $('#ed');
    const insertAtCursor = txt => {
        const s = ed.selectionStart ?? ed.value.length, e = ed.selectionEnd ?? ed.value.length;
        ed.value = ed.value.slice(0, s) + txt + ed.value.slice(e);
        S.sql = ed.value; ed.focus(); ed.setSelectionRange(s + txt.length, s + txt.length);
    };

    if ($('#snippets')) {
        const T = qId(S.table), cs = tcols.map(c => qId(c.name));
        const TPL = {
            sel: `SELECT ${cs.length ? cs.join(', ') : '*'} FROM ${T} LIMIT 50;`,
            cnt: `SELECT COUNT(*) AS total FROM ${T};`,
            ins: `INSERT INTO ${T} (${cs.join(', ')})\nVALUES (${tcols.map(() => "''").join(', ')});`,
            upd: `UPDATE ${T}\nSET ${cs[0] || 'col'} = ''\nWHERE ${cs[0] || 'id'} = 1;`,
            del: `DELETE FROM ${T}\nWHERE ${cs[0] || 'id'} = 1;`
        };
        $('#snippets').querySelectorAll('[data-s]').forEach(b => b.onclick = () => { ed.value = S.sql = TPL[b.dataset.s]; ed.focus(); });
        $('#snippets').querySelectorAll('[data-col]').forEach(b => b.onclick = () => insertAtCursor(qId(b.dataset.col)));
    }

    const drawSide = () => {
        const mode = S.sqlSide || 'saved', q = (S.qFilter || '').toLowerCase();
        const items = loadJSON(mode === 'saved' ? 'fandejo_saved' : 'fandejo_history');
        const flt = items.map((x, idx) => ({ ...x, idx })).filter(x => !q || x.sql.toLowerCase().includes(q) || (x.name || '').toLowerCase().includes(q) || (x.db || '').toLowerCase().includes(q));
        const el = $('#qlist');
        if (!flt.length) { el.innerHTML = `<div class="empty" style="padding:20px">${mode === 'saved' ? 'No saved queries yet' : 'No query history yet'}</div>`; return; }
        el.innerHTML = flt.map(x => `<div class="qitem">
          <div class="qhead">
            <b>${esc(mode === 'saved' ? x.name : (x.db || 'Global'))}</b>
            ${mode === 'saved' && x.db ? `<span class="badge">${esc(x.db)}</span>` : ''}
            ${mode === 'history' ? `<span class="badge ${x.err ? 'warn' : ''}">${x.err ? 'err' : x.ms + ' ms'}</span>` : ''}
            <span class="spacer"></span>
            <small style="color:var(--mute)">${new Date(x.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
          </div>
          <pre class="qcode" data-load="${x.idx}" title="Click to load into editor">${esc(x.sql)}</pre>
          <div class="qacts">
            <button type="button" class="ghost" data-load="${x.idx}">Load</button>
            <button type="button" class="ghost" data-run="${x.idx}">▶ Run</button>
            ${mode === 'history' ? `<button type="button" class="ghost" data-pin="${x.idx}" title="Save to bookmarks">★ Save</button>` : ''}
            <span class="spacer"></span>
            <button type="button" class="ghost danger" data-del="${x.idx}">✕</button>
          </div>
        </div>`).join('');

        el.querySelectorAll('[data-load]').forEach(b => b.onclick = () => {
            const it = items[b.dataset.load]; ed.value = S.sql = it.sql; ed.focus();
        });
        el.querySelectorAll('[data-run]').forEach(b => b.onclick = () => {
            const it = items[b.dataset.run]; ed.value = S.sql = it.sql; runSql(it.sql);
        });
        el.querySelectorAll('[data-pin]').forEach(b => b.onclick = () => {
            const it = items[b.dataset.pin]; promptSave(it.sql);
        });
        el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
            items.splice(+b.dataset.del, 1);
            saveJSON(mode === 'saved' ? 'fandejo_saved' : 'fandejo_history', items);
            drawSide();
        });
    };

    const promptSave = sqlText => {
        if (!sqlText.trim()) return toast('Write a query first', true);
        const defName = sqlText.trim().replace(/\s+/g, ' ').slice(0, 36);
        modal(`<h3>Save query</h3><label>Name<input name="name" value="${esc(defName)}" required autofocus></label><label>Query<textarea name="sql" rows="5" class="editor" style="height:110px">${esc(sqlText)}</textarea></label>`, async v => {
            const list = loadJSON('fandejo_saved');
            list.unshift({ name: v.name.trim(), sql: v.sql, db: S.db, table: S.table, ts: Date.now() });
            saveJSON('fandejo_saved', list);
            S.sqlSide = 'saved'; toast('Query saved'); render();
        });
    };

    const runSql = guard(async customSql => {
        if (S.driver === 'sqlite' && !S.db) {
            if (S.dbs.length) S.db = S.dbs[0].name;
            else return toast('Create or select an SQLite database first', true);
        }
        S.sql = ed.value;
        S.sqlMaxRows = +($('#sql-max')?.value || S.sqlMaxRows || 1000);
        const sel = ed.value.slice(ed.selectionStart, ed.selectionEnd).trim();
        const toRun = typeof customSql === 'string' ? customSql : (sel || S.sql);
        if (!toRun.trim()) return toast('Enter a SQL query to run', true);
        const r = await api('query', { db: S.db, sql: toRun, max_rows: S.sqlMaxRows });
        const totalMs = r.results.reduce((a, x) => a + (x.ms || 0), 0).toFixed(2);
        const hasErr = r.results.some(x => x.error);
        const hist = loadJSON('fandejo_history').filter(h => h.sql.trim() !== toRun.trim());
        hist.unshift({ sql: toRun.trim(), db: S.db, table: S.table, ms: totalMs, err: hasErr, ts: Date.now() });
        saveJSON('fandejo_history', hist.slice(0, 100));
        drawSide();

        $('#res').innerHTML = r.results.map(x => x.error ? `<div class="msg err">${esc(x.error)}<br><small>${esc(x.sql)}</small></div>`
            : x.rows ? `<div class="msg ok">${x.rows.length}${x.truncated ? `+ rows (showing first ${x.max_rows || x.rows.length} — add a LIMIT clause or raise Max rows)` : ' rows'} · ${x.ms} ms <button class="ghost" data-csv="${r.results.indexOf(x)}">⬇ CSV</button></div><div class="tw"><table><tr>${x.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr>${x.rows.map(row => `<tr>${x.columns.map(c => row[c] === null ? '<td class="null">NULL</td>' : `<td title="${esc(row[c])}">${esc(row[c])}</td>`).join('')}</tr>`).join('')}</table></div>`
                : `<div class="msg ok">${x.affected} rows affected · ${x.ms} ms</div>`).join('');
        $('#res').querySelectorAll('[data-csv]').forEach(b => b.onclick = () => { const x = r.results[b.dataset.csv]; download(new Blob(['\uFEFF' + toCSV(x.columns, x.rows.map(row => x.columns.map(c => row[c])))], { type: 'text/csv' }), 'query.csv'); });
        if (r.results.some(x => /^\s*(create|drop|alter|rename)/i.test(x.sql)) && S.db) { await loadTables(S.db); tree(); }
    });

    $('#run').onclick = () => runSql();
    $('#expq').onclick = () => {
        const sel = ed.value.slice(ed.selectionStart, ed.selectionEnd).trim();
        const raw = (sel || ed.value).trim();
        if (!raw) return toast('Enter a SQL query to explain', true);
        const prefix = S.driver === 'sqlite' ? 'EXPLAIN QUERY PLAN ' : 'EXPLAIN ';
        const q = /^\s*explain\b/i.test(raw) ? raw : prefix + raw;
        runSql(q);
    };
    $('#fmtq').onclick = () => {
        if (!ed.value.trim()) return;
        ed.value = S.sql = formatSqlText(ed.value);
        ed.focus();
    };
    if ($('#sql-max')) $('#sql-max').onchange = e => { S.sqlMaxRows = +e.target.value; };
    $('#saveq').onclick = () => promptSave(ed.value);
    $('#clearq').onclick = () => { ed.value = S.sql = ''; ed.focus(); };
    ed.oninput = () => { S.sql = ed.value; };
    ed.onkeydown = e => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runSql(); }
        else if (e.key === 'Tab') {
            e.preventDefault();
            const start = ed.selectionStart, end = ed.selectionEnd, val = ed.value;
            if (start !== end && val.slice(start, end).includes('\n')) {
                const lineStart = val.lastIndexOf('\n', start - 1) + 1;
                const block = val.slice(lineStart, end);
                const replaced = e.shiftKey
                    ? block.replace(/^ {1,2}|\t/gm, '')
                    : block.replace(/^/gm, '  ');
                ed.value = S.sql = val.slice(0, lineStart) + replaced + val.slice(end);
                ed.setSelectionRange(lineStart, lineStart + replaced.length);
            } else if (e.shiftKey) {
                const lineStart = val.lastIndexOf('\n', start - 1) + 1;
                if (val.slice(lineStart, lineStart + 2) === '  ') {
                    ed.value = S.sql = val.slice(0, lineStart) + val.slice(lineStart + 2);
                    ed.setSelectionRange(Math.max(lineStart, start - 2), Math.max(lineStart, end - 2));
                }
            } else {
                insertAtCursor('  ');
            }
        }
    };
    C().querySelectorAll('[data-st]').forEach(b => b.onclick = () => { S.sqlSide = b.dataset.st; render(); });
    $('#qf').oninput = e => { S.qFilter = e.target.value; drawSide(); };
    if ($('#clrhist')) $('#clrhist').onclick = () => confirmDo('Clear all query history?', async () => { saveJSON('fandejo_history', []); drawSide(); });
    drawSide();
}

async function insertView() {
    const [r, fkRes] = await Promise.all([api('structure', { db: S.db, table: S.table }), api('foreign_keys', { db: S.db, table: S.table }).catch(() => ({ foreign_keys: [] }))]);
    const fkMap = {};
    for (const f of (fkRes.foreign_keys || [])) {
        for (const pr of (f.pairs || [])) {
            fkMap[pr.col] = { ref_db: f.ref_db || S.db, ref_table: f.ref_table, ref_col: pr.ref };
        }
    }
    C().innerHTML = `<form class="form" id="if" style="max-width:620px">${r.columns.map(c => renderFieldInput(c.name, { ...c.parsed, raw_type: c.type, fk: fkMap[c.name] }, '', true, c.extra, c.def.mode !== 'none')).join('')}<button class="primary">Insert</button></form>`;
    wireFieldInputs($('#if'));
    $('#if').onsubmit = guard(async e => {
        e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)), values = {};
        r.columns.forEach(c => {
            if (!f['s_' + c.name]) {
                let v = f['v_' + c.name];
                if (['DATETIME', 'TIMESTAMP'].includes(c.parsed.base)) v = v.replace('T', ' ');
                values[c.name] = v;
            }
        });
        await api('insert', { db: S.db, table: S.table, values }); toast('Row inserted'); S.tab = 'browse'; render();
    });
}

async function ops() {
    const my = S.driver === 'mysql';
    const tbObj = (S.tables[S.db] || []).find(t => t.name === S.table) || {};
    const curEng = tbObj.engine || getPrefs().engine;
    const curColl = tbObj.collation || getPrefs().collation;
    const curCmt = tbObj.comment || '';
    const tMeta = await api('table_meta', { db: S.db, table: S.table }).catch(() => ({ auto_increment: null }));

    C().innerHTML = `<div class="dash-grid" style="max-width:1020px">
      <div class="dash-card">
        <h3>⚙ Table Options</h3>
        <div class="form">
          <label>Rename table<div class="row"><input id="rn" value="${esc(S.table)}" style="flex:1"><button id="rb">Rename</button></div></label>
          ${tMeta.auto_increment !== null ? `<label>Next AUTO_INCREMENT value<div class="row"><input type="number" min="1" id="t-ai" value="${tMeta.auto_increment}" style="flex:1"><button id="t-aib">Set AUTO_INCREMENT</button></div></label>` : ''}
          ${my ? `<label>Storage Engine<select id="t-eng">${engineSelectOpts(curEng)}</select></label>
          <label>Table Charset & Collation<select id="t-coll">${collSelectOpts(curColl)}</select></label>
          <label>Column Conversion Strategy<select id="t-cmode">
            <option value="convert">Convert existing text columns & data (CONVERT TO CHARACTER SET)</option>
            <option value="default_only">Change table default only (leave existing columns untouched)</option>
            <option value="binary">Re-label via BINARY (fix raw UTF-8 bytes stored inside latin1 columns)</option>
          </select></label>
          <label>Table Comment<input id="t-cmt" value="${esc(curCmt)}" placeholder="Optional table description"></label>
          <div class="sqlprev"><small>SQL preview (automatically drops & restores any foreign keys on text columns)</small><pre id="t-prev">--</pre></div>
          <div><button class="primary" id="t-save">Save Table Options</button></div>` : ''}
        </div>
      </div>

      <div class="dash-card">
        <h3>🛠 Table Maintenance & Diagnostics</h3>
        <p style="color:var(--mute);font-size:12px;margin-top:0">${my ? 'Verify table integrity, refresh index cardinality statistics, or defragment data files.' : 'Check SQLite integrity, verify foreign key constraints, update planner statistics, or compact the database file.'}</p>
        <div class="bar">
          ${my ? `<button data-maint="check">🔍 Check Table</button>
            <button data-maint="analyze">📊 Analyze Table</button>
            <button data-maint="optimize">⚡ Optimize Table</button>
            <button data-maint="repair">🔧 Repair Table</button>`
          : `<button data-maint="integrity_check">🔍 Integrity Check</button>
            <button data-maint="foreign_key_check">🔗 Foreign Key Check</button>
            <button data-maint="analyze">📊 Analyze Statistics</button>
            <button data-maint="vacuum">⚡ Vacuum Database</button>`}
        </div>
        <div id="maint-res"></div>

        <h3 style="margin-top:20px">⚠ Danger Zone</h3>
        <p style="color:var(--mute);font-size:12px">Destructive actions on <b>${esc(S.table)}</b>. These cannot be undone.</p>
        <div class="bar" style="margin-bottom:0">
          <button id="tr" class="danger">Empty table (TRUNCATE)</button>
          <button id="dr" class="danger">Drop table permanently</button>
        </div>
      </div>
    </div>`;

    $('#rb').onclick = guard(async () => { const to = $('#rn').value; await api('rename_table', { db: S.db, table: S.table, to }); S.table = to; await loadTables(S.db); render(); });
    if ($('#t-aib')) {
        $('#t-aib').onclick = guard(async () => {
            const val = +$('#t-ai').value;
            const res = await api('table_maint', { db: S.db, table: S.table, op: 'auto_increment', value: val });
            toast(res.messages?.[0]?.text || 'AUTO_INCREMENT updated');
            render();
        });
    }
    C().querySelectorAll('[data-maint]').forEach(b => b.onclick = guard(async () => {
        const op = b.dataset.maint;
        $('#maint-res').innerHTML = `<div class="msg">Running <code>${esc(op.toUpperCase())}</code>…</div>`;
        const res = await api('table_maint', { db: S.db, table: S.table, op });
        $('#maint-res').innerHTML = (res.messages || []).map(m => `<div class="msg ${m.type === 'error' ? 'err' : 'ok'}"><b>${esc(m.op)}</b> (${esc(m.type)}): ${esc(m.text)}</div>`).join('');
        if (op === 'vacuum' || op === 'optimize') { await loadDbs(); await loadTables(S.db); }
    }));
    $('#tr').onclick = () => confirmDo('Delete ALL rows?', async () => { await api('truncate', { db: S.db, table: S.table }); toast('Table emptied'); });
    $('#dr').onclick = () => confirmDo('Drop this table?', async () => { await api('drop_table', { db: S.db, table: S.table }); S.table = null; await loadTables(S.db); S.tab = 'tables'; render(); });

    if (my) {
        const body = () => ({ db: S.db, table: S.table, engine: $('#t-eng').value, collation: $('#t-coll').value, conv_mode: $('#t-cmode').value, comment: $('#t-cmt').value });
        let t;
        const preview = () => { clearTimeout(t); t = setTimeout(async () => { try { const r = await api('alter_table_options', { ...body(), dry: true }); $('#t-prev').textContent = r.sql + ';'; } catch (e) { $('#t-prev').textContent = '-- ' + e.message; } }, 150); };
        ['#t-eng', '#t-coll', '#t-cmode', '#t-cmt'].forEach(sel => { $(sel).oninput = $(sel).onchange = preview; });
        preview();
        $('#t-save').onclick = guard(async () => {
            await api('alter_table_options', body());
            await loadTables(S.db);
            toast('Table options updated');
            render();
        });
    }
}

const TYPES_MYSQL = ['INT', 'BIGINT', 'TINYINT', 'VARCHAR', 'CHAR', 'TEXT', 'LONGTEXT', 'DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR', 'DECIMAL', 'FLOAT', 'DOUBLE', 'BOOLEAN', 'BLOB', 'JSON'];
const TYPES_SQLITE = ['INTEGER', 'INT', 'BIGINT', 'TEXT', 'VARCHAR', 'REAL', 'NUMERIC', 'DECIMAL', 'BOOLEAN', 'DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'BLOB', 'JSON'];
async function newTable() {
    const my = S.driver === 'mysql', prefs = getPrefs();
    const types = my ? TYPES_MYSQL : TYPES_SQLITE;
    const dbColl = S.dbs.find(d => d.name === S.db)?.collation || prefs.collation;
    const defInt = my ? 'INT' : 'INTEGER';
    const rowH = (i, d = {}) => `<tr><td><input name="name" value="${d.name || ''}" placeholder="column"></td><td><select name="type">${types.map(t => `<option ${t === (d.type || defInt) ? 'selected' : ''}>${t}</option>`).join('')}</select></td><td><input name="length" size="6" value="${d.length || ''}"></td><td><input name="default" size="14" value="${d.def || ''}" list="def-presets" placeholder="literal or CURRENT_TIMESTAMP"></td><td><input type="checkbox" name="null" ${d.null ? 'checked' : ''}></td><td><input type="checkbox" name="pk" ${d.pk ? 'checked' : ''}></td><td><input type="checkbox" name="ai" ${d.ai ? 'checked' : ''}></td>${my ? `<td><input type="checkbox" name="on_update" ${d.ou ? 'checked' : ''} title="ON UPDATE CURRENT_TIMESTAMP (for DATETIME/TIMESTAMP)"></td>` : ''}<td><button type="button" class="ghost danger" onclick="this.closest('tr').remove()">✕</button></td></tr>`;
    C().innerHTML = `<datalist id="def-presets"><option value="CURRENT_TIMESTAMP"><option value="CURRENT_DATE"><option value="CURRENT_TIME"><option value="NULL"><option value="0"></datalist>
      <div class="bar">
        <input id="tn" placeholder="Table name" style="width:200px">
        ${my ? `<label class="row" style="font-size:12px;color:var(--mute)">Engine <select id="nt-eng">${engineSelectOpts(prefs.engine)}</select></label>
        <label class="row" style="font-size:12px;color:var(--mute)">Collation <select id="nt-coll">${collSelectOpts(dbColl)}</select></label>
        <input id="nt-cmt" placeholder="Table comment (optional)" style="width:190px">` : ''}
        <button id="ar">+ Column</button>
        <button id="ats" title="Add created_at and updated_at timestamp columns">+ Timestamps</button>
        <button id="ct" class="primary">Create</button>
      </div>
      ${!my ? '<div class="msg" style="margin-bottom:10px;font-size:12px">SQLite tip: <b>Auto-Increment (AI)</b> is only supported on a single <code>INTEGER</code> primary key column.</div>' : ''}
      <div class="tw"><table id="ct_t"><tr><th>Name</th><th>Type</th><th>Length</th><th>Default</th><th>Null</th><th>PK</th><th>AI</th>${my ? '<th title="ON UPDATE CURRENT_TIMESTAMP">On Upd</th>' : ''}<th></th></tr>${rowH(0, { name: 'id', pk: true, ai: true })}</table></div>`;
    const syncSqliteAi = () => {
        if (my) return;
        const trs = [...$('#ct_t').querySelectorAll('tr')].slice(1);
        const pkCount = trs.filter(tr => tr.querySelector('[name=pk]').checked).length;
        trs.forEach(tr => {
            const tp = tr.querySelector('[name=type]').value;
            const pk = tr.querySelector('[name=pk]').checked;
            const ai = tr.querySelector('[name=ai]');
            const canAi = pk && pkCount === 1 && ['INTEGER', 'INT', 'BIGINT', 'TINYINT', 'SMALLINT'].includes(tp);
            ai.disabled = !canAi;
            if (!canAi) ai.checked = false;
        });
    };
    $('#ct_t').addEventListener('change', syncSqliteAi);
    $('#ar').onclick = () => { $('#ct_t').insertAdjacentHTML('beforeend', rowH()); syncSqliteAi(); };
    $('#ats').onclick = () => {
        $('#ct_t').insertAdjacentHTML('beforeend', rowH(0, { name: 'created_at', type: 'DATETIME', def: 'CURRENT_TIMESTAMP' }) + rowH(0, { name: 'updated_at', type: 'DATETIME', def: 'CURRENT_TIMESTAMP', ou: true }));
        syncSqliteAi();
    };
    $('#ct').onclick = guard(async () => {
        const columns = [...$('#ct_t').querySelectorAll('tr')].slice(1).map(tr => {
            const g = n => tr.querySelector(`[name=${n}]`);
            return { name: g('name').value, type: g('type').value, length: g('length').value, default: g('default').value, null: g('null').checked, pk: g('pk').checked, ai: g('ai').checked, on_update: my && g('on_update')?.checked };
        }).filter(c => c.name);
        await api('create_table', { db: S.db, table: $('#tn').value, columns, engine: my ? $('#nt-eng').value : '', collation: my ? $('#nt-coll').value : '', comment: my ? $('#nt-cmt').value : '' });
        await loadTables(S.db); S.table = $('#tn').value; S.tab = 'structure'; toast('Table created'); render();
    });
}

/* ---------- CSV / export / import ---------- */
const DELIMS = { ',': 'Comma ( , )', ';': 'Semicolon ( ; )', '\t': 'Tab', '|': 'Pipe ( | )' };
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
function toCSV(cols, rows, delim = ',') {
    const cell = v => { if (v === null || v === undefined) return ''; v = String(v); return /["\r\n]/.test(v) || v.includes(delim) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    return [cols, ...rows].map(r => r.map(cell).join(delim)).join('\r\n') + '\r\n';
}
function parseCSV(text, delim) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
        else if (c === '"' && f === '') q = true;
        else if (c === delim) { row.push(f); f = ''; }
        else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; rows.push(row); row = []; }
        else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows.filter(r => !(r.length === 1 && r[0] === ''));
}
function detectDelim(text) {
    const line = text.slice(0, 4000).split(/\r?\n/)[0] || ''; let best = ',', n = -1;
    for (const d of Object.keys(DELIMS)) { let c = 0, q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === d && !q) c++; } if (c > n) { n = c; best = d; } }
    return best;
}
function guessType(vals) {
    const v = vals.filter(x => x !== '' && x != null); if (!v.length) return ['VARCHAR', '255'];
    if (v.every(x => /^-?\d+$/.test(x) && x.length < 16 && !/^-?0\d/.test(x))) return v.every(x => Math.abs(+x) < 2147483647) ? ['INT', ''] : ['BIGINT', ''];
    if (v.every(x => /^-?\d*\.\d+$|^-?\d+\.\d*$/.test(x) || /^-?\d+$/.test(x))) return ['DOUBLE', ''];
    if (v.every(x => /^\d{4}-\d\d-\d\d$/.test(x))) return ['DATE', ''];
    if (v.every(x => /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(:\d\d)?/.test(x))) return ['DATETIME', ''];
    const max = Math.max(...v.map(x => x.length)); return max <= 255 ? ['VARCHAR', String(Math.min(255, Math.max(32, Math.ceil(max * 1.5))))] : ['TEXT', ''];
}

async function exportView() {
    let targetDb = S.db || S.dbs[0]?.name || '';
    if (targetDb && !S.tables[targetDb]) await loadTables(targetDb);
    const t = S.tables[targetDb] || [];
    const my = S.driver === 'mysql';
    C().innerHTML = `<form class="form" id="ef" style="max-width:600px">
    <h3>⬇ Export ${S.table ? `Table <code>${esc(S.table)}</code>` : `Database <code>${esc(targetDb)}</code>`}</h3>
    ${!S.db && S.dbs.length ? `<label>Database to export<select name="exp_db" id="exp-db">${S.dbs.map(d => `<option value="${esc(d.name)}" ${d.name === targetDb ? 'selected' : ''}>${esc(d.label || d.name)} (${d.tables ?? 0} tables)</option>`).join('')}</select></label>` : ''}
    <div class="ce-grid">
      <label>Format<select name="fmt"><option value="sql">SQL (database / tables)</option><option value="csv">CSV (single table)</option></select></label>
      <label>Compression<select name="compress"><option value="none">None (plain .sql / .csv)</option><option value="gzip">Gzip (.gz)</option><option value="zip">ZIP archive (.zip)</option></select></label>
    </div>
    <div id="sqlopts">
      <div class="bar" style="margin:4px 0">
        <span style="font-size:12px;color:var(--mute)">Tables to include (${t.length})</span>
        <span class="spacer"></span>
        <button type="button" class="ghost" id="exp-all" style="font-size:12px;padding:2px 8px">Select All (Full DB)</button>
        <button type="button" class="ghost" id="exp-none" style="font-size:12px;padding:2px 8px">Select None</button>
      </div>
      <div style="max-height:220px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--bg);display:flex;flex-direction:column;gap:5px">
        ${t.length ? t.map(x => `<label style="flex-direction:row;gap:8px;color:var(--text)"><input type="checkbox" name="t" value="${esc(x.name)}" ${!S.table || S.table === x.name ? 'checked' : ''}><span>${esc(x.name)}</span><small style="color:var(--mute);margin-left:auto">${x.type?.includes('VIEW') || x.type === 'view' ? 'VIEW' : (x.rows ?? 0) + ' rows'}</small></label>`).join('') : '<div class="empty" style="padding:12px">No tables in this database</div>'}
      </div>
      <div class="bar" style="margin-top:8px;margin-bottom:0">
        <label class="pc" style="flex:1"><input type="checkbox" name="structure" checked><span>Structure</span><small>Tables, views & triggers</small></label>
        <label class="pc" style="flex:1"><input type="checkbox" name="data" checked><span>Data</span><small>Batched multi-row INSERTs</small></label>
      </div>
      ${my ? `<label class="pc" style="margin-top:6px"><input type="checkbox" name="routines" ${!S.table ? 'checked' : ''}><span>Include Stored Procedures & Functions</span><small>Export CREATE PROCEDURE / FUNCTION definitions</small></label>
      <label class="pc" style="margin-top:6px"><input type="checkbox" name="create_db" ${!S.table ? 'checked' : ''}><span>Include <code>CREATE DATABASE IF NOT EXISTS</code> & <code>USE</code></span><small>Recommended when exporting an entire database for backup or migration</small></label>` : ''}
    </div>
    <div id="csvopts" hidden><label>Table<select name="ct">${t.map(x => `<option ${S.table === x.name ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <div class="ce-grid"><label>Delimiter<select name="delim">${Object.entries(DELIMS).map(([k, v]) => `<option value="${k === '\t' ? 'tab' : k}">${v}</option>`).join('')}</select></label><label>NULL written as<input name="null_as" placeholder="(empty)"></label></div>
      <label class="pc"><input type="checkbox" name="header" checked><span>Header row</span><small>First line contains column names</small></label>
      <label class="pc"><input type="checkbox" name="bom"><span>UTF-8 BOM</span><small>Helps Excel read accents correctly</small></label></div>
    <button class="primary">⬇ Download Export</button></form>`;
    const f = $('#ef');
    if ($('#exp-db')) {
        $('#exp-db').onchange = guard(async e => {
            S.db = e.target.value; S.table = null;
            await loadTables(S.db); render();
        });
    }
    const tBoxes = () => [...f.querySelectorAll('input[name="t"]')];
    if ($('#exp-all')) $('#exp-all').onclick = () => tBoxes().forEach(c => { c.checked = true; });
    if ($('#exp-none')) $('#exp-none').onclick = () => tBoxes().forEach(c => { c.checked = false; });
    f.fmt.onchange = () => { $('#sqlopts').hidden = f.fmt.value !== 'sql'; $('#csvopts').hidden = f.fmt.value !== 'csv'; };
    f.onsubmit = guard(async e => {
        e.preventDefault(); const d = new FormData(f), comp = f.compress.value;
        const dbUse = $('#exp-db')?.value || targetDb;
        if (f.fmt.value === 'csv') return exportCSV({ db: dbUse, table: f.ct.value, delimiter: f.delim.value === 'tab' ? '\t' : f.delim.value, null_as: f.null_as.value, header: f.header.checked, bom: f.bom.checked, compress: comp });
        const picked = d.getAll('t');
        if (!picked.length) throw new Error('Select at least one table to export');
        return exportSQL({ db: dbUse, table: picked.length === 1 ? picked[0] : null, tables: picked, structure: !!d.get('structure'), data: !!d.get('data'), routines: !!d.get('routines'), create_db: !!d.get('create_db'), compress: comp });
    });
}
function compExt(comp) { return comp === 'gzip' ? '.gz' : comp === 'zip' ? '.zip' : ''; }
async function exportSQL(o) {
    const dbUse = o.db || S.db;
    const res = await fetch('api.live.php?a=export_sql', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF': csrf }, body: JSON.stringify({ db: dbUse, table: S.table, ...o }) });
    const ct = res.headers.get('Content-Type') || '';
    if (!ct.includes('application/sql') && !ct.includes('application/gzip') && !ct.includes('application/zip')) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'SQL export failed'); }
    const fname = (o.table || dbUse || 'export').replace(/^@\d+:/, '');
    download(await res.blob(), fname + '.sql' + compExt(o.compress)); toast('SQL export downloaded');
}
async function exportCSV(o) {
    const dbUse = o.db || S.db;
    const res = await fetch('api.live.php?a=export_csv', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF': csrf }, body: JSON.stringify({ db: dbUse, ...o }) });
    const ct = res.headers.get('Content-Type') || '';
    if (!ct.includes('text/csv') && !ct.includes('application/gzip') && !ct.includes('application/zip')) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Export failed'); }
    download(await res.blob(), o.table + '.csv' + compExt(o.compress)); toast('CSV downloaded');
}

async function importView() {
    let targetDb = S.db || S.dbs[0]?.name || '';
    if (targetDb && !S.tables[targetDb]) await loadTables(targetDb);
    const tbls = S.tables[targetDb] || [];
    const defFmt = S.table ? 'csv' : 'sql';
    C().innerHTML = `<div class="form" style="max-width:980px">
      <h3>⬆ Import into ${S.table ? `Table <code>${esc(S.table)}</code>` : `Database <code>${esc(targetDb || '(new / script-defined)')}</code>`}</h3>
      <div class="ce-grid">
        <label>Target Database<select id="imp-db">
          ${S.driver === 'mysql' ? `<option value="" ${!targetDb ? 'selected' : ''}>— None (SQL script contains CREATE DATABASE / USE) —</option>` : ''}
          ${S.dbs.map(d => `<option value="${esc(d.name)}" ${d.name === targetDb ? 'selected' : ''}>${esc(d.label || d.name)}</option>`).join('')}
          <option value="__new__">+ Create new database first…</option>
        </select></label>
        <label>Format<select id="ifmt"><option value="sql" ${defFmt === 'sql' ? 'selected' : ''}>SQL database dump / script (.sql, .sql.gz, .sql.zip)</option><option value="csv" ${defFmt === 'csv' ? 'selected' : ''}>CSV table data (.csv, .tsv, .csv.gz, .csv.zip)</option></select></label>
      </div>
      <div id="sqlimp" ${defFmt === 'sql' ? '' : 'hidden'}>
        <label><span>SQL file (plain <code>.sql</code>, Gzip <code>.sql.gz</code>, or ZIP <code>.sql.zip</code>)</span><input type="file" id="fi" accept=".sql,.txt,.gz,.zip,application/gzip,application/zip"></label>
        <div class="bar" style="margin-top:8px"><button class="primary" id="go">▶ Upload & Run SQL Dump</button></div>
        <div id="res"></div>
      </div>
      <div id="csvimp" ${defFmt === 'csv' ? '' : 'hidden'}><label><span>CSV file (plain <code>.csv</code>, Gzip <code>.csv.gz</code>, or ZIP <code>.csv.zip</code>)</span><input type="file" id="cf" accept=".csv,.tsv,.txt,.gz,.zip,text/csv,application/gzip,application/zip"></label><div id="cfg"></div></div></div>`;
    $('#imp-db').onchange = guard(async e => {
        if (e.target.value === '__new__') {
            e.target.value = targetDb;
            return promptNewDb();
        }
        S.db = targetDb = e.target.value;
        S.table = null;
        await loadTables(S.db);
        render();
    });
    $('#ifmt').onchange = e => { $('#sqlimp').hidden = e.target.value !== 'sql'; $('#csvimp').hidden = e.target.value !== 'csv'; };
    $('#go').onclick = guard(async () => {
        const f = $('#fi').files[0]; if (!f) throw new Error('Choose a file first');
        $('#go').disabled = true;
        $('#res').innerHTML = `<div class="msg">Uploading & executing ${esc(f.name)} (${fmtSize(f.size)}) into <b>${esc(targetDb || 'server')}</b>…</div>`;
        try {
            const fd = new FormData();
            fd.append('db', targetDb || '');
            fd.append('file', f);
            const res = await fetch('api.live.php?a=import_sql_file', { method: 'POST', headers: { 'X-CSRF': csrf }, body: fd });
            const r = await res.json().catch(() => ({ error: 'Invalid server response' }));
            if (r.error && r.ok === undefined) throw new Error(r.error);
            $('#res').innerHTML = !r.ok
                ? `<div class="msg err"><b>Error after ${r.executed} of ${r.total} statements:</b> ${esc(r.error)}${r.failed_sql ? `<br><small>${esc(r.failed_sql)}</small>` : ''}</div>`
                : `<div class="msg ok">Executed all ${r.executed} SQL statements from <b>${esc(f.name)}</b></div>`;
            await loadDbs();
            if (targetDb) await loadTables(targetDb);
            tree();
            if (r.ok) toast('SQL import complete');
        } finally {
            $('#go').disabled = false;
        }
    });
    $('#cf').onchange = guard(async e => {
        const f = e.target.files[0];
        if (!f) return;
        if (targetDb && S.db !== targetDb) S.db = targetDb;
        if (/\.(gz|zip)$/i.test(f.name)) {
            $('#cfg').innerHTML = `<div class="msg">Decompressing ${esc(f.name)}…</div>`;
            const fd = new FormData();
            fd.append('db', targetDb || '');
            fd.append('file', f);
            const res = await fetch('api.live.php?a=decompress_file', { method: 'POST', headers: { 'X-CSRF': csrf }, body: fd });
            const r = await res.json().catch(() => ({ error: 'Decompression failed' }));
            if (!res.ok || r.error) throw new Error(r.error || 'Decompression failed');
            csvWizard(r.text, r.name || f.name, tbls);
        } else {
            csvWizard(await f.text(), f.name, tbls);
        }
    });
}

function csvWizard(text, fname, tbls) {
    const st = { delim: detectDelim(text), header: true, emptyNull: true, target: S.table || (tbls[0]?.name ?? '__new__'), mode: 'insert', newName: fname.replace(/\.[^.]+$/, '').replace(/\W+/g, '_').toLowerCase() || 'imported', tcols: [], map: [], types: [] };
    let rows = [];
    const cfg = $('#cfg');
    const head = () => st.header ? rows[0] : rows[0].map((_, i) => 'column_' + (i + 1));
    const body = () => st.header ? rows.slice(1) : rows;
    const reparse = async () => {
        rows = parseCSV(text, st.delim); if (!rows.length) { cfg.innerHTML = '<div class="msg err">The file is empty</div>'; return; }
        const w = Math.max(...rows.slice(0, 200).map(r => r.length)); rows = rows.map(r => r.length >= w ? r : [...r, ...Array(w - r.length).fill('')]);
        await retarget();
    };
    const retarget = async () => {
        st.tcols = st.target === '__new__' ? [] : (await api('structure', { db: S.db, table: st.target })).columns;
        const names = head();
        if (st.target === '__new__') { st.map = names.map(n => n.trim().replace(/\W+/g, '_') || 'col'); st.types = names.map((_, i) => guessType(body().slice(0, 500).map(r => r[i]))); }
        else st.map = names.map(n => st.tcols.find(c => c.name.toLowerCase() === n.trim().toLowerCase())?.name ?? '');
        draw();
    };
    const draw = () => {
        const names = head(), sample = body().slice(0, 3), isNew = st.target === '__new__';
        cfg.innerHTML = `<div class="ce-grid" style="grid-template-columns:repeat(4,1fr)">
          <label>Delimiter<select id="c-d">${Object.entries(DELIMS).map(([k, v]) => `<option value="${k === '\t' ? 'tab' : k}" ${k === st.delim ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label>Import into<select id="c-t">${tbls.map(t => `<option ${t.name === st.target ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}<option value="__new__" ${isNew ? 'selected' : ''}>+ New table…</option></select></label>
          ${isNew ? `<label>New table name<input id="c-n" value="${esc(st.newName)}"></label>` : `<label>If a row already exists<select id="c-m"><option value="insert" ${st.mode === 'insert' ? 'selected' : ''}>Fail (plain insert)</option><option value="ignore" ${st.mode === 'ignore' ? 'selected' : ''}>Skip duplicates</option><option value="replace" ${st.mode === 'replace' ? 'selected' : ''}>Replace existing</option></select></label>`}
          <label class="pc" style="align-self:end"><input type="checkbox" id="c-h" ${st.header ? 'checked' : ''}><span>First row is header</span></label></div>
        <label class="pc"><input type="checkbox" id="c-e" ${st.emptyNull ? 'checked' : ''}><span>Treat empty values as NULL</span><small>Recommended for number and date columns</small></label>
        <div class="msg">${body().length} data rows · ${names.length} columns detected</div>
        <div class="tw" style="margin-top:8px"><table><tr><th>CSV column</th><th>Sample</th><th>${isNew ? 'New column name' : 'Import into'}</th>${isNew ? '<th>Type</th><th>Length</th>' : ''}</tr>
        ${names.map((n, i) => `<tr><td><b>${esc(n)}</b></td><td style="color:var(--mute)" title="${esc(sample.map(r => r[i]).join(' | '))}">${esc(sample.map(r => r[i]).join(' · '))}</td>
          <td>${isNew ? `<input data-m="${i}" value="${esc(st.map[i])}">` : `<select data-m="${i}"><option value="">— skip —</option>${st.tcols.map(c => `<option ${c.name === st.map[i] ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`}</td>
          ${isNew ? `<td><select data-ty="${i}">${typeGroupsForDriver().flatMap(g => g[1]).filter(t => !['ENUM', 'SET', 'BIT'].includes(t)).map(t => `<option ${t === st.types[i][0] ? 'selected' : ''}>${t}</option>`).join('')}</select></td><td><input data-ln="${i}" size="5" value="${esc(st.types[i][1])}"></td>` : ''}</tr>`).join('')}</table></div>
        <div class="bar" style="margin-top:12px"><button class="primary" id="c-go">Import ${body().length} rows</button><progress id="c-p" max="100" value="0" hidden style="flex:1"></progress></div><div id="c-r"></div>`;
        $('#c-d').onchange = e => { st.delim = e.target.value === 'tab' ? '\t' : e.target.value; reparse(); };
        $('#c-t').onchange = e => { st.target = e.target.value; retarget(); };
        $('#c-h').onchange = e => { st.header = e.target.checked; retarget(); };
        $('#c-e').onchange = e => st.emptyNull = e.target.checked;
        if ($('#c-m')) $('#c-m').onchange = e => st.mode = e.target.value;
        if ($('#c-n')) $('#c-n').oninput = e => st.newName = e.target.value;
        cfg.querySelectorAll('[data-m]').forEach(el => el.onchange = el.oninput = () => st.map[el.dataset.m] = el.value);
        cfg.querySelectorAll('[data-ty]').forEach(el => el.onchange = () => st.types[el.dataset.ty][0] = el.value);
        cfg.querySelectorAll('[data-ln]').forEach(el => el.oninput = () => st.types[el.dataset.ln][1] = el.value);
        $('#c-go').onclick = guard(run);
    };
    const run = async () => {
        const isNew = st.target === '__new__', idx = st.map.map((m, i) => m ? i : -1).filter(i => i >= 0);
        if (!idx.length) throw new Error('Map at least one column');
        if (new Set(idx.map(i => st.map[i].toLowerCase())).size !== idx.length) throw new Error('Two CSV columns map to the same target column');
        const data = body(), table = isNew ? st.newName.trim() : st.target;
        if (!table) throw new Error('Table name required');
        const out = $('#c-r'), prog = $('#c-p'); $('#c-go').disabled = true; prog.hidden = false;
        try {
            if (isNew) {
                await api('create_table', { db: S.db, table, columns: idx.map(i => ({ name: st.map[i], type: st.types[i][0], length: ['VARCHAR', 'CHAR', 'DECIMAL'].includes(st.types[i][0]) ? st.types[i][1] : '', null: true })) });
                await loadTables(S.db); st.target = table;
            }
            const cols = idx.map(i => st.map[i]), CH = 1000; let done = 0;
            for (let o = 0; o < data.length; o += CH) {
                const chunk = data.slice(o, o + CH).map(r => idx.map(i => r[i]));
                try { done += (await api('import_rows', { db: S.db, table, columns: cols, rows: chunk, mode: st.mode, empty_null: st.emptyNull })).imported; }
                catch (e) { throw new Error(`${e.message}\nFailed in rows ${o + 1}–${Math.min(o + CH, data.length)}${st.header ? ' (excluding header)' : ''}. That batch was rolled back; ${done} earlier rows were already imported.`); }
                prog.value = Math.round(Math.min(o + CH, data.length) / data.length * 100);
            }
            out.innerHTML = `<div class="msg ok">Imported ${done} of ${data.length} rows into ${esc(table)}${done < data.length ? ' (the rest were skipped as duplicates)' : ''}.</div>`;
            tree(); toast('Import finished');
        } catch (e) { out.innerHTML = `<div class="msg err" style="white-space:pre-wrap">${esc(e.message)}</div>`; }
        finally { $('#c-go').disabled = false; }
    };
    reparse();
}

async function dropdb() {
    const my = S.driver === 'mysql';
    const dbObj = S.dbs.find(d => d.name === S.db) || {};
    if (!my) {
        C().innerHTML = `<div class="dash-grid" style="max-width:960px">
          <div class="dash-card">
            <h3>🗄 SQLite Database File</h3>
            <div class="kv"><span>Database Name</span><b>${esc(dbObj.label || S.db)}</b></div>
            <div class="kv"><span>Sandbox Path</span><b><code style="font-size:12px;word-break:break-all">${esc(dbObj.path || S.db)}</code></b></div>
            <div class="kv"><span>File Size</span><b>${fmtSize(dbObj.size)}</b></div>
            <div class="kv"><span>Tables & Views</span><b>${dbObj.tables ?? (S.tables[S.db] || []).length}</b></div>
            <div class="bar" style="margin-top:12px;margin-bottom:0">
              <button data-dbm="integrity_check">🔍 Integrity Check</button>
              <button data-dbm="foreign_key_check">🔗 FK Check</button>
              <button data-dbm="analyze">📊 Analyze</button>
              <button data-dbm="vacuum" class="primary">⚡ Vacuum & Compact</button>
            </div>
            <div id="dbm-res"></div>
          </div>
          <div class="dash-card">
            <h3>⚠ Danger Zone</h3>
            <p style="color:var(--mute);font-size:12px">Permanently delete SQLite database file <b>${esc(S.db)}</b> (including its <code>-wal</code> and <code>-shm</code> files) from the sandbox directory.</p>
            <button class="danger" id="dd">Delete SQLite file ${esc(S.db)}</button>
          </div>
        </div>`;
        C().querySelectorAll('[data-dbm]').forEach(b => b.onclick = guard(async () => {
            const op = b.dataset.dbm;
            $('#dbm-res').innerHTML = `<div class="msg">Running <code>${esc(op.toUpperCase())}</code>…</div>`;
            const res = await api('table_maint', { db: S.db, op });
            $('#dbm-res').innerHTML = (res.messages || []).map(m => `<div class="msg ${m.type === 'error' ? 'err' : 'ok'}"><b>${esc(m.op)}</b>: ${esc(m.text)}</div>`).join('');
            if (op === 'vacuum') await loadDbs();
        }));
        $('#dd').onclick = () => confirmDo(`Permanently delete SQLite database file ${S.db}?`, async () => { await api('drop_db', { db: S.db }); S.db = null; await loadDbs(); layout(); toast('SQLite database deleted'); });
        return;
    }
    const curColl = dbObj.collation || getPrefs().collation;
    const tblCount = (S.tables[S.db] || []).filter(t => t.type !== 'VIEW').length;
    C().innerHTML = `<div class="dash-grid" style="max-width:960px">
      <div class="dash-card">
        <h3>⚙ Database Charset & Collation</h3>
        <div class="form">
          <label>Target Charset & Collation<select id="db-coll">${collSelectOpts(curColl)}</select></label>
          <label>Table & Column Conversion Mode (when applying to existing tables)<select id="db-mode">
            <option value="convert">Transcode tables & all text columns (CONVERT TO CHARACTER SET — recommended)</option>
            <option value="table_defaults">Change table defaults only (leave existing columns untouched)</option>
            <option value="binary">Re-label via BINARY (fix raw UTF-8 bytes stored inside latin1 columns)</option>
          </select></label>
          <div class="bar" style="margin:4px 0 0">
            <button class="primary" id="db-save">Save Database Default Only</button>
            <button id="db-conv" ${tblCount ? '' : 'disabled'}>Apply to All Tables & Columns (${tblCount})</button>
          </div>
          <div id="db-warn"></div>
          <div class="sqlprev"><small>SQL preview (hover either button to preview; automatically drops & restores text foreign keys)</small><pre id="db-prev">--</pre></div>
        </div>
      </div>
      <div class="dash-card">
        <h3>⚠ Danger Zone</h3>
        <p style="color:var(--mute);font-size:12px">Permanently drop database <b>${esc(S.db)}</b> and all of its tables.</p>
        <button class="danger" id="dd">Drop database ${esc(S.db)}</button>
      </div>
    </div>`;
    let previewAll = false;
    const updatePreview = async (all = previewAll) => {
        previewAll = all;
        try {
            const mode = all ? $('#db-mode').value : 'db_only';
            const r = await api('alter_db', { db: S.db, collation: $('#db-coll').value, mode, dry: true });
            $('#db-prev').textContent = (r.fk_guards ? `-- Auto-guarding ${r.fk_guards} text foreign key(s) during conversion\n` : '') + r.statements.join(';\n') + ';';
        } catch (e) { $('#db-prev').textContent = '-- ' + e.message; }
    };
    $('#db-coll').onchange = () => updatePreview(previewAll);
    $('#db-mode').onchange = () => updatePreview(true);
    $('#db-save').onmouseenter = () => updatePreview(false);
    $('#db-conv').onmouseenter = () => updatePreview(true);
    updatePreview(false);

    $('#db-save').onclick = guard(async () => {
        await api('alter_db', { db: S.db, collation: $('#db-coll').value, mode: 'db_only' });
        await loadDbs();
        toast('Database default collation updated');
        render();
    });
    $('#db-conv').onclick = () => {
        const coll = $('#db-coll').value, mode = $('#db-mode').value;
        confirmDo(`Convert database ${S.db} and all ${tblCount} table(s) to ${coll}?`, async () => {
            const r = await api('alter_db', { db: S.db, collation: coll, mode });
            await Promise.all([loadDbs(), loadTables(S.db)]);
            if (r.warnings?.length) {
                $('#db-warn').innerHTML = `<div class="msg err">Converted with warnings:<br>${r.warnings.map(esc).join('<br>')}</div>`;
            } else {
                toast(`Converted database and ${r.converted_tables} table(s) to ${coll}`);
                render();
            }
        });
    };
    $('#dd').onclick = () => confirmDo(`Permanently drop database ${S.db}?`, async () => { await api('drop_db', { db: S.db }); S.db = null; await loadDbs(); layout(); });
}

/* ---------- users & grants ---------- */
const PRIV_GROUPS = [
    ['Data', 'Read and change rows', ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'FILE']],
    ['Structure', 'Create and alter objects', ['CREATE', 'ALTER', 'DROP', 'INDEX', 'REFERENCES', 'CREATE TEMPORARY TABLES', 'CREATE VIEW', 'SHOW VIEW', 'CREATE ROUTINE', 'ALTER ROUTINE', 'EXECUTE', 'TRIGGER', 'EVENT']],
    ['Administration', 'Server-level control', ['LOCK TABLES', 'PROCESS', 'RELOAD', 'SHUTDOWN', 'SHOW DATABASES', 'SUPER', 'CREATE USER', 'REPLICATION SLAVE', 'REPLICATION CLIENT']],
];
const PRIV_HELP = { SELECT: 'Read rows', INSERT: 'Add rows', UPDATE: 'Change rows', DELETE: 'Remove rows', FILE: 'Read/write files on the server host', CREATE: 'Create databases/tables', ALTER: 'Alter tables', DROP: 'Drop databases/tables', INDEX: 'Create/drop indexes', REFERENCES: 'Create foreign keys', 'CREATE TEMPORARY TABLES': 'Create temporary tables', 'CREATE VIEW': 'Create views', 'SHOW VIEW': 'See view definitions', 'CREATE ROUTINE': 'Create procedures/functions', 'ALTER ROUTINE': 'Alter/drop routines', EXECUTE: 'Run routines', TRIGGER: 'Manage triggers', EVENT: 'Manage events', 'LOCK TABLES': 'Lock tables', PROCESS: 'See all running queries', RELOAD: 'Flush privileges, logs, caches', SHUTDOWN: 'Shut the server down', 'SHOW DATABASES': 'List all databases', SUPER: 'Powerful admin operations', 'CREATE USER': 'Manage accounts', 'REPLICATION SLAVE': 'Read binary logs', 'REPLICATION CLIENT': 'Ask about replication status' };
const PRESETS = {
    none: ['No access', []],
    read: ['Read only', ['SELECT', 'SHOW VIEW', 'EXECUTE']],
    write: ['Read / write', ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'SHOW VIEW', 'EXECUTE', 'LOCK TABLES', 'CREATE TEMPORARY TABLES']],
    dev: ['Developer', ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP', 'INDEX', 'REFERENCES', 'CREATE VIEW', 'SHOW VIEW', 'CREATE ROUTINE', 'ALTER ROUTINE', 'EXECUTE', 'TRIGGER', 'EVENT', 'LOCK TABLES', 'CREATE TEMPORARY TABLES']],
    all: ['Everything', null],
};
const scopeLabel = s => s.db === '*' ? 'All databases (global)' : s.table === '*' ? s.db : `${s.db}.${s.table}`;
const scopeLevel = s => s.db === '*' ? 'Global' : s.table === '*' ? 'Database' : 'Table';
const acctKey = u => `${u.user}@${u.host}`;

async function users() {
    const my = S.driver === 'mysql';
    const r = await api('users');
    const sel = r.users.find(u => acctKey(u) === S.acct) || r.users[0];
    S.acct = sel ? acctKey(sel) : null;
    const risk = u => u.scopes.some(s => s.db === '*' && s.all) ? 'admin' : u.scopes.some(s => s.db === '*' && s.privs.length) ? 'global' : '';
    const q = (S.userFilter || '').toLowerCase();

    const acctSlots = [];
    for (const a of Object.values(r.lockouts?.accounts || {})) {
        const ipEntries = Object.values(a.by_ip || {});
        if (ipEntries.length) {
            for (const slot of ipEntries) {
                if (slot.locked || slot.attempts > 0) acctSlots.push({ driver: a.driver, user: a.user, ...slot });
            }
        } else if (a.locked || a.attempts > 0) {
            acctSlots.push({ driver: a.driver, user: a.user, ip: a.last_ip || '–', attempts: a.attempts, locked: a.locked, last_failed: a.last_failed });
        }
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const lockedIps = Object.values(r.lockouts?.ips || {}).filter(x => x.locked_until && x.locked_until > nowSec);
    const hasLocks = r.is_admin && (acctSlots.length > 0 || lockedIps.length > 0);
    const adminCoolMin = Math.round((r.admin_lockout_seconds || 900) / 60);

    const lockBanner = hasLocks ? `<div class="dash-card" style="margin-bottom:16px;border-color:var(--danger)">
      <div class="bar" style="margin-bottom:8px">
        <h3 style="margin:0;color:var(--danger)">🔒 Security Lockouts & Failed Login Tracker</h3>
        <span class="badge warn">${acctSlots.filter(a => a.locked).length} locked (account+IP) · ${acctSlots.length} tracked · ${lockedIps.length} IP cooldown(s)</span>
        <span class="spacer"></span>
        <button id="ul-all" class="primary">🔓 Clear All Lockouts</button>
      </div>
      <small style="color:var(--mute);display:block;margin-bottom:8px">Lockouts are isolated per <b>(Account + Client IP)</b> so an external attacker cannot lock out an administrator on another IP. Full-privilege admins also self-recover after a ${adminCoolMin}m cooldown or via CLI: <code>php public/api.php --unlock</code>.</small>
      <div class="tw"><table>
        <tr><th>Account</th><th>Engine</th><th>Source IP</th><th>Status</th><th>Failed Attempts</th><th>Last Attempt</th><th></th></tr>
        ${acctSlots.map(a => `<tr>
          <td><b>${esc(a.user)}</b></td>
          <td><span class="badge">${esc(a.driver)}</span></td>
          <td><code>${esc(a.ip || '–')}</code></td>
          <td>${a.locked ? '<span class="lvl lvl-global">LOCKED (IP)</span>' : '<span class="badge warn">Warning</span>'}</td>
          <td>${a.attempts} / ${r.max_login_attempts || 5}</td>
          <td>${a.last_failed ? new Date(a.last_failed * 1000).toLocaleString() : '–'}</td>
          <td class="act"><button data-ul-u="${esc(a.user)}" data-ul-d="${esc(a.driver)}" data-ul-ip="${esc(a.ip || '')}" class="primary">${a.locked ? '🔓 Unlock IP' : 'Reset'}</button></td>
        </tr>`).join('')}
        ${lockedIps.map(ip => `<tr>
          <td><b>All Accounts</b></td>
          <td><span class="badge">IP Cooldown</span></td>
          <td><code>${esc(ip.ip)}</code></td>
          <td><span class="lvl lvl-global">RATE LIMITED</span></td>
          <td>${ip.attempts} (last: <code>${esc(ip.last_user || '–')}</code>)</td>
          <td>Until ${new Date(ip.locked_until * 1000).toLocaleTimeString()}</td>
          <td class="act"><button data-ul-only-ip="${esc(ip.ip)}" class="primary">🔓 Unblock IP</button></td>
        </tr>`).join('')}
      </table></div>
    </div>` : '';

    C().innerHTML = `${lockBanner}<div class="acct-layout"><div class="acct-list"><div class="bar"><input id="uf" placeholder="Find account…" value="${esc(S.userFilter || '')}" style="flex:1"><button class="primary" id="nu">+ New</button></div>
      ${r.users.filter(u => !q || acctKey(u).toLowerCase().includes(q)).map(u => {
          const isLocked = u.fandejo_locked || u.db_locked;
          return `<div class="acct ${acctKey(u) === S.acct ? 'active' : ''}" data-k="${esc(acctKey(u))}"><div class="avatar">${esc((u.user || '?')[0].toUpperCase())}</div><div style="min-width:0"><div class="nm">${esc(u.user || '(anonymous)')}</div><small>@${esc(u.host)}</small></div>${isLocked ? '<span class="lvl lvl-global" style="margin-left:auto" title="Account has an active lockout">🔒 locked</span>' : (risk(u) === 'admin' ? '<span class="badge warn">admin</span>' : (u.failed_attempts ? `<span class="badge warn" title="${u.failed_attempts} failed sign-in attempt(s)">${u.failed_attempts} fail</span>` : ''))}</div>`;
      }).join('')}</div>
      <div class="acct-detail" id="ad"></div></div>`;
    $('#uf').oninput = e => { S.userFilter = e.target.value; users(); setTimeout(() => { const i = $('#uf'); i.focus(); i.setSelectionRange(99, 99); }); };
    C().querySelectorAll('.acct').forEach(el => el.onclick = () => { S.acct = el.dataset.k; users(); });
    if ($('#ul-all')) $('#ul-all').onclick = () => confirmDo('Clear all Fandejo login lockouts and IP rate-limit counters?', async () => { await api('unlock_account', { clear_all: true }); toast('All lockouts cleared'); users(); });
    C().querySelectorAll('[data-ul-u]').forEach(b => b.onclick = guard(async () => {
        await api('unlock_account', { user: b.dataset.ulU, driver: b.dataset.ulD, ip: b.dataset.ulIp });
        toast(`Unlocked ${b.dataset.ulU} (${b.dataset.ulIp})`); users();
    }));
    C().querySelectorAll('[data-ul-only-ip]').forEach(b => b.onclick = guard(async () => {
        await api('unlock_account', { ip: b.dataset.ulOnlyIp });
        toast(`Unblocked IP ${b.dataset.ulOnlyIp}`); users();
    }));
    $('#nu').onclick = () => modal(`<h3>New ${my ? 'database' : 'SQLite administrator'} account</h3><label>Username<input name="user" required autofocus></label>${my ? `<label>Host<input name="host" value="localhost"><small>Use % for any host</small></label>` : ''}<label>Password<input name="pass" type="password" placeholder="${my ? '' : 'Min 6 characters'}" required></label>${my ? `<label>Grant all on database (optional)<select name="grant_db"><option value="">–</option>${S.dbs.map(d => `<option>${esc(d.name)}</option>`).join('')}</select></label>` : '<small style="color:var(--mute)">Stored in <code>config.php</code> with an Argon2id password hash.</small>'}`, async v => { await api('create_user', v); S.acct = `${v.user}@${my ? v.host : 'sqlite-sandbox'}`; toast('Account created'); users(); });
    if (sel) await accountDetail(sel, r.me, r.is_admin, r.max_login_attempts || 5);
    else $('#ad').innerHTML = '<div class="empty">No accounts</div>';
}

async function accountDetail(u, me, isAdmin = true, maxAttempts = 5) {
    const my = S.driver === 'mysql';
    const g = my ? await api('user_grants', { user: u.user, host: u.host }) : { scopes: u.scopes || [], catalog: {} };
    const isMe = u.user === me;
    const isLocked = u.fandejo_locked || u.db_locked;
    const lockedIpsList = (u.by_ip || []).filter(s => s.locked).map(s => s.ip);

    const unlockBtnLabel = (u.fandejo_locked && u.db_locked) ? '🔓 Unlock Account & IPs'
        : (u.fandejo_locked ? '🔓 Unlock All IPs'
        : (u.db_locked ? '🔓 Unlock Server Account' : 'Reset Counter'));

    const lockAlert = (u.fandejo_locked || u.db_locked || u.failed_attempts > 0) ? `<div class="msg ${isLocked ? 'err' : ''}" style="display:flex;align-items:center;gap:10px;margin-top:14px">
      <div style="flex:1">
        ${u.fandejo_locked ? `<b>🔒 Per-IP Hard Lockout Active:</b> Locked for IP${lockedIpsList.length > 1 ? 's' : ''} <code>${esc(lockedIpsList.join(', ') || u.last_ip || 'unknown')}</code> (${u.failed_attempts} total failed attempts). ` : ''}
        ${u.db_locked ? `<b>🔒 Database Engine Lock:</b> This MySQL/MariaDB user has <code>ACCOUNT LOCK</code> enabled on the server. ` : ''}
        ${!isLocked && u.failed_attempts ? `<b>⚠ Failed Sign-in Attempts:</b> ${u.failed_attempts} failed attempt(s) tracked (last IP: <code>${esc(u.last_ip || '–')}</code>; locks at ${maxAttempts} per IP).` : ''}
      </div>
      ${isAdmin ? `<button id="u-unlock" class="primary">${unlockBtnLabel}</button>` : ''}
    </div>` : '';

    $('#ad').innerHTML = `<div class="acct-head"><div class="avatar big">${esc((u.user || '?')[0].toUpperCase())}</div><div style="flex:1"><h2 style="margin:0">${esc(u.user || '(anonymous)')}<span style="color:var(--mute)">@${esc(u.host)}</span></h2><small>${isMe ? 'This is the account you are signed in with' : (my ? `${g.scopes.length} privilege scope${g.scopes.length === 1 ? '' : 's'}` : 'SQLite Sandbox Administrator (config.php)')}</small></div>
      ${my && isAdmin && !u.db_locked ? `<button id="dblock" class="ghost danger" title="Lock account at the MySQL/MariaDB server level (ALTER USER … ACCOUNT LOCK)">🔒 Server Lock</button>` : ''}
      <button id="pw">Change password</button><button id="du" class="danger">Drop</button></div>
      ${lockAlert}
      ${my ? `<div class="bar" style="margin-top:20px"><h3 style="margin:0">Privileges</h3><span class="spacer"></span><button class="primary" id="ap">+ Add privileges</button></div>
      ${g.scopes.length ? g.scopes.map((s, i) => `<div class="scope"><div class="scope-top"><span class="lvl lvl-${scopeLevel(s).toLowerCase()}">${scopeLevel(s)}</span><b>${esc(scopeLabel(s))}</b><span class="spacer"></span>${s.option ? '<span class="badge warn">GRANT OPTION</span>' : ''}<button class="ghost" data-e="${i}">Edit</button><button class="ghost danger" data-r="${i}">Revoke all</button></div>
        <div class="chips">${s.all ? '<span class="chip all">ALL PRIVILEGES</span>' : s.privs.map(x => `<span class="chip">${esc(x)}</span>`).join('') || '<span class="chip none">USAGE (no privileges)</span>'}${s.columns.map(x => `<span class="chip col" title="Column-level (read-only here)">${esc(x)}</span>`).join('')}${s.other.map(x => `<span class="chip col" title="Not editable here">${esc(x)}</span>`).join('')}</div></div>`).join('') : '<div class="empty">This account has no privileges</div>'}`
      : `<div class="scope" style="margin-top:18px"><div class="scope-top"><span class="lvl lvl-global">SQLite Catalog</span><b>All sandboxed SQLite directories</b></div><div class="chips"><span class="chip all">FULL SANDBOX ACCESS</span><span class="chip">Argon2id Auth</span></div></div>`}`;
    const reload = () => users();
    if ($('#u-unlock')) $('#u-unlock').onclick = guard(async () => {
        await api('unlock_account', { user: u.user, host: u.host, driver: S.driver, db_unlock: !!u.db_locked });
        toast(`Account ${acctKey(u)} unlocked`);
        reload();
    });
    if ($('#dblock')) $('#dblock').onclick = () => confirmDo(`Lock ${acctKey(u)} at the database server level (ALTER USER … ACCOUNT LOCK)?`, async () => {
        await api('unlock_account', { user: u.user, host: u.host, driver: S.driver, db_lock: true });
        toast(`Account ${acctKey(u)} locked on server`);
        reload();
    });
    $('#pw').onclick = () => modal(`<h3>Change password</h3><p style="color:var(--mute)">${esc(acctKey(u))}</p><label>New password<input name="pass" type="password" required autofocus></label>`, async v => { await api('set_password', { ...u, pass: v.pass }); toast('Password changed'); });
    $('#du').onclick = () => confirmDo(`Drop account ${acctKey(u)}? This cannot be undone.${isMe ? ' WARNING: this is the account you are signed in with.' : ''}`, async () => { await api('drop_user', u); S.acct = null; toast('Account dropped'); reload(); });
    if (my) {
        $('#ad').querySelectorAll('[data-e]').forEach(b => b.onclick = () => grantEditor(u, g.scopes[b.dataset.e], g.catalog, me, reload));
        $('#ad').querySelectorAll('[data-r]').forEach(b => b.onclick = () => { const s = g.scopes[b.dataset.r]; confirmDo(`Revoke all privileges on ${scopeLabel(s)} from ${acctKey(u)}?`, async () => { await api('set_grants', { ...u, scope_db: s.db, scope_table: s.table, privileges: [], grant_option: false }); toast('Privileges revoked'); reload(); }); });
        $('#ap').onclick = () => scopePicker(u, g, me, reload);
    }
}

function scopePicker(u, g, me, reload) {
    modal(`<h3>Add privileges</h3><label>Where should they apply?<select name="db" id="sdb"><option value="*">All databases (global)</option>${S.dbs.map(d => `<option>${esc(d.name)}</option>`).join('')}</select></label>
      <label id="stl" hidden>Table<select name="table" id="stb"><option value="*">All tables in database</option></select></label>`, async v => {
        const db = v.db, table = db === '*' ? '*' : v.table || '*';
        const ex = g.scopes.find(s => s.db === db && s.table === table);
        grantEditor(u, ex || { db, table, privs: [], all: false, option: false, columns: [], other: [] }, g.catalog, me, reload);
    });
    $('#sdb').onchange = guard(async e => {
        const db = e.target.value; $('#stl').hidden = db === '*';
        if (db !== '*') { if (!S.tables[db]) await loadTables(db); $('#stb').innerHTML = '<option value="*">All tables in database</option>' + S.tables[db].filter(t => t.type !== 'VIEW' || true).map(t => `<option>${esc(t.name)}</option>`).join(''); }
    });
}

function grantEditor(u, s, catalog, me, reload) {
    const cat = s.db === '*' ? catalog.global : s.table === '*' ? catalog.db : catalog.table;
    const groups = PRIV_GROUPS.map(([n, d, l]) => [n, d, l.filter(x => cat.includes(x))]).filter(x => x[2].length);
    const cur = new Set(s.privs);
    const html = `<div style="width:min(720px,80vw)"><h3 style="margin-bottom:2px">Edit privileges</h3><div style="color:var(--mute);margin-bottom:12px">${esc(acctKey(u))} on <b style="color:var(--text)">${esc(scopeLabel(s))}</b> <span class="lvl lvl-${scopeLevel(s).toLowerCase()}">${scopeLevel(s)}</span></div>
      <div class="presets">${Object.entries(PRESETS).map(([k, [l]]) => `<button type="button" class="preset" data-p="${k}">${l}</button>`).join('')}</div>
      ${groups.map(([n, d, l]) => `<fieldset class="pg"><legend>${n} <small>${d}</small> <a href="#" data-g="${esc(n)}">toggle</a></legend><div class="pgrid" data-grp="${esc(n)}">${l.map(x => `<label class="pc" title="${esc(PRIV_HELP[x] || '')}"><input type="checkbox" name="p_${esc(x)}" ${cur.has(x) ? 'checked' : ''}><span>${esc(x)}</span><small>${esc(PRIV_HELP[x] || '')}</small></label>`).join('')}</div></fieldset>`).join('')}
      <label class="pc opt"><input type="checkbox" name="grant_option" ${s.option ? 'checked' : ''}><span>GRANT OPTION</span><small>Allow this account to give these privileges to others</small></label>
      ${s.columns.length || s.other.length ? `<div class="msg">Preserved (not editable here): ${esc([...s.columns, ...s.other].join(', '))}</div>` : ''}
      ${s.db === '*' && u.user === me ? '<div class="msg err">You are editing your own global privileges. Removing them can lock you out.</div>' : ''}
      <div class="sqlprev"><small>SQL preview</small><pre id="prev">…</pre></div></div>`;
    modal(html, async () => {
        const body = collect(); const r = await api('set_grants', body);
        toast(r.statements.length ? 'Privileges updated' : 'No changes'); reload();
    });
    const form = $('#modal form');
    const boxes = () => [...form.querySelectorAll('input[name^=p_]')];
    const collect = () => ({ user: u.user, host: u.host, scope_db: s.db, scope_table: s.table, privileges: boxes().filter(b => b.checked).map(b => b.name.slice(2)), grant_option: form.grant_option.checked });
    let t;
    const preview = () => { clearTimeout(t); t = setTimeout(guard(async () => { const r = await api('set_grants', { ...collect(), dry: true }); $('#prev').textContent = r.statements.length ? r.statements.join(';\n') + ';' : '-- no changes'; }), 150); };
    form.addEventListener('change', preview);
    form.querySelectorAll('.preset').forEach(b => b.onclick = () => { const l = PRESETS[b.dataset.p][1]; boxes().forEach(x => x.checked = l === null || l.includes(x.name.slice(2))); preview(); });
    form.querySelectorAll('[data-g]').forEach(a => a.onclick = e => { e.preventDefault(); const bs = [...form.querySelectorAll(`[data-grp="${a.dataset.g}"] input`)]; const on = bs.some(x => !x.checked); bs.forEach(x => x.checked = on); preview(); });
    preview();
}
function fmtUptime(sec) {
    if (!sec) return '–';
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    return (d ? d + 'd ' : '') + (h ? h + 'h ' : '') + m + 'm';
}

async function processesView() {
    if (S.driver !== 'mysql') { C().innerHTML = '<div class="empty">Live processlist is available for MySQL / MariaDB only.</div>'; return; }
    const r = await api('processlist');
    const procs = r.processes || [];
    const hideSleep = !!S.hideSleepProcs;
    const shown = procs.filter(p => !hideSleep || (p.Command || '').toLowerCase() !== 'sleep');
    C().innerHTML = `<div class="bar">
      <h3 style="margin:0">⚡ Live Server Processlist (${shown.length} / ${procs.length} threads)</h3>
      <label class="pc" style="margin-left:12px;padding:4px 10px"><input type="checkbox" id="pl-sleep" ${hideSleep ? 'checked' : ''}><span>Hide Sleeping connections</span></label>
      <span class="spacer"></span>
      <button class="primary" id="pl-ref">↻ Refresh</button>
    </div>
    <div class="tw"><table>
      <tr><th>ID</th><th>User</th><th>Host</th><th>Database</th><th>Command</th><th>Time (s)</th><th>State</th><th>Query / Info</th><th></th></tr>
      ${shown.map(p => {
          const isMe = +p.Id === +r.my_id;
          return `<tr>
            <td><b>${esc(p.Id)}</b>${isMe ? ' <span class="badge">you</span>' : ''}</td>
            <td>${esc(p.User)}</td>
            <td><code>${esc(p.Host)}</code></td>
            <td>${esc(p.db || '–')}</td>
            <td><span class="badge ${(p.Command || '') === 'Query' ? 'warn' : ''}">${esc(p.Command)}</span></td>
            <td>${esc(p.Time)}</td>
            <td><small>${esc(p.State || '–')}</small></td>
            <td title="${esc(p.Info || '')}"><code>${esc(p.Info || '–')}</code></td>
            <td class="act">${!isMe ? `<button class="ghost" data-kq="${p.Id}" title="Cancel running query only (KILL QUERY)">⏹ Stop Query</button><button class="ghost danger" data-kp="${p.Id}" title="Disconnect thread (KILL CONNECTION)">✕ Kill</button>` : ''}</td>
          </tr>`;
      }).join('')}
    </table></div>`;
    $('#pl-ref').onclick = () => processesView();
    $('#pl-sleep').onchange = e => { S.hideSleepProcs = e.target.checked; processesView(); };
    C().querySelectorAll('[data-kq]').forEach(b => b.onclick = () => confirmDo(`Stop running query on thread #${b.dataset.kq} (KILL QUERY)?`, async () => {
        await api('kill_process', { id: +b.dataset.kq, query_only: true });
        toast(`Stopped query on #${b.dataset.kq}`);
        processesView();
    }));
    C().querySelectorAll('[data-kp]').forEach(b => b.onclick = () => confirmDo(`Terminate connection #${b.dataset.kp} (KILL)?`, async () => {
        await api('kill_process', { id: +b.dataset.kp });
        toast(`Killed connection #${b.dataset.kp}`);
        processesView();
    }));
}

async function dbsHome() {
    const info = await api('server_info');
    const my = S.driver === 'mysql';
    const totalTables = S.dbs.reduce((a, d) => a + (+d.tables || 0), 0);
    const totalSize = S.dbs.reduce((a, d) => a + (+d.size || 0), 0) || info.file_size || 0;

    const DOCS = {
        quickstart: [`🔥 Fandejo Quickstart Guide`, `<p>Welcome to <b>Fandejo</b> (<i>fahn-DAY-oh</i>, Esperanto for "foundry") — a fast, modern web workbench for MariaDB, MySQL, and SQLite3 built for PHP 8.5+ with zero external framework overhead.</p>
          <h4>Common Workflows</h4>
          <ul>
            <li><b>Browse & Filter:</b> Click any database in the left sidebar to expand its tables. Inside a table's <b>Browse</b> tab, type in the search bar and press <code>Enter</code> to filter across all columns, or click any column header to sort.</li>
            <li><b>Schema Design:</b> Use the <b>Structure</b> tab on any table to add/edit columns, manage composite or unique indexes, and wire up foreign key constraints—all with a live SQL preview before changes are committed.</li>
            <li><b>CSV Import & Export:</b> Import CSV files into an existing table (with duplicate skipping or replacement) or let Fandejo auto-detect column types and create a brand-new table for you.</li>
            <li><b>SQL Scratchpad:</b> Run multi-statement scripts, highlight a snippet to execute only the selection, and bookmark frequent queries in the <b>★ Saved</b> sidebar.</li>
          </ul>`],
        shortcuts: [`⌨ Keyboard Shortcuts & Tips`, `<table>
          <tr><th>Shortcut / Action</th><th>What it does</th></tr>
          <tr><td><code>Ctrl + Enter</code> / <code>Cmd + Enter</code></td><td>Execute all statements (or highlighted selection) in the SQL editor</td></tr>
          <tr><td><code>Enter</code> (in Browse search box)</td><td>Run full-table search across all columns</td></tr>
          <tr><td>Click column chip (in SQL editor)</td><td>Insert properly quoted column identifier at cursor</td></tr>
          <tr><td>Click <code>Fandejo</code> or <code>⌂ Home</code></td><td>Return to this server dashboard from anywhere</td></tr>
          <tr><td>Click breadcrumb database name</td><td>Exit current table back to the database overview</td></tr>
        </table>`],
        privileges: [`🔐 User Accounts & Grants Guide`, `<p>MySQL and MariaDB identify accounts by the combination of <b>username</b> and <b>client host</b> (e.g. <code>app@localhost</code> vs <code>app@%</code>).</p>
          <ul>
            <li><b>Global privileges (<code>*.*</code>):</b> Apply to every database on the server. Reserve these for administrators.</li>
            <li><b>Database privileges (<code>db.*</code>):</b> Apply to all tables inside a single database. Ideal for application service accounts using the <b>Read / write</b> or <b>Developer</b> preset.</li>
            <li><b>Table privileges (<code>db.table</code>):</b> Restrict an account to specific tables for fine-grained access control.</li>
          </ul>`],
        arch: [`🏗 Fandejo Architecture & Security`, `<p>Fandejo was designed as a clean replacement for legacy phpMyAdmin installations on modern PHP 8.5+ environments:</p>
          <ul>
            <li><b>Backend:</b> Single-file PDO JSON API (<code>public/api.php</code>) using strict types, prepared statements, identifier quoting, split-key Libsodium session encryption, and per-session CSRF tokens.</li>
            <li><b>Frontend:</b> Dependency-free ES module SPA (<code>public/app.js</code>) with Obsidian Dark & Daylight Foundry themes and local query storage.</li>
          </ul>`]
    };

    C().innerHTML = `<div class="dash">
      <div class="dash-hero">
        <div>
          <span class="badge">Connected to ${esc(info.server_name)}</span>
          <h2>Welcome to Fandejo, ${esc(info.my_user || S.user || 'admin')}</h2>
          <p style="color:var(--mute);margin:4px 0 0">Cast, inspect, and query your databases in one workspace.</p>
        </div>
        <div class="dash-kpis">
          <div class="kpi"><span>${S.dbs.length}</span><small>Databases</small></div>
          <div class="kpi"><span>${totalTables}</span><small>Tables</small></div>
          <div class="kpi"><span>${fmtSize(totalSize)}</span><small>Total Size</small></div>
          ${my ? `<div class="kpi"><span>${fmtUptime(info.uptime)}</span><small>Uptime</small></div>` : ''}
        </div>
      </div>

      <div class="dash-grid">
        <div class="dash-card">
          <h3>🗄 Database Server</h3>
          <div class="kv"><span>Engine</span><b>${esc(info.server_name)} ${esc(info.server_version)}</b></div>
          ${info.version_comment ? `<div class="kv"><span>Distribution</span><b>${esc(info.version_comment)}</b></div>` : ''}
          <div class="kv"><span>${my ? 'Host & Port' : 'Sandbox Directories'}</span><b><code style="font-size:12px;word-break:break-all">${esc(info.host)}</code></b></div>
          <div class="kv"><span>Server Charset</span><b>${esc(info.charset)}</b></div>
          ${my ? `<div class="kv"><span>Active Threads / Max</span><b>${info.threads} / ${info.max_connections} <a href="#" id="d-pl" class="crumb" style="margin-left:6px">View Processes →</a></b></div>
          <div class="kv"><span>Total Queries / Slow</span><b>${Number(info.questions).toLocaleString()} (${info.slow_queries} slow)</b></div>
          ${info.socket ? `<div class="kv"><span>Socket</span><b>${esc(info.socket)}</b></div>` : ''}`
          : `<div class="kv"><span>Journal Mode</span><b>${esc(info.journal_mode)}</b></div>
          <div class="kv"><span>Foreign Keys</span><b>${info.foreign_keys_on ? 'Enabled' : 'Disabled'}</b></div>
          <div class="bar" style="margin-top:12px;margin-bottom:0"><button id="d-dirs">📁 Manage Sandbox Directories…</button></div>`}
        </div>

        <div class="dash-card">
          <h3>👤 Current Account & Session</h3>
          <div class="acct-head" style="margin:6px 0 14px">
            <div class="avatar big">${esc((info.my_user || S.user || 'U')[0].toUpperCase())}</div>
            <div>
              <div style="font-weight:700;font-size:16px">${esc(info.current_user)}</div>
              <small style="color:var(--mute)">Connected as ${esc(info.user)}</small>
            </div>
          </div>
          <div class="kv"><span>Authentication</span><b>${my ? 'Libsodium Split-Key + CSRF' : 'Config Argon2id + Split-Key + CSRF'}</b></div>
          <div class="kv"><span>Brute-Force Policy</span><b>Lockout at ${info.max_login_attempts || 5} fails · ${Math.round((info.session_idle_ttl || 3600) / 60)}m idle timeout</b></div>
          ${info.locked_accounts_count ? `<div class="kv"><span style="color:var(--danger)">Locked Accounts</span><b><a href="#" id="d-lck" class="crumb" style="color:var(--danger)">🔒 ${info.locked_accounts_count} account(s) locked — Manage →</a></b></div>` : ''}
          <div class="kv"><span>Theme</span><b>${document.documentElement.dataset.theme === 'light' ? 'Light mode' : 'Dark mode'} <a href="#" id="d-th" class="crumb" style="margin-left:6px">Switch</a></b></div>
          <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--line)">
            <small style="color:var(--mute);font-weight:600">Default Preferences (saved in browser)</small>
            <div class="ce-grid" style="margin-top:6px;margin-bottom:0">
              ${my ? `<label>Default Engine<select id="p-eng">${engineSelectOpts(getPrefs().engine)}</select></label>
              <label>Default Collation<select id="p-coll">${collSelectOpts(getPrefs().collation)}</select></label>` : ''}
              <label>Rows per Page<select id="p-per">${[25, 50, 100, 250].map(n => `<option value="${n}" ${n === +getPrefs().perPage ? 'selected' : ''}>${n} rows</option>`).join('')}</select></label>
            </div>
          </div>
          <div class="bar" style="margin-top:14px;margin-bottom:0">
            <button id="d-pw">🔑 Change password</button>
            ${my ? `<button id="d-gr">🛡 My privileges</button>` : ''}
            <button id="d-out" class="danger">⏻ Sign out</button>
          </div>
        </div>

        <div class="dash-card">
          <h3>⚙ Web Server & PHP Runtime</h3>
          <div class="kv"><span>PHP Version</span><b>${esc(info.php_version)} (${esc(info.php_sapi)})</b></div>
          <div class="kv"><span>Operating System</span><b>${esc(info.os)}</b></div>
          <div class="kv"><span>Memory Limit</span><b>${info.memory_limit === '-1' ? 'Unlimited (-1)' : esc(info.memory_limit)}</b></div>
          <div class="kv"><span>Max Upload Size</span><b>${esc(info.upload_max_filesize)}</b></div>
          <div style="margin-top:10px"><small style="color:var(--mute)">Loaded database & core extensions</small>
            <div class="chips" style="margin-top:6px">${info.extensions.map(e => `<span class="chip">${esc(e)}</span>`).join('')}</div>
          </div>
        </div>

        <div class="dash-card">
          <h3>📚 Documentation, Wiki & Guides</h3>
          <p style="color:var(--mute);font-size:12px;margin-top:0">Reference guides, keyboard shortcuts, and external SQL manuals.</p>
          <div class="doc-links">
            <a href="#" class="doc-item" data-doc="quickstart"><span>🔥</span><div><b>Fandejo Quickstart Guide</b><small>Tour of browsing, schema editing, and CSV workflows</small></div></a>
            <a href="#" class="doc-item" data-doc="shortcuts"><span>⌨</span><div><b>Keyboard Shortcuts & Tips</b><small>Speed up daily query and table tasks</small></div></a>
            <a href="#" class="doc-item" data-doc="privileges"><span>🔐</span><div><b>User Accounts & Grants Wiki</b><small>Understanding global, database, and table scopes</small></div></a>
            <a href="#" class="doc-item" data-doc="arch"><span>🏗</span><div><b>Architecture & Security Notes</b><small>How Fandejo runs on PHP 8.5+ without legacy bloat</small></div></a>
          </div>
          <div class="bar" style="margin-top:12px;margin-bottom:0;font-size:12px">
            <span style="color:var(--mute)">Official SQL manuals:</span>
            <a href="https://mariadb.com/kb/en/documentation/" target="_blank" rel="noopener" class="crumb">MariaDB KB ↗</a> ·
            <a href="https://dev.mysql.com/doc/" target="_blank" rel="noopener" class="crumb">MySQL Docs ↗</a> ·
            <a href="https://www.sqlite.org/docs.html" target="_blank" rel="noopener" class="crumb">SQLite Docs ↗</a>
          </div>
        </div>
      </div>

      <div class="dash-card" style="margin-top:18px">
        <div class="bar" style="margin-bottom:10px">
          <h3 style="margin:0">🗄 Databases Overview</h3>
          <span class="spacer"></span>
          ${!my ? `<button id="d-dirs2">📁 Sandbox Directories</button>` : ''}
          <button class="primary" id="d-newdb">+ New database</button>
          <button id="d-sql">▶ Open SQL Console</button>
        </div>
        ${S.dbs.length ? `<div class="db-cards">
          ${S.dbs.map(d => `<div class="db-card" data-db="${esc(d.name)}" title="${esc(d.path || d.name)}">
            <div style="font-weight:700">🗄 ${esc(d.label || d.name)}</div>
            <small style="color:var(--mute)">${d.tables ?? 0} tables · ${fmtSize(d.size)}</small>
            ${!my && S.sqliteDirs?.length > 1 && d.dir ? `<small style="display:block;color:var(--mute);font-size:11px;opacity:.75;overflow:hidden;text-overflow:ellipsis">${esc(d.dir)}</small>` : ''}
          </div>`).join('')}
        </div>` : `<div class="empty">No SQLite databases in sandbox directory yet — click <b>+ New database</b> or <b>📁 Sandbox Directories</b> to add an existing project folder.</div>`}
      </div>
    </div>`;

    $('#d-th').onclick = e => { e.preventDefault(); $('#theme').click(); dbsHome(); };
    if ($('#d-pl')) $('#d-pl').onclick = e => { e.preventDefault(); S.db = null; S.table = null; S.tab = 'processes'; render(); };
    if ($('#d-lck')) $('#d-lck').onclick = e => { e.preventDefault(); S.db = null; S.table = null; S.tab = 'users'; render(); };
    if ($('#d-dirs')) $('#d-dirs').onclick = guard(manageSqliteDirs);
    if ($('#d-dirs2')) $('#d-dirs2').onclick = guard(manageSqliteDirs);
    if ($('#p-eng')) $('#p-eng').onchange = e => { savePrefs({ engine: e.target.value }); toast('Default engine saved'); };
    if ($('#p-coll')) $('#p-coll').onchange = e => { savePrefs({ collation: e.target.value }); toast('Default collation saved'); };
    if ($('#p-per')) $('#p-per').onchange = e => { savePrefs({ perPage: +e.target.value }); toast('Default page size saved'); };
    $('#d-out').onclick = () => $('#out').click();
    $('#d-sql').onclick = () => { S.tab = 'sql'; render(); };
    if ($('#d-newdb')) $('#d-newdb').onclick = () => $('#newdb').click();
    if ($('#d-pw')) $('#d-pw').onclick = () => modal(`<h3>Change your password</h3><p style="color:var(--mute)">Account: <b>${esc(info.current_user)}</b></p><label>New password<input name="pass" type="password" required autofocus></label>`, async v => {
        await api('change_own_password', { pass: v.pass });
        toast('Your password was updated');
    });
    if ($('#d-gr')) $('#d-gr').onclick = () => {
        S.acct = `${info.my_user}@${info.my_host}`;
        S.db = null; S.table = null; S.tab = 'users'; render();
    };
    C().querySelectorAll('[data-doc]').forEach(a => a.onclick = e => {
        e.preventDefault();
        const [title, body] = DOCS[a.dataset.doc];
        modal(`<div style="width:min(620px,80vw)"><h3>${title}</h3><div class="doc-body">${body}</div></div>`, async () => {});
    });
    C().querySelectorAll('.db-card').forEach(c => c.onclick = guard(async () => {
        S.db = c.dataset.db; S.table = null; S.tab = 'tables';
        await loadTables(S.db); render();
    }));
}

document.documentElement.dataset.theme = localStorage.theme || '';
boot();
