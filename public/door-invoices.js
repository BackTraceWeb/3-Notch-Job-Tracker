// Door Invoicing Page JS

let selectedAccountId = null;
let currentPeriod = new Date().toISOString().slice(0, 7);
let accounts = [];
let invoices = [];

// Auth check
async function checkAuth() {
  const resp = await fetch('/api/auth/check');
  const data = await resp.json();
  if (!data.authenticated) {
    window.location.href = 'login.html';
    return;
  }
  document.getElementById('user-name').textContent = data.user.fullName;
}

// Toast
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = 'toast toast-' + type + ' show';
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// Logout
document.getElementById('logout-btn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = 'login.html';
});

// Month picker
const monthPicker = document.getElementById('month-picker');
monthPicker.value = currentPeriod;
monthPicker.addEventListener('change', () => {
  currentPeriod = monthPicker.value;
  loadAll();
});

// Tabs
document.querySelectorAll('.di-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.di-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.di-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
  });
});

// Load everything
async function loadAll() {
  await Promise.all([
    loadAccounts(),
    loadUnlinked(),
    loadInvoices(),
    loadHistory()
  ]);
  updateStats();
  // Reload selected account's charges and visual for new period
  if (selectedAccountId) {
    await Promise.all([loadCharges(selectedAccountId), loadYearVisual(selectedAccountId)]);
  }
}

// Load accounts
async function loadAccounts() {
  const resp = await fetch(`/api/door-accounts?period=${currentPeriod}`);
  accounts = await resp.json();
  renderAccountList();
  populateHistoryAccountFilter();
}

function renderAccountList() {
  const body = document.getElementById('account-list-body');
  if (!accounts.length) {
    body.innerHTML = '<div class="empty-state">No accounts yet</div>';
    return;
  }
  body.innerHTML = accounts.map(a => `
    <div class="account-item ${selectedAccountId === a.id ? 'selected' : ''}" onclick="selectAccount(${a.id})">
      <div>
        <div class="account-name">${esc(a.customer_name)}</div>
        <div style="font-size: 0.8rem; color: #9a9189;">${a.pending_charges || 0} pending charges</div>
      </div>
      <div class="account-total">$${fmt(a.current_month_total)}</div>
    </div>
  `).join('');
}

async function selectAccount(id) {
  selectedAccountId = id;
  renderAccountList();
  const acct = accounts.find(a => a.id === id);
  document.getElementById('charges-title').textContent = acct ? acct.customer_name + ' - Charges' : 'Charges';
  document.getElementById('add-charge-btn').style.display = 'inline-block';
  await Promise.all([loadCharges(id), loadYearVisual(id)]);
}

// Load charges for an account
async function loadCharges(accountId) {
  const resp = await fetch(`/api/door-accounts/${accountId}/charges?period=${currentPeriod}`);
  const charges = await resp.json();
  const body = document.getElementById('charges-body');

  if (!charges.length) {
    body.innerHTML = '<div class="empty-state">No charges for this period</div>';
    return;
  }

  body.innerHTML = `<table class="charges-table">
    <thead><tr><th>Date</th><th>Description</th><th>Source</th><th>Qty</th><th>Unit</th><th>Total</th><th>Status</th><th></th></tr></thead>
    <tbody>${charges.map(c => `
      <tr>
        <td>${c.order_date || '-'}</td>
        <td>${esc(c.description)}</td>
        <td><span class="source-badge source-${c.source}">${c.source}</span></td>
        <td>${c.quantity}</td>
        <td>$${fmt(c.unit_cost)}</td>
        <td style="font-weight:700;">$${fmt(c.line_total)}</td>
        <td><span class="status-badge status-${c.invoice_status}">${c.invoice_status}</span></td>
        <td style="white-space:nowrap;">
          <button class="btn-sm btn-blue" onclick="editCharge(${c.id}, '${esc(c.description).replace(/'/g, "\\'")}', ${c.quantity}, ${c.unit_cost}, '${c.order_date || ''}')">Edit</button>
          <button class="btn-sm btn-red" onclick="deleteCharge(${c.id})">X</button>
        </td>
      </tr>
    `).join('')}</tbody>
    <tfoot><tr><td colspan="5" style="text-align:right; font-weight:700; color:#b8ae97;">TOTAL:</td>
    <td style="font-weight:700; font-size:1.1rem; color:#b8ae97;">$${fmt(charges.reduce((s, c) => s + c.line_total, 0))}</td>
    <td colspan="2"></td></tr></tfoot>
  </table>`;

  // Load linked jobs for this account
  loadLinkedJobs(accountId);
}

