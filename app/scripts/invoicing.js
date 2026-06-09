let doorAccounts = [];
let selectedAccount = null;
let currentPeriod = new Date().toISOString().slice(0, 7);

async function loadInvoicing() {
  // Build period selector
  const sel = document.getElementById('invoicePeriod');
  const periods = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    periods.push(d.toISOString().slice(0, 7));
  }
  sel.innerHTML = periods.map(p => '<option value="' + p + '"' + (p === currentPeriod ? ' selected' : '') + '>' + new Date(p + '-01T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long' }) + '</option>').join('');

  try {
    doorAccounts = await API.getDoorAccounts();
    renderAccountList();
  } catch (e) { toast('Failed to load accounts: ' + e.message, 'error'); }
}

function loadInvoicePeriod() {
  currentPeriod = document.getElementById('invoicePeriod').value;
  if (selectedAccount) loadAccountDetail(selectedAccount);
}

function renderAccountList() {
  const content = document.getElementById('invoicingContent');
  content.innerHTML = `
    <div class="account-list" id="accountList">
      <button class="btn-primary" style="width:100%;margin-bottom:8px;" onclick="openNewAccountModal()">+ New Account</button>
      ${doorAccounts.map(a => {
        const active = selectedAccount && selectedAccount.id === a.id ? ' active' : '';
        return '<div class="account-item' + active + '" onclick="selectAccount(' + a.id + ')"><div class="name">' + a.customer_name + '</div><div class="meta">' + (a.pending_count || 0) + ' pending</div></div>';
      }).join('')}
      ${doorAccounts.length === 0 ? '<div style="text-align:center;padding:20px;color:var(--muted);font-size:12px;">No door accounts</div>' : ''}
    </div>
    <div class="account-detail" id="accountDetail">
      <div style="text-align:center;padding:40px;color:var(--muted);">Select an account</div>
    </div>`;
}

async function selectAccount(id) {
  selectedAccount = doorAccounts.find(a => a.id === id);
  if (!selectedAccount) return;
  // Highlight active
  document.querySelectorAll('.account-item').forEach(el => el.classList.remove('active'));
  event.currentTarget.classList.add('active');
  await loadAccountDetail(selectedAccount);
}

