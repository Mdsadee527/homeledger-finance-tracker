/* ============================================================
   HomeLedger — household income & expense manager
   Single-user, client-side. Data lives in localStorage per user.
   No build step, no server — open index.html in a browser.
   ============================================================ */
'use strict';

/* ------------------------------------------------------------
   Constants
   ------------------------------------------------------------ */
const DEFAULT_INCOME_CATS = ['Salary', 'Business Profit', 'Freelancing', 'Rent Income', 'Other Income'];
const DEFAULT_EXPENSE_CATS = [
  'Groceries', 'House Rent', 'Electricity Bill', 'Water Bill', 'Gas Bill',
  'Internet/Mobile Recharge', 'Education', 'Medical', 'Transportation', 'Shopping',
  'Entertainment', 'EMI/Loan', 'Family Expenses', 'Other Expenses'
];
const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'Debit Card', 'Credit Card', 'UPI', 'Mobile Wallet', 'Cheque', 'Other'];
const PALETTE = ['#4f46e5', '#16a34a', '#e11d48', '#d97706', '#0891b2', '#7c3aed', '#db2777',
  '#059669', '#ca8a04', '#2563eb', '#dc2626', '#65a30d', '#9333ea', '#0d9488', '#ea580c', '#4338ca'];
const TITLES = {
  dashboard: 'Dashboard', income: 'Income', expenses: 'Expenses',
  transactions: 'Transactions', budget: 'Monthly Budget',
  reports: 'Reports & Analytics', savings: 'Savings', calendar: 'Calendar',
  categories: 'Categories', settings: 'Settings'
};

/* Category icons — used for visual flair only, never for logic */
const CAT_ICONS = {
  'Salary': '💼', 'Business Profit': '📈', 'Freelancing': '💻', 'Rent Income': '🏠', 'Other Income': '💰',
  'Groceries': '🛒', 'House Rent': '🏠', 'Electricity Bill': '💡', 'Water Bill': '🚰', 'Gas Bill': '🔥',
  'Internet/Mobile Recharge': '📶', 'Education': '🎓', 'Medical': '🩺', 'Transportation': '🚗', 'Shopping': '🛍️',
  'Entertainment': '🎬', 'EMI/Loan': '🏦', 'Family Expenses': '👨‍👩‍👧', 'Other Expenses': '🧾',
};
function catIcon(name, type) { return CAT_ICONS[name] || (type === 'income' ? '💵' : '💳'); }

/* Count-up flourish for dashboard numbers.
   The final value is written to the DOM first (in the HTML and again here), so if
   rAF never runs or stalls — background tab, Low Power Mode — the correct number
   is always what shows. The animation only ever overwrites it transiently. */