// Load and display jobs linked to this door account
async function loadLinkedJobs(accountId) {
  const resp = await fetch('/api/door-accounts/' + accountId + '/jobs');
  const jobs = await resp.json();
  const body = document.getElementById('charges-body');

  if (!jobs.length) return;

  const jobsHtml = '<div style="margin-top:16px; padding:12px 16px; background:rgba(184,174,151,0.08); border-radius:6px; border:1px solid #3a3a38;">' +
    '<div style="font-weight:700; color:#b8ae97; font-size:0.85rem; text-transform:uppercase; letter-spacing:0.08em; margin-bottom:8px;">Linked Jobs</div>' +
    '<table class="charges-table" style="font-size:0.85rem;">' +
    '<thead><tr><th>Job</th><th>Stage</th><th>Quoted</th><th>Material</th><th>Created</th><th></th></tr></thead>' +
    '<tbody>' + jobs.map(j =>
      '<tr>' +
      '<td style="font-weight:600;">' + esc(j.job_name) + ' <span style="color:#9a9189;">#' + j.id + '</span></td>' +
      '<td><span class="status-badge status-' + (j.stage && j.stage.includes('Completed') ? 'paid' : j.stage && j.stage.includes('Progress') ? 'invoiced' : 'pending') + '">' + esc(j.stage || 'N/A') + '</span></td>' +
      '<td>$' + fmt(j.quoted_price) + '</td>' +
      '<td>$' + fmt(j.material_cost) + '</td>' +
      '<td>' + (j.created_at ? j.created_at.slice(0, 10) : '-') + '</td>' +
      '<td><button class="btn-sm btn-gold" onclick="window.open(\'/index.html#job-' + j.id + '\', \'_blank\')">View</button></td>' +
      '</tr>'
    ).join('') +
    '</tbody></table></div>';

  body.innerHTML += jobsHtml;
}

// 12-month visual for selected account
async function loadYearVisual(accountId) {
  const visual = document.getElementById('year-visual');
  const acct = accounts.find(a => a.id === accountId);

  // Get ALL charges for this account (no period filter)
  const chargesResp = await fetch(`/api/door-accounts/${accountId}/charges`);
  const allCharges = await chargesResp.json();

  // Get all invoices for this account
  const invoicesResp = await fetch('/api/door-invoices');
  const allInvoices = (await invoicesResp.json()).filter(i => i.account_id === accountId);

  // Build 12 months ending at current month
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: d.toISOString().slice(0, 7),
      label: d.toLocaleString('en-US', { month: 'short' }),
      year: d.getFullYear()
    });
  }

  // Aggregate charges by month
  const monthData = {};
  months.forEach(m => { monthData[m.key] = { total: 0, status: 'empty' }; });

  allCharges.forEach(c => {
    const period = c.billing_period;
    if (monthData[period] !== undefined) {
      monthData[period].total += c.line_total;
      // Use the worst status: pending > invoiced > paid
      if (c.invoice_status === 'pending') monthData[period].status = 'pending';
      else if (c.invoice_status === 'invoiced' && monthData[period].status !== 'pending') monthData[period].status = 'invoiced';
      else if (c.invoice_status === 'paid' && monthData[period].status === 'empty') monthData[period].status = 'paid';
    }
  });

  // Override with invoice-level status if exists (more accurate)
  allInvoices.forEach(inv => {
    if (monthData[inv.billing_period] !== undefined && monthData[inv.billing_period].total > 0) {
      monthData[inv.billing_period].status = inv.status;
    }
  });

  // Find max for scaling
  const maxTotal = Math.max(...months.map(m => monthData[m.key].total), 1);
  const yearTotal = months.reduce((s, m) => s + monthData[m.key].total, 0);

  // Render
  document.getElementById('year-visual-name').textContent = acct ? acct.customer_name + ' — 12 Month Overview' : '';
  document.getElementById('year-visual-total').textContent = 'Year Total: $' + fmt(yearTotal);

  const barsEl = document.getElementById('year-bars');
  const labelsEl = document.getElementById('year-labels');
  const currentMonth = now.toISOString().slice(0, 7);

  barsEl.innerHTML = months.map(m => {
    const d = monthData[m.key];
    const pct = d.total > 0 ? Math.max((d.total / maxTotal) * 100, 8) : 0;
    const barClass = d.total > 0 ? d.status : 'empty';
    return `<div class="month-bar-wrap">
      ${d.total > 0 ? `<div class="month-bar-amount">$${fmtShort(d.total)}</div>` : ''}
      <div class="month-bar ${barClass}" style="height: ${pct > 0 ? pct : 4}%;"></div>
    </div>`;
  }).join('');

  labelsEl.innerHTML = months.map(m =>
    `<div class="month-label ${m.key === currentMonth ? 'current' : ''}">${m.label}${m.key.slice(0, 4) !== String(now.getFullYear()) ? '<br>' + m.key.slice(2, 4) : ''}</div>`
  ).join('');

  visual.classList.add('show');
}