async function loadAccountDetail(account) {
  const detail = document.getElementById('accountDetail');
  try {
    const charges = await API.getCharges(account.id, currentPeriod);
    const invoices = await API.getInvoices(currentPeriod);
    const acctInvoices = invoices.filter(i => i.account_id === account.id);
    const total = charges.reduce((s, c) => s + (c.line_total || 0), 0);

    detail.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h2 style="color:var(--brand);font-size:18px;">${account.customer_name}</h2>
        <button class="btn-primary" onclick="openAddChargeModal(${account.id})">+ Add Charge</button>
      </div>
      <div style="display:flex;gap:12px;margin-bottom:16px;">
        <div class="stat-card" style="flex:1;"><div class="stat-label">Charges</div><div class="stat-value" style="font-size:20px;">${charges.length}</div></div>
        <div class="stat-card" style="flex:1;"><div class="stat-label">Period Total</div><div class="stat-value" style="font-size:20px;">$${total.toFixed(2)}</div></div>
        <div class="stat-card" style="flex:1;"><div class="stat-label">Status</div><div class="stat-value" style="font-size:14px;">${acctInvoices.length > 0 ? '<span class="badge badge-' + (acctInvoices[0].status === 'paid' ? 'green' : acctInvoices[0].status === 'sent' ? 'blue' : 'yellow') + '">' + acctInvoices[0].status + '</span>' + (acctInvoices[0].status === 'draft' ? '<br><button class="btn-primary" style="margin-top:6px;font-size:11px;padding:4px 12px;" onclick="sendDoorInvoiceToQB(' + acctInvoices[0].id + ')">Send via QB</button>' : '') : '<span class="badge badge-gray">No invoice</span>'}</div></div>
      </div>
      <table class="data-table">
        <thead><tr><th>Date</th><th>Description</th><th>Qty</th><th>Unit Cost</th><th>Total</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${charges.map(c => {
          const badge = c.invoice_status === 'paid' ? 'green' : c.invoice_status === 'invoiced' ? 'yellow' : 'gray';
          return '<tr><td style="font-size:12px;">' + (c.order_date || '-') + '</td><td>' + c.description + '</td><td>' + c.quantity + '</td><td>$' + (c.unit_cost || 0).toFixed(2) + '</td><td><strong>$' + (c.line_total || 0).toFixed(2) + '</strong></td><td><span class="badge badge-' + badge + '">' + c.invoice_status + '</span></td><td class="actions"><button onclick="editCharge(' + c.id + ')">Edit</button><button onclick="removeCharge(' + c.id + ')">Del</button></td></tr>';
        }).join('')}
        ${charges.length === 0 ? '<tr><td colspan="7" style="text-align:center;color:var(--muted);">No charges this period</td></tr>' : ''}
        </tbody>
      </table>`;
  } catch (e) { detail.innerHTML = '<div style="color:var(--red);padding:20px;">Error: ' + e.message + '</div>'; }
}

function openNewAccountModal() {
  document.getElementById('customerModalTitle').textContent = 'New Door Account';
  document.getElementById('customerModalBody').innerHTML = `
    <div class="form-group"><label>Customer Name *</label><input type="text" id="daName"></div>
    <div class="form-group"><label>Email</label><input type="text" id="daEmail"></div>
    <div class="form-group"><label>Notes</label><textarea id="daNotes" rows="2"></textarea></div>
    <div class="form-actions">
      <button class="btn-primary" onclick="saveDoorAccount()">Save</button>
      <button class="btn-secondary" onclick="closeCustomerModal()">Cancel</button>
    </div>`;
  document.getElementById('customerModal').classList.add('active');
}

async function saveDoorAccount() {
  const name = document.getElementById('daName').value.trim();
  if (!name) { toast('Name required', 'error'); return; }
  try {
    const acct = await API.createDoorAccount({ customer_name: name, customer_email: document.getElementById('daEmail').value.trim(), notes: document.getElementById('daNotes').value.trim() });
    doorAccounts.push(acct);
    renderAccountList();
    closeCustomerModal();
    toast('Account created', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

function openAddChargeModal(accountId) {
  document.getElementById('customerModalTitle').textContent = 'Add Charge';
  document.getElementById('customerModalBody').innerHTML = `
    <input type="hidden" id="chAcctId" value="${accountId}">
    <div class="form-group"><label>Description *</label><input type="text" id="chDesc"></div>
    <div class="form-row3">
      <div class="form-group"><label>Quantity</label><input type="number" id="chQty" value="1" min="1"></div>
      <div class="form-group"><label>Unit Cost</label><input type="number" id="chCost" step="0.01" value="0"></div>
      <div class="form-group"><label>Date</label><input type="date" id="chDate" value="${new Date().toISOString().split('T')[0]}"></div>
    </div>
    <div class="form-actions">
      <button class="btn-primary" onclick="saveCharge()">Save</button>
      <button class="btn-secondary" onclick="closeCustomerModal()">Cancel</button>
    </div>`;
  document.getElementById('customerModal').classList.add('active');
}

async function saveCharge() {
  const accountId = document.getElementById('chAcctId').value;
  const data = {
    description: document.getElementById('chDesc').value.trim(),
    quantity: parseInt(document.getElementById('chQty').value) || 1,
    unit_cost: parseFloat(document.getElementById('chCost').value) || 0,
    order_date: document.getElementById('chDate').value
  };
  if (!data.description) { toast('Description required', 'error'); return; }
  try {
    await API.addCharge(accountId, data);
    closeCustomerModal();
    loadAccountDetail(selectedAccount);
    toast('Charge added', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

async function editCharge(id) {
  try {
    const charges = await API.getCharges(selectedAccount);
    const c = charges.find(ch => ch.id === id);
    if (!c) { toast('Charge not found', 'error'); return; }
    document.getElementById('customerModalTitle').textContent = 'Edit Charge';
    document.getElementById('customerModalBody').innerHTML = `
      <input type="hidden" id="chEditId" value="${c.id}">
      <div class="form-group"><label>Description *</label><input type="text" id="chDesc" value="${(c.description || '').replace(/"/g, '&quot;')}"></div>
      <div class="form-row3">
        <div class="form-group"><label>Quantity</label><input type="number" id="chQty" value="${c.quantity || 1}" min="1"></div>
        <div class="form-group"><label>Unit Cost</label><input type="number" id="chCost" step="0.01" value="${c.unit_cost || 0}"></div>
        <div class="form-group"><label>Date</label><input type="date" id="chDate" value="${c.order_date || ''}"></div>
      </div>
      <div class="form-actions">
        <button class="btn-primary" onclick="saveEditCharge()">Update</button>
        <button class="btn-secondary" onclick="closeCustomerModal()">Cancel</button>
      </div>`;
    document.getElementById('customerModal').classList.add('active');
  } catch (e) { toast(e.message, 'error'); }
}

async function saveEditCharge() {
  const id = document.getElementById('chEditId').value;
  const data = {
    description: document.getElementById('chDesc').value.trim(),
    quantity: parseInt(document.getElementById('chQty').value) || 1,
    unit_cost: parseFloat(document.getElementById('chCost').value) || 0,
    order_date: document.getElementById('chDate').value
  };
  if (!data.description) { toast('Description required', 'error'); return; }
  try {
    await API.updateCharge(id, data);
    closeCustomerModal();
    loadAccountDetail(selectedAccount);
    toast('Charge updated', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

async function removeCharge(id) {
  if (!confirm('Delete this charge?')) return;
  try {
    await API.deleteCharge(id);
    loadAccountDetail(selectedAccount);
    toast('Charge deleted', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

async function generateMonthlyInvoices() {
  try {
    const result = await API.generateMonthly(currentPeriod);
    toast('Monthly invoices generated', 'success');
    if (selectedAccount) loadAccountDetail(selectedAccount);
  } catch (e) { toast(e.message, 'error'); }
}

async function sendDoorInvoiceToQB(invoiceId) {
  if (!confirm('Create invoice in QuickBooks and email to customer?')) return;
  try {
    const r = await API.post('/api/door-invoices/' + invoiceId + '/send-qb', {});
    if (r.ok) {
      toast('Invoice #' + (r.docNumber || r.qbInvoiceId) + ' created in QB and emailed!', 'success');
      if (selectedAccount) loadAccountDetail(selectedAccount);
    } else {
      toast('Error: ' + (r.error || 'Unknown'), 'error');
    }
  } catch (e) { toast('Failed: ' + e.message, 'error'); }
}