function animateCounters(scope) {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hidden = typeof document !== 'undefined' && document.hidden;
  $$('[data-count]', scope || document).forEach(el => {
    const target = parseFloat(el.dataset.count);
    const display = el.dataset.display || money(target);
    el.textContent = display;
    if (reduce || hidden || isNaN(target)) return;
    const dur = 750, t0 = performance.now();
    const step = now => {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = p < 1 ? money(Math.round(target * e)) : display;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/* ------------------------------------------------------------
   Small utilities
   ------------------------------------------------------------ */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function pad(n) { return String(n).padStart(2, '0'); }
function ymd(dt) { return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`; }
function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function todayStr() { return ymd(new Date()); }
function thisMonthKey() { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth() + 1)}`; }
function addDays(dt, n) { const c = new Date(dt); c.setDate(c.getDate() + n); return c; }
function startOfWeek(dt) { const c = new Date(dt); const day = (c.getDay() + 6) % 7; c.setDate(c.getDate() - day); c.setHours(0, 0, 0, 0); return c; }
function monthName(i) { return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][i]; }
function prettyDate(s) { const d = parseYmd(s); return `${pad(d.getDate())} ${monthName(d.getMonth())} ${d.getFullYear()}`; }

function money(n) {
  n = Number(n) || 0;
  const cur = (App.data && App.data.settings && App.data.settings.currency) || '₹';
  const neg = n < 0;
  const s = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return (neg ? '−' : '') + cur + s;
}
function shortNum(n) {
  n = Number(n) || 0; const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k';
  return String(Math.round(n));
}
function download(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function hashPw(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return String(h >>> 0); }

/* ------------------------------------------------------------
   Storage layer
   ------------------------------------------------------------ */
const DB = {
  USERS: 'hfm_users',
  SESSION: 'hfm_session',
  dataKey: u => 'hfm_data_' + u,
  getUsers() { try { return JSON.parse(localStorage.getItem(this.USERS)) || {}; } catch { return {}; } },
  saveUsers(u) { localStorage.setItem(this.USERS, JSON.stringify(u)); },
  getSession() { return localStorage.getItem(this.SESSION); },
  setSession(u) { localStorage.setItem(this.SESSION, u); },
  clearSession() { localStorage.removeItem(this.SESSION); },
  getData(u) {
    try {
      const d = JSON.parse(localStorage.getItem(this.dataKey(u)));
      if (d) return migrate(d);
    } catch { /* fall through */ }
    return defaultData();
  },
  saveData(u, d) { localStorage.setItem(this.dataKey(u), JSON.stringify(d)); },
};

function defaultData() {
  return {
    transactions: [],
    budgets: [],                 // [{ id, category, amount }]  (monthly, per expense category)
    categories: { income: [...DEFAULT_INCOME_CATS], expense: [...DEFAULT_EXPENSE_CATS] },
    settings: { currency: '₹', theme: 'system' },
  };
}
function migrate(d) {
  d.transactions = Array.isArray(d.transactions) ? d.transactions : [];
  d.budgets = Array.isArray(d.budgets) ? d.budgets : [];
  d.categories = d.categories || { income: [...DEFAULT_INCOME_CATS], expense: [...DEFAULT_EXPENSE_CATS] };
  d.categories.income = d.categories.income || [...DEFAULT_INCOME_CATS];
  d.categories.expense = d.categories.expense || [...DEFAULT_EXPENSE_CATS];
  d.settings = d.settings || { currency: '₹', theme: 'system' };
  if (!d.settings.currency) d.settings.currency = '₹';
  if (!d.settings.theme) d.settings.theme = 'system';
  return d;
}

/* ------------------------------------------------------------
   App state
   ------------------------------------------------------------ */
const App = { user: null, data: null };
function save() { DB.saveData(App.user, App.data); }

/* ------------------------------------------------------------
   Derived data / computations
   ------------------------------------------------------------ */
const TX = () => App.data.transactions;
const sum = list => list.reduce((s, t) => s + (Number(t.amount) || 0), 0);
const incomeTx = () => TX().filter(t => t.type === 'income');
const expenseTx = () => TX().filter(t => t.type === 'expense');
const txSorted = (list = TX()) => [...list].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
const inRange = (t, from, to) => t.date >= from && t.date <= to;

function totals() {
  const income = sum(incomeTx());
  const expense = sum(expenseTx());
  return { income, expense, balance: income - expense };
}
function monthTotals(mk) {
  const inc = sum(incomeTx().filter(t => t.date.slice(0, 7) === mk));
  const exp = sum(expenseTx().filter(t => t.date.slice(0, 7) === mk));
  return { income: inc, expense: exp, savings: inc - exp };
}
function rangeTotals(from, to) {
  const inc = sum(incomeTx().filter(t => inRange(t, from, to)));
  const exp = sum(expenseTx().filter(t => inRange(t, from, to)));
  return { income: inc, expense: exp, savings: inc - exp };
}
function categoryBreakdown(list, max = 8) {
  const m = new Map();
  list.forEach(t => m.set(t.category || 'Uncategorized', (m.get(t.category || 'Uncategorized') || 0) + Number(t.amount || 0)));
  let arr = [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  if (arr.length > max) {
    const rest = arr.slice(max - 1).reduce((s, x) => s + x.value, 0);
    arr = arr.slice(0, max - 1);
    arr.push({ label: 'Other', value: rest });
  }
  return arr.map((x, i) => ({ ...x, color: PALETTE[i % PALETTE.length] }));
}
function lastMonths(n) {
  const out = [];
  const d = new Date(); d.setDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const c = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push({ key: `${c.getFullYear()}-${pad(c.getMonth() + 1)}`, label: `${monthName(c.getMonth())} ${String(c.getFullYear()).slice(2)}` });
  }
  return out;
}

/* ------------------------------------------------------------
   Toast
   ------------------------------------------------------------ */
function toast(msg, kind = '') {
  const root = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(20px)'; el.style.transition = 'all .3s'; }, 3200);
  setTimeout(() => el.remove(), 3600);
}

/* ------------------------------------------------------------
   Modal
   ------------------------------------------------------------ */
function openModal({ title, body, submitText = 'Save', cancelText = 'Cancel', onSubmit, danger = false, wide = false }) {
  closeModal();
  const root = $('#modalRoot');
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.innerHTML = `
    <div class="modal" style="${wide ? 'max-width:640px' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head"><h3>${esc(title)}</h3>
        <button class="btn btn-ghost btn-icon" data-close type="button">✕</button></div>
      <form data-form><div class="modal-body">${body}</div>
      <div class="modal-foot">
        <button class="btn" type="button" data-close>${esc(cancelText)}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="submit">${esc(submitText)}</button>
      </div></form>
    </div>`;
  root.appendChild(back);
  const close = () => closeModal();
  back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  $$('[data-close]', back).forEach(b => b.addEventListener('click', close));
  document.addEventListener('keydown', escClose);
  $('[data-form]', back).addEventListener('submit', e => {
    e.preventDefault();
    const ok = onSubmit ? onSubmit(back) : true;
    if (ok !== false) close();
  });
  const first = $('input,select,textarea', back);
  if (first) setTimeout(() => first.focus(), 30);
}
function escClose(e) { if (e.key === 'Escape') closeModal(); }
function closeModal() {
  $('#modalRoot').innerHTML = '';
  document.removeEventListener('keydown', escClose);
}
function confirmModal(title, message, onYes, yesText = 'Delete') {
  openModal({
    title, body: `<p class="muted">${esc(message)}</p>`, submitText: yesText, danger: true,
    onSubmit: () => { onYes(); }
  });
}

/* ------------------------------------------------------------
   Charts (hand-drawn SVG, no dependencies)
   ------------------------------------------------------------ */
function donutChart(segments, opts = {}) {
  segments = segments.filter(s => s.value > 0);
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (!total) return `<div class="empty"><div class="big">◔</div>No data for this period</div>`;
  const size = opts.size || 190, sw = opts.stroke || 26, r = (size - sw) / 2, c = size / 2, circ = 2 * Math.PI * r;
  let off = 0;
  const arcs = segments.map(s => {
    const len = (s.value / total) * circ;
    const el = `<circle class="slice" cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${sw}"
      stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"
      transform="rotate(-90 ${c} ${c})"><title>${esc(s.label)}: ${money(s.value)} (${(s.value / total * 100).toFixed(1)}%)</title></circle>`;
    off += len; return el;
  }).join('');
  const center = opts.centerLabel
    ? `<text x="${c}" y="${c - 3}" text-anchor="middle" font-size="11" fill="var(--text-faint)">${esc(opts.centerLabel)}</text>
       <text x="${c}" y="${c + 15}" text-anchor="middle" font-size="15" font-weight="700" fill="var(--text)">${esc(opts.centerValue || '')}</text>` : '';
  const legend = opts.legend === false ? '' :
    `<div class="chart-legend">${segments.map(s => `<span class="item"><span class="dot" style="background:${s.color}"></span>${esc(s.label)} <b>${money(s.value)}</b></span>`).join('')}</div>`;
  return `<svg class="chart" viewBox="0 0 ${size} ${size}" style="max-width:${size}px;margin:4px auto">${arcs}${center}</svg>${legend}`;
}

function barChart(labels, groups, opts = {}) {
  const W = opts.width || 560, H = opts.height || 240, P = { l: 46, r: 12, t: 12, b: 30 };
  const max = Math.max(1, ...groups.flatMap(g => g.values));
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const n = Math.max(1, labels.length), gb = iw / n;
  const bw = Math.max(6, Math.min(30, (gb * 0.64) / groups.length));
  const y = v => P.t + ih - (v / max) * ih;
  let grid = '';
  for (let i = 0; i <= 4; i++) { const v = max * i / 4, yy = y(v); grid += `<line x1="${P.l}" y1="${yy}" x2="${W - P.r}" y2="${yy}" stroke="var(--border)"/><text x="${P.l - 6}" y="${yy + 3}" text-anchor="end" font-size="9" fill="var(--text-faint)">${shortNum(v)}</text>`; }
  let bars = '';
  labels.forEach((lab, i) => {
    const gx = P.l + i * gb + gb / 2;
    groups.forEach((g, j) => {
      const bx = gx - (groups.length * bw) / 2 + j * bw;
      const vh = (g.values[i] / max) * ih;
      bars += `<rect class="bar-tip" x="${bx.toFixed(1)}" y="${(P.t + ih - vh).toFixed(1)}" width="${(bw - 3).toFixed(1)}" height="${Math.max(0, vh).toFixed(1)}" rx="3" fill="${g.color}"><title>${esc(lab)} · ${esc(g.name)}: ${money(g.values[i])}</title></rect>`;
    });
    bars += `<text x="${gx.toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="9" fill="var(--text-faint)">${esc(lab)}</text>`;
  });
  const legend = `<div class="chart-legend">${groups.map(g => `<span class="item"><span class="dot" style="background:${g.color}"></span>${esc(g.name)}</span>`).join('')}</div>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">${grid}${bars}</svg>${legend}`;
}

function lineChart(labels, values, opts = {}) {
  const W = opts.width || 560, H = opts.height || 210, P = { l: 48, r: 12, t: 12, b: 26 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const min = Math.min(0, ...values), max = Math.max(1, ...values);
  const span = (max - min) || 1;
  const x = i => P.l + (labels.length <= 1 ? iw / 2 : (i / (labels.length - 1)) * iw);
  const y = v => P.t + ih - ((v - min) / span) * ih;
  let grid = '';
  for (let i = 0; i <= 4; i++) { const v = min + span * i / 4, yy = y(v); grid += `<line x1="${P.l}" y1="${yy}" x2="${W - P.r}" y2="${yy}" stroke="var(--border)"/><text x="${P.l - 6}" y="${yy + 3}" text-anchor="end" font-size="9" fill="var(--text-faint)">${shortNum(v)}</text>`; }
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `M${x(0).toFixed(1)},${y(min).toFixed(1)} ` + values.map((v, i) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ') + ` L${x(values.length - 1).toFixed(1)},${y(min).toFixed(1)} Z`;
  const dots = values.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" fill="var(--primary)"><title>${esc(labels[i])}: ${money(v)}</title></circle>`).join('');
  const step = Math.ceil(labels.length / 8) || 1;
  const xl = labels.map((l, i) => i % step === 0 ? `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="var(--text-faint)">${esc(l)}</text>` : '').join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}"><path d="${area}" fill="var(--primary-soft)"/>${grid}<path d="${line}" fill="none" stroke="var(--primary)" stroke-width="2"/>${dots}${xl}</svg>`;
}

/* ------------------------------------------------------------
   Transaction add / edit modal
   ------------------------------------------------------------ */
function openTxModal(opts = {}) {
  const editing = opts.tx || null;
  let type = editing ? editing.type : (opts.type || 'expense');

  const build = () => {
    const cats = App.data.categories[type];
    const catLabel = type === 'income' ? 'Income Source' : 'Category';
    const cur = editing || {};
    return `
      <div class="seg" data-typeseg style="margin-bottom:14px">
        <button type="button" data-type="income" class="${type === 'income' ? 'active' : ''}">＋ Income</button>
        <button type="button" data-type="expense" class="${type === 'expense' ? 'active' : ''}">－ Expense</button>
      </div>
      <div class="field">
        <label>Amount</label>
        <input name="amount" type="number" step="0.01" min="0.01" required value="${cur.amount ?? ''}" placeholder="0.00" />
      </div>
      <div class="field-row">
        <div class="field">
          <label>${catLabel}</label>
          <select name="category" required>
            ${cats.map(c => `<option ${cur.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Date</label>
          <input name="date" type="date" required value="${cur.date || opts.date || todayStr()}" max="2100-12-31" />
        </div>
      </div>
      ${type === 'expense' ? `
      <div class="field">
        <label>Payment Method</label>
        <select name="method">
          ${PAYMENT_METHODS.map(m => `<option ${cur.method === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}
        </select>
      </div>` : ''}
      <div class="field">
        <label>Description / Notes <span class="muted">(optional)</span></label>
        <textarea name="note" placeholder="e.g. Monthly grocery run at the local market">${esc(cur.note || '')}</textarea>
      </div>`;
  };

  openModal({
    title: editing ? 'Edit Transaction' : 'Add Transaction',
    body: build(),
    submitText: editing ? 'Update' : 'Add',
    onSubmit: (root) => {
      const f = $('[data-form]', root);
      const amount = parseFloat(f.amount.value);
      if (!(amount > 0)) { toast('Enter a valid amount', 'error'); return false; }
      const rec = {
        id: editing ? editing.id : uid(),
        type,
        amount: Math.round(amount * 100) / 100,
        category: f.category.value,
        date: f.date.value,
        method: type === 'expense' ? (f.method ? f.method.value : 'Cash') : null,
        note: f.note.value.trim(),
        createdAt: editing ? editing.createdAt : Date.now(),
      };
      if (editing) {
        const i = TX().findIndex(t => t.id === editing.id);
        TX()[i] = rec;
        toast('Transaction updated', 'success');
      } else {
        TX().push(rec);
        toast(`${type === 'income' ? 'Income' : 'Expense'} of ${money(rec.amount)} added`, 'success');
      }
      save();
      if (rec.type === 'expense') checkBudgetWarning(rec.category);
      router();
    }
  });

  // wire type toggle (rebuilds body)
  const wireSeg = () => {
    $$('[data-typeseg] button').forEach(b => b.addEventListener('click', () => {
      type = b.dataset.type;
      const body = $('.modal-body');
      body.innerHTML = build();
      wireSeg();
    }));
  };
  wireSeg();
}

function checkBudgetWarning(category) {
  const b = App.data.budgets.find(x => x.category === category);
  if (!b) return;
  const spent = sum(expenseTx().filter(t => t.category === category && t.date.slice(0, 7) === thisMonthKey()));
  if (spent >= b.amount) toast(`⚠ Budget exceeded for ${category} (${money(spent)} / ${money(b.amount)})`, 'error');
  else if (spent >= b.amount * 0.8) toast(`Heads up: ${Math.round(spent / b.amount * 100)}% of ${category} budget used`, 'warn');
}

/* ------------------------------------------------------------
   VIEW: Dashboard
   ------------------------------------------------------------ */
function renderDashboard() {
  const t = totals();
  const mk = thisMonthKey();
  const mt = monthTotals(mk);
  const recent = txSorted().slice(0, 8);
  const months = lastMonths(6);
  const incVals = months.map(m => monthTotals(m.key).income);
  const expVals = months.map(m => monthTotals(m.key).expense);

  const moLabel = monthName(new Date().getMonth()) + ' ' + new Date().getFullYear();
  $('#view').innerHTML = `
    <div class="grid cards">
      ${heroCard('Total Income', t.income, 'hero-green', '💰', 'All income recorded')}
      ${heroCard('Total Expenses', t.expense, 'hero-coral', '💳', 'All spending recorded')}
      ${heroCard('Current Balance', t.balance, 'hero-purple', '👛', 'Income minus expenses')}
      ${heroCard('Total Savings', t.balance, 'hero-teal', '🐖', (t.income ? (t.balance / t.income * 100).toFixed(0) : 0) + '% of income kept')}
    </div>

    <div class="quick-actions">
      <button class="qa qa-green" onclick="openTxModal({type:'income'})"><span class="qa-ic">➕</span><span><b>Add Income</b><small>Record money coming in</small></span></button>
      <button class="qa qa-coral" onclick="openTxModal({type:'expense'})"><span class="qa-ic">➖</span><span><b>Add Expense</b><small>Record a payment</small></span></button>
      <button class="qa qa-orange" onclick="location.hash='#/budget'"><span class="qa-ic">🎯</span><span><b>Set Budget</b><small>Plan category limits</small></span></button>
      <button class="qa qa-blue" onclick="location.hash='#/reports'"><span class="qa-ic">📊</span><span><b>View Report</b><small>Analytics &amp; trends</small></span></button>
    </div>

    <div class="grid cards section">
      ${statCard("This Month's Income", money(mt.income), 'income', '↑', 'var(--income-soft)', moLabel)}
      ${statCard("This Month's Expenses", money(mt.expense), 'expense', '↓', 'var(--expense-soft)', moLabel)}
      ${statCard("This Month's Savings", money(mt.savings), mt.savings >= 0 ? 'income' : 'expense', '✦', 'var(--primary-soft)', moLabel)}
    </div>

    <div class="two-col section">
      <div class="panel">
        <div class="panel-head"><h3>Income vs Expenses — last 6 months</h3></div>
        <div class="panel-body">${barChart(months.map(m => m.label), [
          { name: 'Income', color: 'var(--income)', values: incVals },
          { name: 'Expense', color: 'var(--expense)', values: expVals },
        ])}</div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Income vs Expense (all time)</h3></div>
        <div class="panel-body">${donutChart([
          { label: 'Income', value: t.income, color: 'var(--income)' },
          { label: 'Expense', value: t.expense, color: 'var(--expense)' },
        ], { centerLabel: 'Balance', centerValue: shortNum(t.balance) })}</div>
      </div>
    </div>

    <div class="panel section">
      <div class="panel-head"><h3>Recent Transactions</h3>
        <a class="btn btn-ghost btn-sm" href="#/transactions">View all →</a></div>
      <div class="panel-body" style="padding:0">${txTable(recent, { compact: true })}</div>
    </div>
  `;
  if (!TX().length) {
    $('#view').insertAdjacentHTML('beforeend', `
      <div class="panel section"><div class="panel-body empty">
        <div class="big">👋</div>
        <p>No transactions yet. Add your first income or expense to get started.</p>
        <div class="flex gap8" style="justify-content:center;margin-top:14px">
          <button class="btn btn-income btn-sm" onclick="openTxModal({type:'income'})">＋ Add Income</button>
          <button class="btn btn-expense btn-sm" onclick="openTxModal({type:'expense'})">＋ Add Expense</button>
          <button class="btn btn-sm" onclick="loadSampleData()">Load sample data</button>
        </div>
      </div></div>`);
  }
  wireTxTable();
  animateCounters($('#view'));
}
function heroCard(label, amount, toneClass, icon, sub) {
  return `<div class="hero ${toneClass}">
    <div class="h-top">
      <span class="h-label">${esc(label)}</span>
      <span class="h-ic">${icon}</span>
    </div>
    <div class="h-value" data-count="${amount}" data-display="${esc(money(amount))}">${esc(money(amount))}</div>
    ${sub ? `<div class="h-sub">${esc(sub)}</div>` : ''}
  </div>`;
}
function statCard(label, value, cls, icon, pillBg, sub) {
  return `<div class="card stat ${cls}">
    <div class="row">
      <div><div class="label">${esc(label)}</div>
      <div class="value">${value}</div>
      ${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>
      <span class="pill" style="background:${pillBg}">${icon}</span>
    </div></div>`;
}

/* ------------------------------------------------------------
   Transaction table (shared)
   ------------------------------------------------------------ */
function txTable(list, opts = {}) {
  if (!list.length) return `<div class="empty"><div class="big">≡</div>No transactions found</div>`;
  return `<div class="table-wrap"><table class="tx">
    <thead><tr>
      <th>Date</th><th>Type</th><th>Category</th>
      ${opts.compact ? '' : '<th>Payment</th>'}
      <th>Note</th><th class="right">Amount</th><th></th>
    </tr></thead><tbody>
    ${list.map(t => `<tr data-id="${t.id}">
      <td>${prettyDate(t.date)}</td>
      <td><span class="tag ${t.type}">${t.type === 'income' ? '↑ Income' : '↓ Expense'}</span></td>
      <td><span class="cat-cell"><span class="cat-ico">${catIcon(t.category, t.type)}</span>${esc(t.category)}</span></td>
      ${opts.compact ? '' : `<td class="muted">${esc(t.method || '—')}</td>`}
      <td class="muted">${esc(t.note || '—')}</td>
      <td class="right ${t.type === 'income' ? 'amt-income' : 'amt-expense'}">${t.type === 'income' ? '+' : '−'}${money(t.amount)}</td>
      <td><div class="row-actions">
        <button class="btn btn-ghost btn-sm" data-edit="${t.id}" title="Edit">✎</button>
        <button class="btn btn-ghost btn-sm" data-del="${t.id}" title="Delete">🗑</button>
      </div></td>
    </tr>`).join('')}
    </tbody></table></div>`;
}
function wireTxTable() {
  $$('#view [data-edit]').forEach(b => b.addEventListener('click', () => {
    const tx = TX().find(t => t.id === b.dataset.edit);
    if (tx) openTxModal({ tx });
  }));
  $$('#view [data-del]').forEach(b => b.addEventListener('click', () => {
    const tx = TX().find(t => t.id === b.dataset.del);
    if (!tx) return;
    confirmModal('Delete transaction?', `${tx.type === 'income' ? 'Income' : 'Expense'} of ${money(tx.amount)} on ${prettyDate(tx.date)} (${tx.category}).`, () => {
      App.data.transactions = TX().filter(t => t.id !== tx.id);
      save(); toast('Transaction deleted', 'success'); router();
    });
  }));
}

/* ------------------------------------------------------------
   VIEW: Transactions
   ------------------------------------------------------------ */
const txFilters = { q: '', type: 'all', month: '', category: 'all', from: '', to: '' };
function renderTransactions() {
  const allCats = [...new Set(TX().map(t => t.category))].sort();
  let list = txSorted();
  const f = txFilters;
  if (f.type !== 'all') list = list.filter(t => t.type === f.type);
  if (f.month) list = list.filter(t => t.date.slice(0, 7) === f.month);
  if (f.category !== 'all') list = list.filter(t => t.category === f.category);
  if (f.from) list = list.filter(t => t.date >= f.from);
  if (f.to) list = list.filter(t => t.date <= f.to);
  if (f.q) {
    const q = f.q.toLowerCase();
    list = list.filter(t => (t.category || '').toLowerCase().includes(q) || (t.note || '').toLowerCase().includes(q) || (t.method || '').toLowerCase().includes(q));
  }
  const shown = { income: sum(list.filter(t => t.type === 'income')), expense: sum(list.filter(t => t.type === 'expense')) };

  $('#view').innerHTML = `
    <div class="panel">
      <div class="panel-body">
        <div class="filters">
          <div class="field grow"><label>Search</label>
            <input id="fq" type="search" placeholder="Search notes, category, payment…" value="${esc(f.q)}" /></div>
          <div class="field"><label>Type</label>
            <select id="ftype">
              <option value="all" ${f.type === 'all' ? 'selected' : ''}>All</option>
              <option value="income" ${f.type === 'income' ? 'selected' : ''}>Income</option>
              <option value="expense" ${f.type === 'expense' ? 'selected' : ''}>Expense</option>
            </select></div>
          <div class="field"><label>Month</label><input id="fmonth" type="month" value="${f.month}" /></div>
          <div class="field"><label>Category</label>
            <select id="fcat"><option value="all">All</option>
              ${allCats.map(c => `<option ${f.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
            </select></div>
          <div class="field"><label>From</label><input id="ffrom" type="date" value="${f.from}" /></div>
          <div class="field"><label>To</label><input id="fto" type="date" value="${f.to}" /></div>
          <button class="btn btn-sm" id="fclear" type="button">Clear</button>
          <button class="btn btn-sm" id="fexport" type="button">⭳ CSV</button>
        </div>
      </div>
    </div>

    <div class="flex gap12 wrap section" style="margin-bottom:4px">
      <span class="muted">${list.length} transaction${list.length === 1 ? '' : 's'}</span>
      <span class="muted">·</span>
      <span class="amt-income">Income ${money(shown.income)}</span>
      <span class="amt-expense">Expense ${money(shown.expense)}</span>
      <span class="muted">·</span>
      <span>Net <b>${money(shown.income - shown.expense)}</b></span>
    </div>

    <div class="panel"><div class="panel-body" style="padding:0">${txTable(list)}</div></div>
  `;

  const rerun = () => {
    f.q = $('#fq').value; f.type = $('#ftype').value; f.month = $('#fmonth').value;
    f.category = $('#fcat').value; f.from = $('#ffrom').value; f.to = $('#fto').value;
    renderTransactions();
  };
  $('#fq').addEventListener('input', debounce(rerun, 220));
  ['ftype', 'fmonth', 'fcat', 'ffrom', 'fto'].forEach(id => $('#' + id).addEventListener('change', rerun));
  $('#fclear').addEventListener('click', () => { Object.assign(txFilters, { q: '', type: 'all', month: '', category: 'all', from: '', to: '' }); renderTransactions(); });
  $('#fexport').addEventListener('click', () => exportCSV(list));
  wireTxTable();
}
function debounce(fn, ms) { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; }

/* ------------------------------------------------------------
   VIEW: Monthly Budget
   ------------------------------------------------------------ */
function renderBudget() {
  const mk = thisMonthKey();
  const budgets = App.data.budgets;
  const spentByCat = {};
  expenseTx().filter(t => t.date.slice(0, 7) === mk).forEach(t => spentByCat[t.category] = (spentByCat[t.category] || 0) + Number(t.amount || 0));
  const totalBudget = sum(budgets);
  const totalSpent = budgets.reduce((s, b) => s + (spentByCat[b.category] || 0), 0);
  const unbudgeted = App.data.categories.expense.filter(c => !budgets.some(b => b.category === c));

  $('#view').innerHTML = `
    <div class="grid cards">
      ${statCard('Total Budget', money(totalBudget), '', '◪', 'var(--primary-soft)', monthName(new Date().getMonth()) + ' ' + new Date().getFullYear())}
      ${statCard('Spent (budgeted cats)', money(totalSpent), 'expense', '↓', 'var(--expense-soft)')}
      ${statCard('Remaining', money(totalBudget - totalSpent), (totalBudget - totalSpent) >= 0 ? 'income' : 'expense', '≈', 'var(--income-soft)')}
    </div>

    <div class="panel section">
      <div class="panel-head"><h3>Category budgets — this month</h3>
        ${unbudgeted.length ? `<button class="btn btn-primary btn-sm" id="addBudget" type="button">＋ Set a budget</button>` : ''}</div>
      <div class="panel-body">
        ${budgets.length ? `<div class="budget-grid">${budgets.map(b => budgetRow(b, spentByCat[b.category] || 0)).join('')}</div>` :
          `<div class="empty"><div class="big">🎯</div>No budgets set yet.${unbudgeted.length ? ' Click “Set a budget”.' : ''}</div>`}
      </div>
    </div>
  `;

  if ($('#addBudget')) $('#addBudget').addEventListener('click', () => budgetModal(null, unbudgeted));
  $$('#view [data-editb]').forEach(el => el.addEventListener('click', () => {
    const b = budgets.find(x => x.id === el.dataset.editb);
    budgetModal(b, [b.category, ...unbudgeted]);
  }));
  $$('#view [data-delb]').forEach(el => el.addEventListener('click', () => {
    App.data.budgets = budgets.filter(x => x.id !== el.dataset.delb);
    save(); toast('Budget removed', 'success'); renderBudget();
  }));
}
function budgetRow(b, spent) {
  const pct = b.amount > 0 ? spent / b.amount * 100 : 0;
  const cls = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : '';
  const remaining = b.amount - spent;
  return `<div class="budget-card">
    <div class="bc-head">
      <span class="bc-ic">${catIcon(b.category, 'expense')}</span>
      <span class="bc-name">${esc(b.category)}</span>
      <button class="btn btn-ghost btn-sm" data-editb="${b.id}" title="Edit">✎</button>
      <button class="btn btn-ghost btn-sm" data-delb="${b.id}" title="Remove">🗑</button>
    </div>
    <div class="bc-nums"><span>Spent <b>${money(spent)}</b></span><span>Budget <b>${money(b.amount)}</b></span></div>
    <div class="progress ${cls}"><span style="width:${Math.min(100, pct).toFixed(1)}%"></span></div>
    <div class="bc-nums" style="margin-top:8px;margin-bottom:0">
      <span>${remaining >= 0 ? 'Remaining' : 'Over by'} <b class="${remaining >= 0 ? 'amt-income' : 'amt-expense'}">${money(Math.abs(remaining))}</b></span>
      <span class="muted">${pct.toFixed(0)}% used</span>
    </div>
    ${pct >= 100 ? `<div class="budget-alert over">⚠ Budget exceeded by ${money(spent - b.amount)}</div>`
      : pct >= 80 ? `<div class="budget-alert">⚠ ${pct.toFixed(0)}% used — ${money(b.amount - spent)} left</div>` : ''}
  </div>`;
}
function budgetModal(existing, cats) {
  openModal({
    title: existing ? 'Edit budget' : 'Set a monthly budget',
    body: `
      <div class="field"><label>Expense category</label>
        <select name="cat" ${existing ? 'disabled' : ''}>
          ${[...new Set(cats)].map(c => `<option ${existing && existing.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select></div>
      <div class="field"><label>Monthly budget amount</label>
        <input name="amt" type="number" min="1" step="0.01" required value="${existing ? existing.amount : ''}" placeholder="0.00" /></div>`,
    submitText: existing ? 'Update' : 'Set budget',
    onSubmit: (root) => {
      const f = $('[data-form]', root);
      const amt = parseFloat(f.amt.value);
      if (!(amt > 0)) { toast('Enter a valid amount', 'error'); return false; }
      const cat = existing ? existing.category : f.cat.value;
      const b = App.data.budgets.find(x => x.category === cat);
      if (b) b.amount = amt;
      else App.data.budgets.push({ id: uid(), category: cat, amount: amt });
      save(); toast('Budget saved', 'success'); renderBudget();
    }
  });
}

/* ------------------------------------------------------------
   VIEW: Reports & Analytics
   ------------------------------------------------------------ */
const rep = { period: 'monthly', ref: todayStr() };
function reportRange() {
  const d = parseYmd(rep.ref);
  if (rep.period === 'daily') return { from: rep.ref, to: rep.ref, title: prettyDate(rep.ref) };
  if (rep.period === 'weekly') { const s = startOfWeek(d); const e = addDays(s, 6); return { from: ymd(s), to: ymd(e), title: `${prettyDate(ymd(s))} – ${prettyDate(ymd(e))}` }; }
  if (rep.period === 'yearly') return { from: `${d.getFullYear()}-01-01`, to: `${d.getFullYear()}-12-31`, title: String(d.getFullYear()) };
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { from: ymd(first), to: ymd(last), title: `${monthName(d.getMonth())} ${d.getFullYear()}` };
}
function reportBuckets() {
  const d = parseYmd(rep.ref);
  const out = [];
  if (rep.period === 'daily' || rep.period === 'weekly') {
    const base = rep.period === 'weekly' ? startOfWeek(d) : addDays(d, -6);
    for (let i = 0; i < 7; i++) { const c = addDays(base, i); out.push({ label: `${pad(c.getDate())}/${pad(c.getMonth() + 1)}`, from: ymd(c), to: ymd(c) }); }
  } else if (rep.period === 'yearly') {
    for (let m = 0; m < 12; m++) {
      const f = new Date(d.getFullYear(), m, 1), l = new Date(d.getFullYear(), m + 1, 0);
      out.push({ label: monthName(m), from: ymd(f), to: ymd(l) });
    }
  } else {
    const first = new Date(d.getFullYear(), d.getMonth(), 1);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    let s = new Date(first), wk = 1;
    while (s <= last) {
      const e = new Date(Math.min(addDays(s, 6).getTime(), last.getTime()));
      out.push({ label: 'W' + wk, from: ymd(s), to: ymd(e) });
      s = addDays(e, 1); wk++;
    }
  }
  return out;
}
function renderReports() {
  const r = reportRange();
  const rt = rangeTotals(r.from, r.to);
  const buckets = reportBuckets();
  const incVals = buckets.map(b => rangeTotals(b.from, b.to).income);
  const expVals = buckets.map(b => rangeTotals(b.from, b.to).expense);
  const breakdown = categoryBreakdown(expenseTx().filter(t => inRange(t, r.from, r.to)), 9);
  const months = lastMonths(6);
  const savVals = months.map(m => monthTotals(m.key).savings);
  const allTime = totals();

  $('#view').innerHTML = `
    <div class="panel">
      <div class="panel-body flex gap12 wrap aic between">
        <div class="seg" id="repSeg">
          ${['daily', 'weekly', 'monthly', 'yearly'].map(p => `<button data-p="${p}" class="${rep.period === p ? 'active' : ''}">${p[0].toUpperCase() + p.slice(1)}</button>`).join('')}
        </div>
        <div class="flex gap8 aic">
          <input id="repRef" type="date" value="${rep.ref}" />
          <button class="btn btn-sm" id="repPrint" type="button">⭳ PDF</button>
        </div>
      </div>
    </div>

    <div class="flex between aic section" style="margin-bottom:6px">
      <h2 style="font-size:15px">${esc(r.title)}</h2>
    </div>
    <div class="grid cards">
      ${statCard('Income (period)', money(rt.income), 'income', '↑', 'var(--income-soft)')}
      ${statCard('Expenses (period)', money(rt.expense), 'expense', '↓', 'var(--expense-soft)')}
      ${statCard('Savings (period)', money(rt.savings), rt.savings >= 0 ? 'income' : 'expense', '✦', 'var(--primary-soft)')}
    </div>

    <div class="two-col section">
      <div class="panel">
        <div class="panel-head"><h3>Income vs Expense — ${esc(rep.period)}</h3></div>
        <div class="panel-body">${barChart(buckets.map(b => b.label), [
          { name: 'Income', color: 'var(--income)', values: incVals },
          { name: 'Expense', color: 'var(--expense)', values: expVals },
        ])}</div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Category-wise expenses</h3></div>
        <div class="panel-body">${donutChart(breakdown, { centerLabel: 'Total', centerValue: shortNum(rt.expense) })}</div>
      </div>
    </div>

    <div class="two-col section">
      <div class="panel">
        <div class="panel-head"><h3>Monthly savings — last 6 months</h3></div>
        <div class="panel-body">${barChart(months.map(m => m.label), [
          { name: 'Savings', color: 'var(--primary)', values: savVals },
        ])}</div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Total income vs total expense (all time)</h3></div>
        <div class="panel-body">${donutChart([
          { label: 'Income', value: allTime.income, color: 'var(--income)' },
          { label: 'Expense', value: allTime.expense, color: 'var(--expense)' },
        ], { centerLabel: 'Saved', centerValue: shortNum(allTime.balance) })}</div>
      </div>
    </div>

    <div class="panel section">
      <div class="panel-head"><h3>Category breakdown (period)</h3></div>
      <div class="panel-body" style="padding:0">
        ${breakdown.length ? `<div class="table-wrap"><table class="tx"><thead><tr><th>Category</th><th class="right">Amount</th><th class="right">Share</th></tr></thead><tbody>
          ${breakdown.map(b => `<tr><td><span class="cat-cell"><span class="cat-ico" style="background:${b.color}22">${catIcon(b.label, 'expense')}</span><span class="tag" style="background:${b.color}20;color:${b.color};border-color:transparent">${esc(b.label)}</span></span></td>
            <td class="right amt-expense">${money(b.value)}</td>
            <td class="right muted">${rt.expense ? (b.value / rt.expense * 100).toFixed(1) : 0}%</td></tr>`).join('')}
        </tbody></table></div>` : `<div class="empty"><div class="big">◔</div>No expenses in this period</div>`}
      </div>
    </div>
  `;

  $$('#repSeg button').forEach(b => b.addEventListener('click', () => { rep.period = b.dataset.p; renderReports(); }));
  $('#repRef').addEventListener('change', e => { rep.ref = e.target.value || todayStr(); renderReports(); });
  $('#repPrint').addEventListener('click', () => window.print());
}

/* ------------------------------------------------------------
   VIEW: Savings
   ------------------------------------------------------------ */
function renderSavings() {
  const t = totals();
  const mt = monthTotals(thisMonthKey());
  // month-by-month history across all data
  const dates = TX().map(t => t.date).sort();
  const history = [];
  if (dates.length) {
    let cur = parseYmd(dates[0].slice(0, 7) + '-01');
    const end = parseYmd(dates[dates.length - 1].slice(0, 7) + '-01');
    let cumulative = 0;
    while (cur <= end) {
      const key = `${cur.getFullYear()}-${pad(cur.getMonth() + 1)}`;
      const m = monthTotals(key);
      cumulative += m.savings;
      history.push({ key, label: `${monthName(cur.getMonth())} ${String(cur.getFullYear()).slice(2)}`, ...m, cumulative });
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }
  }
  const avg = history.length ? history.reduce((s, h) => s + h.savings, 0) / history.length : 0;

  $('#view').innerHTML = `
    <div class="grid cards">
      ${statCard('Total Savings', money(t.balance), t.balance >= 0 ? 'income' : 'expense', '✦', 'var(--primary-soft)', 'Total Income − Total Expenses')}
      ${statCard("This Month's Savings", money(mt.savings), mt.savings >= 0 ? 'income' : 'expense', '✦', 'var(--income-soft)')}
      ${statCard('Avg Monthly Savings', money(avg), avg >= 0 ? 'income' : 'expense', '≈', 'var(--primary-soft)')}
      ${statCard('Savings Rate', (t.income ? (t.balance / t.income * 100).toFixed(1) : 0) + '%', '', '％', 'var(--income-soft)', 'of total income kept')}
    </div>

    <div class="panel section">
      <div class="panel-head"><h3>Cumulative savings over time</h3></div>
      <div class="panel-body">${history.length ? lineChart(history.map(h => h.label), history.map(h => h.cumulative)) : `<div class="empty"><div class="big">✦</div>Add transactions to see your savings grow</div>`}</div>
    </div>

    <div class="panel section">
      <div class="panel-head"><h3>Savings history</h3></div>
      <div class="panel-body" style="padding:0">
        ${history.length ? `<div class="table-wrap"><table class="tx"><thead><tr>
          <th>Month</th><th class="right">Income</th><th class="right">Expense</th><th class="right">Savings</th><th class="right">Cumulative</th>
        </tr></thead><tbody>
          ${[...history].reverse().map(h => `<tr>
            <td>${esc(h.label)}</td>
            <td class="right amt-income">${money(h.income)}</td>
            <td class="right amt-expense">${money(h.expense)}</td>
            <td class="right ${h.savings >= 0 ? 'amt-income' : 'amt-expense'}">${money(h.savings)}</td>
            <td class="right"><b>${money(h.cumulative)}</b></td>
          </tr>`).join('')}
        </tbody></table></div>` : `<div class="empty"><div class="big">✦</div>No history yet</div>`}
      </div>
    </div>
  `;
}

/* ------------------------------------------------------------
   VIEW: Calendar
   ------------------------------------------------------------ */
const cal = { ref: new Date(), sel: null };
function renderCalendar() {
  const y = cal.ref.getFullYear(), m = cal.ref.getMonth();
  const first = new Date(y, m, 1);
  const startPad = (first.getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const byDate = {};
  TX().forEach(t => {
    if (t.date.slice(0, 7) !== `${y}-${pad(m + 1)}`) return;
    (byDate[t.date] = byDate[t.date] || { in: 0, out: 0 })[t.type === 'income' ? 'in' : 'out'] += Number(t.amount || 0);
  });
  const cells = [];
  for (let i = 0; i < startPad; i++) {
    const d = new Date(y, m, 1 - startPad + i);
    cells.push({ dim: true, date: ymd(d), day: d.getDate() });
  }
  for (let d = 1; d <= daysInMonth; d++) cells.push({ dim: false, date: `${y}-${pad(m + 1)}-${pad(d)}`, day: d });
  while (cells.length % 7) { const d = new Date(y, m + 1, cells.length - startPad - daysInMonth + 1); cells.push({ dim: true, date: ymd(d), day: d.getDate() }); }

  const monthTx = txSorted(TX().filter(t => t.date.slice(0, 7) === `${y}-${pad(m + 1)}`));
  const selTx = cal.sel ? txSorted(TX().filter(t => t.date === cal.sel)) : null;

  $('#view').innerHTML = `
    <div class="two-col">
      <div class="panel">
        <div class="panel-body">
          <div class="cal-head">
            <button class="btn btn-sm" id="calPrev" type="button">‹</button>
            <h3>${monthName(m)} ${y}</h3>
            <button class="btn btn-sm" id="calNext" type="button">›</button>
            <button class="btn btn-ghost btn-sm" id="calToday" type="button">Today</button>
          </div>
          <div class="cal-grid">
            ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="cal-dow">${d}</div>`).join('')}
            ${cells.map(c => {
              const info = byDate[c.date];
              const isToday = c.date === todayStr();
              return `<div class="cal-cell ${c.dim ? 'dim' : ''} ${isToday ? 'today' : ''} ${cal.sel === c.date ? 'sel' : ''}" data-date="${c.date}">
                <span class="dnum">${c.day}</span>
                ${info && info.in ? `<span class="cin">+${shortNum(info.in)}</span>` : ''}
                ${info && info.out ? `<span class="cout">−${shortNum(info.out)}</span>` : ''}
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>${cal.sel ? prettyDate(cal.sel) : monthName(m) + ' ' + y}</h3>
          <button class="btn btn-primary btn-sm" id="calAdd" type="button">＋ Add</button></div>
        <div class="panel-body" style="padding:0">
          ${(selTx || monthTx).length ? txTable(selTx || monthTx, { compact: true }) : `<div class="empty"><div class="big">▤</div>${cal.sel ? 'Nothing on this day' : 'No transactions this month'}</div>`}
        </div>
      </div>
    </div>
  `;

  $('#calPrev').addEventListener('click', () => { cal.ref = new Date(y, m - 1, 1); cal.sel = null; renderCalendar(); });
  $('#calNext').addEventListener('click', () => { cal.ref = new Date(y, m + 1, 1); cal.sel = null; renderCalendar(); });
  $('#calToday').addEventListener('click', () => { cal.ref = new Date(); cal.sel = todayStr(); renderCalendar(); });
  $('#calAdd').addEventListener('click', () => openTxModal({ date: cal.sel || todayStr() }));
  $$('#view .cal-cell').forEach(c => c.addEventListener('click', () => {
    cal.sel = cal.sel === c.dataset.date ? null : c.dataset.date;
    renderCalendar();
  }));
  wireTxTable();
}

/* ------------------------------------------------------------
   VIEW: Categories
   ------------------------------------------------------------ */
function renderCategories() {
  const c = App.data.categories;
  $('#view').innerHTML = `
    <div class="two-col">
      ${catPanel('Income Sources / Categories', 'income', c.income)}
      ${catPanel('Expense Categories', 'expense', c.expense)}
    </div>
    <p class="muted mt16">Renaming a category updates all existing transactions that use it. Deleting a category does not remove its transactions.</p>
  `;
  ['income', 'expense'].forEach(kind => {
    $(`#add-${kind}`).addEventListener('submit', e => {
      e.preventDefault();
      const inp = $(`#add-${kind} input`);
      const name = inp.value.trim();
      if (!name) return;
      if (App.data.categories[kind].some(x => x.toLowerCase() === name.toLowerCase())) { toast('Category already exists', 'error'); return; }
      App.data.categories[kind].push(name);
      save(); toast('Category added', 'success'); renderCategories();
    });
    $$(`#view [data-editc="${kind}"]`).forEach(b => b.addEventListener('click', () => renameCategory(kind, b.dataset.name)));
    $$(`#view [data-delc="${kind}"]`).forEach(b => b.addEventListener('click', () => {
      const name = b.dataset.name;
      const used = TX().filter(t => t.type === kind && t.category === name).length;
      confirmModal('Delete category?', `"${name}"${used ? ` — ${used} transaction(s) will keep this label.` : ''}`, () => {
        App.data.categories[kind] = App.data.categories[kind].filter(x => x !== name);
        save(); toast('Category deleted', 'success'); renderCategories();
      });
    }));
  });
}
function catPanel(title, kind, list) {
  return `<div class="panel">
    <div class="panel-head"><h3>${esc(title)}</h3></div>
    <div class="panel-body">
      <div class="chips">
        ${list.map(x => `<span class="chip">${esc(x)}
          <button data-editc="${kind}" data-name="${esc(x)}" title="Rename">✎</button>
          <button data-delc="${kind}" data-name="${esc(x)}" title="Delete">✕</button>
        </span>`).join('') || '<span class="muted">None</span>'}
      </div>
      <form class="add-inline" id="add-${kind}">
        <input type="text" placeholder="New ${kind} category…" maxlength="40" />
        <button class="btn btn-primary btn-sm" type="submit">Add</button>
      </form>
    </div>
  </div>`;
}
function renameCategory(kind, oldName) {
  openModal({
    title: 'Rename category',
    body: `<div class="field"><label>New name for “${esc(oldName)}”</label>
      <input name="n" type="text" required value="${esc(oldName)}" maxlength="40" /></div>`,
    submitText: 'Rename',
    onSubmit: (root) => {
      const n = $('[data-form] [name=n]', root).value.trim();
      if (!n) return false;
      const arr = App.data.categories[kind];
      const i = arr.indexOf(oldName);
      if (i < 0) return;
      if (arr.some(x => x.toLowerCase() === n.toLowerCase() && x !== oldName)) { toast('Name already exists', 'error'); return false; }
      arr[i] = n;
      TX().forEach(t => { if (t.type === kind && t.category === oldName) t.category = n; });
      App.data.budgets.forEach(b => { if (b.category === oldName) b.category = n; });
      save(); toast('Category renamed', 'success'); renderCategories();
    }
  });
}

/* ------------------------------------------------------------
   VIEW: Settings
   ------------------------------------------------------------ */
function renderSettings() {
  const s = App.data.settings;
  const t = totals();
  $('#view').innerHTML = `
    <div class="three-col">
      <div class="panel">
        <div class="panel-head"><h3>Preferences</h3></div>
        <div class="panel-body">
          <div class="field"><label>Currency symbol</label>
            <input id="setCur" type="text" maxlength="4" value="${esc(s.currency)}" /></div>
          <div class="field"><label>Theme</label>
            <select id="setTheme">
              <option value="system" ${s.theme === 'system' ? 'selected' : ''}>System</option>
              <option value="light" ${s.theme === 'light' ? 'selected' : ''}>Light</option>
              <option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>Dark</option>
            </select></div>
          <button class="btn btn-primary btn-block" id="setSave" type="button">Save preferences</button>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>Export</h3></div>
        <div class="panel-body">
          <p class="muted mt0">${TX().length} transactions · balance ${money(t.balance)}</p>
          <button class="btn btn-block mt8" id="expCsv" type="button">⭳ Export transactions (CSV)</button>
          <button class="btn btn-block mt8" id="expPdf" type="button">⭳ Export report (PDF / print)</button>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>Backup & restore</h3></div>
        <div class="panel-body">
          <button class="btn btn-block" id="bkDownload" type="button">⭳ Download backup (JSON)</button>
          <button class="btn btn-block mt8" id="bkRestore" type="button">⭱ Restore from backup</button>
          <input id="bkFile" type="file" accept="application/json,.json" class="hidden" />
        </div>
      </div>
    </div>

    <div class="three-col section">
      <div class="panel">
        <div class="panel-head"><h3>Sample data</h3></div>
        <div class="panel-body">
          <p class="muted mt0">Populate a few months of demo transactions to explore the app.</p>
          <button class="btn btn-block mt8" id="sampleBtn" type="button">Load sample data</button>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Account</h3></div>
        <div class="panel-body">
          <p class="muted mt0">Signed in as <b>${esc(App.user)}</b></p>
          <button class="btn btn-block mt8" id="changePw" type="button">Change password</button>
          <button class="btn btn-block mt8" id="logout2" type="button">Log out</button>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Danger zone</h3></div>
        <div class="panel-body">
          <p class="muted mt0">Permanently delete all transactions, budgets and custom categories for this account.</p>
          <button class="btn btn-danger btn-block mt8" id="wipe" type="button">Clear all my data</button>
        </div>
      </div>
    </div>
  `;

  $('#setSave').addEventListener('click', () => {
    s.currency = $('#setCur').value.trim() || '₹';
    s.theme = $('#setTheme').value;
    save(); applyTheme(); toast('Preferences saved', 'success'); router();
  });
  $('#expCsv').addEventListener('click', () => exportCSV(txSorted()));
  $('#expPdf').addEventListener('click', () => { location.hash = '#/reports'; setTimeout(() => window.print(), 400); });
  $('#bkDownload').addEventListener('click', backupJSON);
  $('#bkRestore').addEventListener('click', () => $('#bkFile').click());
  $('#bkFile').addEventListener('change', restoreJSON);
  $('#sampleBtn').addEventListener('click', loadSampleData);
  $('#changePw').addEventListener('click', changePassword);
  $('#logout2').addEventListener('click', logout);
  $('#wipe').addEventListener('click', () => confirmModal('Clear all data?', 'This cannot be undone. Consider downloading a backup first.', () => {
    App.data = defaultData(); save(); toast('All data cleared', 'success'); location.hash = '#/dashboard'; router();
  }, 'Clear everything'));
}

function changePassword() {
  openModal({
    title: 'Change password',
    body: `
      <div class="field"><label>Current password</label><input name="cur" type="password" required></div>
      <div class="field"><label>New password</label><input name="np" type="password" minlength="4" required></div>`,
    submitText: 'Update',
    onSubmit: (root) => {
      const f = $('[data-form]', root);
      const users = DB.getUsers();
      if (users[App.user].pass !== hashPw(f.cur.value)) { toast('Current password is wrong', 'error'); return false; }
      users[App.user].pass = hashPw(f.np.value);
      DB.saveUsers(users); toast('Password updated', 'success');
    }
  });
}

/* ------------------------------------------------------------
   Export / backup
   ------------------------------------------------------------ */
function csvCell(v) { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function exportCSV(list) {
  if (!list.length) { toast('Nothing to export', 'warn'); return; }
  const rows = [['Date', 'Type', 'Category', 'Payment Method', 'Amount', 'Note']];
  txSorted(list).forEach(t => rows.push([t.date, t.type, t.category, t.method || '', t.amount, t.note || '']));
  download(`transactions_${todayStr()}.csv`, rows.map(r => r.map(csvCell).join(',')).join('\n'), 'text/csv;charset=utf-8');
  toast('CSV downloaded', 'success');
}
function backupJSON() {
  download(`homeledger_backup_${App.user}_${todayStr()}.json`, JSON.stringify({ app: 'homeledger', version: 1, exportedAt: new Date().toISOString(), data: App.data }, null, 2), 'application/json');
  toast('Backup downloaded', 'success');
}
function restoreJSON(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const d = parsed.data || parsed;
      if (!d || !Array.isArray(d.transactions)) throw new Error('bad');
      confirmModal('Restore backup?', 'This replaces all current data for this account.', () => {
        App.data = migrate(d); save(); applyTheme(); toast('Backup restored', 'success'); location.hash = '#/dashboard'; router();
      }, 'Restore');
    } catch { toast('Invalid backup file', 'error'); }
    e.target.value = '';
  };
  reader.readAsText(file);
}

/* ------------------------------------------------------------
   Sample data
   ------------------------------------------------------------ */
function loadSampleData() {
  if (TX().length && !confirm('Add sample transactions on top of your current data?')) return;
  const now = new Date();
  const rnd = (a, b) => Math.round(a + Math.random() * (b - a));
  for (let mAgo = 5; mAgo >= 0; mAgo--) {
    const base = new Date(now.getFullYear(), now.getMonth() - mAgo, 1);
    const mk = `${base.getFullYear()}-${pad(base.getMonth() + 1)}`;
    TX().push(mkTx('income', rnd(45000, 55000), 'Salary', `${mk}-01`, null, 'Monthly salary'));
    if (Math.random() > 0.4) TX().push(mkTx('income', rnd(4000, 12000), 'Freelancing', `${mk}-${pad(rnd(8, 20))}`, null, 'Side project'));
    const exp = [
      ['House Rent', 12000, 3], ['Groceries', rnd(6000, 9000), rnd(2, 26)], ['Groceries', rnd(2000, 4000), rnd(2, 26)],
      ['Electricity Bill', rnd(900, 2200), 10], ['Water Bill', rnd(200, 500), 10], ['Gas Bill', rnd(800, 1200), 12],
      ['Internet/Mobile Recharge', rnd(700, 1100), 5], ['Transportation', rnd(1500, 3500), rnd(1, 28)],
      ['Medical', rnd(500, 3000), rnd(1, 28)], ['Shopping', rnd(1500, 6000), rnd(1, 28)],
      ['Entertainment', rnd(500, 2500), rnd(1, 28)], ['EMI/Loan', 8000, 7], ['Family Expenses', rnd(2000, 5000), rnd(1, 28)],
    ];
    exp.forEach(([c, a, d]) => TX().push(mkTx('expense', a, c, `${mk}-${pad(d)}`, PAYMENT_METHODS[rnd(0, 4)], '')));
  }
  if (!App.data.budgets.length) {
    App.data.budgets = [
      { id: uid(), category: 'Groceries', amount: 10000 },
      { id: uid(), category: 'Transportation', amount: 3000 },
      { id: uid(), category: 'Shopping', amount: 4000 },
      { id: uid(), category: 'Entertainment', amount: 2000 },
    ];
  }
  save(); toast('Sample data loaded', 'success'); location.hash = '#/dashboard'; router();
}
function mkTx(type, amount, category, date, method, note) {
  return { id: uid(), type, amount, category, date, method, note, createdAt: Date.now() + Math.random() };
}

/* ------------------------------------------------------------
   Router
   ------------------------------------------------------------ */
const ROUTES = {
  dashboard: renderDashboard, transactions: renderTransactions, budget: renderBudget,
  reports: renderReports, savings: renderSavings, calendar: renderCalendar,
  categories: renderCategories, settings: renderSettings,
  income: () => { Object.assign(txFilters, { type: 'income', q: '', month: '', category: 'all', from: '', to: '' }); renderTransactions(); },
  expenses: () => { Object.assign(txFilters, { type: 'expense', q: '', month: '', category: 'all', from: '', to: '' }); renderTransactions(); },
};
function router() {
  const key = (location.hash.replace(/^#\/?/, '') || 'dashboard');
  const view = ROUTES[key] ? key : 'dashboard';
  $$('#nav a, #bottomNav a').forEach(a => a.classList.toggle('active', a.dataset.view === view));
  $('#viewTitle').textContent = TITLES[view] || 'Dashboard';
  document.body.classList.remove('nav-open');
  window.scrollTo(0, 0);
  try { ROUTES[view](); }
  catch (err) { console.error(err); $('#view').innerHTML = `<div class="panel"><div class="panel-body empty"><div class="big">⚠</div>Something went wrong rendering this view.<br><span class="muted">${esc(err.message)}</span></div></div>`; }
}

/* ------------------------------------------------------------
   Theme
   ------------------------------------------------------------ */
function applyTheme() {
  const t = App.data && App.data.settings ? App.data.settings.theme : 'system';
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

/* ------------------------------------------------------------
   Auth flow
   ------------------------------------------------------------ */
let authMode = 'login';
function showAuth() {
  $('#app').classList.add('hidden');
  $('#auth').classList.remove('hidden');
}
function setupAuthUI() {
  const setMode = m => {
    authMode = m;
    $('#tabLogin').classList.toggle('active', m === 'login');
    $('#tabRegister').classList.toggle('active', m === 'register');
    $('#confirmField').classList.toggle('hidden', m === 'login');
    $('#authSubmit').textContent = m === 'login' ? 'Log in' : 'Create account';
    $('#authError').textContent = '';
  };
  $('#tabLogin').addEventListener('click', () => setMode('login'));
  $('#tabRegister').addEventListener('click', () => setMode('register'));

  $('#authForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('#auName').value.trim().toLowerCase();
    const pw = $('#auPass').value;
    const err = m => { $('#authError').textContent = m; };
    if (!name || !pw) return err('Enter username and password');
    const users = DB.getUsers();
    if (authMode === 'register') {
      if (users[name]) return err('That username is taken');
      if (pw.length < 4) return err('Password must be at least 4 characters');
      if (pw !== $('#auPass2').value) return err('Passwords do not match');
      users[name] = { pass: hashPw(pw), created: new Date().toISOString() };
      DB.saveUsers(users);
      startApp(name);
      toast('Account created — welcome!', 'success');
    } else {
      if (!users[name] || users[name].pass !== hashPw(pw)) return err('Invalid username or password');
      startApp(name);
    }
  });
}
function logout() {
  DB.clearSession();
  App.user = null; App.data = null;
  location.hash = '';
  showAuth();
  $('#authForm').reset();
}

/* ------------------------------------------------------------
   Start app
   ------------------------------------------------------------ */
function startApp(username) {
  App.user = username;
  App.data = DB.getData(username);
  DB.setSession(username);
  applyTheme();

  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#userName').textContent = username;
  $('#userAvatar').textContent = username.slice(0, 1).toUpperCase();

  if (!location.hash) location.hash = '#/dashboard';
  router();
}

/* ------------------------------------------------------------
   Global wiring
   ------------------------------------------------------------ */
function setupShell() {
  $('#hamburger').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  $('#logoutBtn').addEventListener('click', logout);
  $('#quickIncome').addEventListener('click', () => openTxModal({ type: 'income' }));
  $('#quickExpense').addEventListener('click', () => openTxModal({ type: 'expense' }));
  $$('#nav a').forEach(a => a.addEventListener('click', () => document.body.classList.remove('nav-open')));
  const more = $('#bottomMore');
  if (more) more.addEventListener('click', () => document.body.classList.toggle('nav-open'));
  window.addEventListener('hashchange', () => { if (App.user) router(); });
}

// expose a few helpers for inline onclick in empty states
window.openTxModal = openTxModal;
window.loadSampleData = loadSampleData;

/* ------------------------------------------------------------
   Boot
   ------------------------------------------------------------ */
(function boot() {
  setupAuthUI();
  setupShell();
  const s = DB.getSession();
  if (s && DB.getUsers()[s]) startApp(s);
  else showAuth();
})();