function fmtShort(n) {
  n = parseFloat(n) || 0;
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return n.toFixed(0);
}

// Load unlinked portal orders
async function loadUnlinked() {
  const resp = await fetch('/api/door-orders/unlinked');
  const orders = await resp.json();
  const section = document.getElementById('unlinked-section');
  const list = document.getElementById('unlinked-list');

  if (!orders.length) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  list.innerHTML = orders.slice(0, 20).map(o => {
    const desc = `${o.wood_type || ''} ${o.door_style || ''} ${o.width}"x${o.height}" ${o.finish_type || ''} qty ${o.quantity}`;
    return `<div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid rgba(255,152,0,0.2);">
      <div>
        <div style="font-weight:600;">${esc(o.customer_name || 'Unknown')} - Order #${o.id}</div>
        <div style="font-size:0.85rem; color:#9a9189;">${desc} | $${fmt(o.cost)} | ${o.created_at || ''}</div>
      </div>
      <div>
        <select id="link-acct-${o.id}" class="month-picker" style="padding:5px;font-size:0.85rem;">
          <option value="">Account...</option>
          ${accounts.map(a => `<option value="${a.id}">${esc(a.customer_name)}</option>`).join('')}
        </select>
        <button class="btn-sm btn-gold" onclick="linkOrder(${o.id})">Link</button>
      </div>
    </div>`;
  }).join('');
}

async function linkOrder(orderId) {
  const select = document.getElementById('link-acct-' + orderId);
  const accountId = select.value;
  if (!accountId) { showToast('Select an account first', 'error'); return; }

  const resp = await fetch(`/api/door-orders/${orderId}/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_id: parseInt(accountId) })
  });

  if (resp.ok) {
    showToast('Order linked');
    loadAll();
  } else {
    showToast('Failed to link order', 'error');
  }
}

// Load invoices for tally tab
async function loadInvoices() {
  const resp = await fetch(`/api/door-invoices?period=${currentPeriod}`);
  invoices = await resp.json();
  renderTally();
}

function renderTally() {
  const list = document.getElementById('tally-list');
  const markAllBtn = document.getElementById('mark-all-invoiced-btn');

  if (!invoices.length) {
    list.innerHTML = '<div class="empty-state">No tallies for this period. Click "Generate Month-End Tallies" to create them.</div>';
    markAllBtn.style.display = 'none';
    return;
  }

  const hasDrafts = invoices.some(i => i.status === 'draft');
  markAllBtn.style.display = hasDrafts ? 'inline-block' : 'none';

  list.innerHTML = invoices.map(inv => `
    <div class="tally-card">
      <div class="tally-header">
        <div class="tally-name">${esc(inv.customer_name)}</div>
        <div style="display:flex; align-items:center; gap:15px;">
          <span class="status-badge status-${inv.status}">${inv.status}</span>
          <div class="tally-total">$${fmt(inv.total)}</div>
        </div>
      </div>
      <div class="tally-body">
        <div class="tally-row">
          <span>Subtotal</span>
          <span>$${fmt(inv.subtotal)}</span>
        </div>
        <div class="tally-adjust">
          <label style="color:#9a9189; font-size:0.85rem; white-space:nowrap;">Adjustment ($):</label>
          <input type="number" step="0.01" value="${inv.adjustment || 0}" onchange="updateInvoiceAdjustment(${inv.id}, this.value)" ${inv.status !== 'draft' ? 'disabled' : ''}>
          <input type="text" placeholder="Adjustment note" value="${esc(inv.adjustment_notes || '')}" onchange="updateInvoiceNote(${inv.id}, this.value)" style="flex:1;" ${inv.status !== 'draft' ? 'disabled' : ''}>
        </div>
        <div class="tally-row" style="margin-top:10px; font-weight:700;">
          <span style="color:#b8ae97;">TOTAL</span>
          <span style="color:#b8ae97; font-size:1.1rem;" id="tally-total-${inv.id}">$${fmt(inv.total)}</span>
        </div>
        <div style="margin-top:8px; font-size:0.85rem; color:#9a9189;">
          Due: ${inv.due_date || 'N/A'}
        </div>
        ${inv.status === 'draft' ? `<div style="margin-top:12px;"><button class="btn-sm btn-blue" onclick="markInvoiced(${inv.id})">Mark as Invoiced (QB)</button></div>` : ''}
        ${inv.status === 'invoiced' ? `<div style="margin-top:12px;"><button class="btn-sm btn-green" onclick="markPaid(${inv.id})">Mark as Paid</button></div>` : ''}
      </div>
    </div>
  `).join('');
}

// Generate tallies
document.getElementById('generate-tallies-btn').addEventListener('click', async () => {
  const resp = await fetch('/api/door-invoices/generate-monthly', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ billing_period: currentPeriod })
  });

  const data = await resp.json();
  if (data.invoices && data.invoices.length) {
    showToast(`Generated ${data.invoices.length} tally(s)`);
  } else {
    showToast(data.message || 'No pending charges for this period', 'error');
  }
  loadInvoices();
});

async function updateInvoiceAdjustment(invId, value) {
  const resp = await fetch(`/api/door-invoices/${invId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adjustment: parseFloat(value) || 0 })
  });
  if (resp.ok) {
    const inv = await resp.json();
    const el = document.getElementById('tally-total-' + invId);
    if (el) el.textContent = '$' + fmt(inv.total);
  }
}

async function updateInvoiceNote(invId, value) {
  await fetch(`/api/door-invoices/${invId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adjustment_notes: value })
  });
}

async function markInvoiced(invId) {
  await fetch(`/api/door-invoices/${invId}/mark-invoiced`, { method: 'POST' });
  showToast('Marked as invoiced');
  loadInvoices();
}

async function markPaid(invId) {
  await fetch(`/api/door-invoices/${invId}/mark-paid`, { method: 'POST' });
  showToast('Marked as paid');
  loadAll();
}

document.getElementById('mark-all-invoiced-btn').addEventListener('click', async () => {
  const drafts = invoices.filter(i => i.status === 'draft');
  for (const inv of drafts) {
    await fetch(`/api/door-invoices/${inv.id}/mark-invoiced`, { method: 'POST' });
  }
  showToast(`Marked ${drafts.length} invoice(s) as invoiced`);
  loadInvoices();
});

// Payment history
async function loadHistory() {
  const accountFilter = document.getElementById('history-account-filter').value;
  const statusFilter = document.getElementById('history-status-filter').value;

  let url = '/api/door-invoices?';
  const params = [];
  if (accountFilter) params.push('account_id=' + accountFilter);
  if (statusFilter) params.push('status=' + statusFilter);
  url += params.join('&');

  const resp = await fetch(url);
  const all = await resp.json();
  const body = document.getElementById('history-body');

  if (!all.length) {
    body.innerHTML = '<tr><td colspan="8" class="empty-state">No invoices found</td></tr>';
    return;
  }

  body.innerHTML = all.map(inv => `
    <tr>
      <td>${esc(inv.customer_name)}</td>
      <td>${inv.billing_period}</td>
      <td>$${fmt(inv.subtotal)}</td>
      <td>${inv.adjustment ? '$' + fmt(inv.adjustment) : '-'}</td>
      <td style="font-weight:700;">$${fmt(inv.total)}</td>
      <td>${inv.due_date || '-'}</td>
      <td><span class="status-badge status-${inv.status}">${inv.status}</span></td>
      <td>
        ${inv.status === 'draft' ? `<button class="btn-sm btn-blue" onclick="markInvoiced(${inv.id})">Invoiced</button>` : ''}
        ${inv.status === 'invoiced' ? `<button class="btn-sm btn-green" onclick="markPaid(${inv.id})">Paid</button>` : ''}
        ${inv.status === 'paid' ? `<span style="color:#81c784; font-size:0.85rem;">${inv.paid_at ? inv.paid_at.slice(0, 10) : 'Paid'}</span>` : ''}
      </td>
    </tr>
  `).join('');
}

function populateHistoryAccountFilter() {
  const select = document.getElementById('history-account-filter');
  const currentVal = select.value;
  select.innerHTML = '<option value="">All Accounts</option>' +
    accounts.map(a => `<option value="${a.id}">${esc(a.customer_name)}</option>`).join('');
  select.value = currentVal;
}

document.getElementById('history-account-filter').addEventListener('change', loadHistory);
document.getElementById('history-status-filter').addEventListener('change', loadHistory);

// Stats
function updateStats() {
  const activeAccounts = accounts.filter(a => a.current_month_total > 0 || a.pending_charges > 0).length;
  const pendingCharges = accounts.reduce((s, a) => s + (a.pending_charges || 0), 0);
  const monthTotal = accounts.reduce((s, a) => s + (a.current_month_total || 0), 0);
  const overdue = invoices.filter(i => i.status === 'invoiced' && i.due_date && new Date(i.due_date) < new Date()).length;

  document.getElementById('stat-accounts').textContent = activeAccounts;
  document.getElementById('stat-charges').textContent = pendingCharges;
  document.getElementById('stat-total').textContent = '$' + fmt(monthTotal);
  document.getElementById('stat-overdue').textContent = overdue;
}

// New account modal
document.getElementById('new-account-btn').addEventListener('click', () => {
  document.getElementById('account-edit-id').value = '';
  document.getElementById('account-modal-title').textContent = 'New Door Account';
  document.getElementById('account-form').reset();
  document.getElementById('account-modal').classList.add('show');
});

function closeAccountModal() {
  document.getElementById('account-modal').classList.remove('show');
}

document.getElementById('account-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const editId = document.getElementById('account-edit-id').value;
  const data = {
    customer_name: document.getElementById('account-name').value,
    customer_email: document.getElementById('account-email').value,
    notes: document.getElementById('account-notes').value
  };

  const url = editId ? `/api/door-accounts/${editId}` : '/api/door-accounts';
  const method = editId ? 'PUT' : 'POST';

  const resp = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });

  if (resp.ok) {
    showToast(editId ? 'Account updated' : 'Account created');
    closeAccountModal();
    loadAll();
  } else {
    const err = await resp.json();
    showToast(err.error || 'Failed to save', 'error');
  }
});

// Add charge modal
document.getElementById('add-charge-btn').addEventListener('click', () => {
  if (!selectedAccountId) { showToast('Select an account first', 'error'); return; }
  editingChargeId = null;
  document.getElementById('charge-modal-title').textContent = 'Add Charge';
  document.getElementById('charge-form').reset();
  document.getElementById('charge-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('charge-modal').classList.add('show');
});

function closeChargeModal() {
  document.getElementById('charge-modal').classList.remove('show');
}

document.getElementById('charge-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = {
    description: document.getElementById('charge-description').value,
    quantity: parseInt(document.getElementById('charge-qty').value) || 1,
    unit_cost: parseFloat(document.getElementById('charge-unit-cost').value) || 0,
    order_date: document.getElementById('charge-date').value
  };

  let resp;
  if (editingChargeId) {
    // Update existing charge
    resp = await fetch('/api/door-charges/' + editingChargeId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  } else {
    // Create new charge
    resp = await fetch('/api/door-accounts/' + selectedAccountId + '/charges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  }

  if (resp.ok) {
    showToast(editingChargeId ? 'Charge updated' : 'Charge added');
    editingChargeId = null;
    closeChargeModal();
    loadAll();
    loadCharges(selectedAccountId);
  } else {
    showToast('Failed to save charge', 'error');
  }
});

// Edit charge
let editingChargeId = null;

function editCharge(chargeId, description, qty, unitCost, orderDate) {
  editingChargeId = chargeId;
  document.getElementById('charge-modal-title').textContent = 'Edit Charge';
  document.getElementById('charge-description').value = description;
  document.getElementById('charge-qty').value = qty;
  document.getElementById('charge-unit-cost').value = unitCost;
  document.getElementById('charge-date').value = orderDate || new Date().toISOString().slice(0, 10);
  document.getElementById('charge-modal').classList.add('show');
}

// Delete charge
async function deleteCharge(chargeId) {
  if (!confirm('Delete this charge?')) return;
  const resp = await fetch(`/api/door-charges/${chargeId}`, { method: 'DELETE' });
  if (resp.ok) {
    showToast('Charge deleted');
    loadAll();
    if (selectedAccountId) loadCharges(selectedAccountId);
  }
}

// Helpers
function esc(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function fmt(n) {
  return (parseFloat(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Init
checkAuth().then(() => loadAll());
