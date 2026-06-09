let qbInvoices = [];
let qbCustomers = [];
let qbConnected = false;

async function loadQBStatus() {
  try {
    const status = await API.get('/api/qb/status');
    qbConnected = status.connected;
    return status;
  } catch { qbConnected = false; }
}

async function loadQBInvoices() {
  await loadQBStatus();
  if (!qbConnected) {
    document.getElementById('qbInvoicesContent').innerHTML = `
      <div style="text-align:center;padding:60px;">
        <h2 style="color:var(--brand);margin-bottom:12px;">QuickBooks Not Connected</h2>
        <p style="color:var(--muted);margin-bottom:20px;">Connect to QuickBooks to view and create invoices.</p>
        <button class="btn-primary" onclick="connectQB()">Connect QuickBooks</button>
      </div>`;
    return;
  }

  try {
    [qbInvoices, qbCustomers] = await Promise.all([
      API.get('/api/qb/invoices'),
      API.get('/api/qb/customers')
    ]);
    renderQBInvoices();
  } catch (e) { toast('Failed to load QB data: ' + e.message, 'error'); }
}

function renderQBInvoices() {
  const content = document.getElementById('qbInvoicesContent');

  const totalInvoiced = qbInvoices.reduce((s, i) => s + (i.TotalAmt || 0), 0);
  const totalOutstanding = qbInvoices.reduce((s, i) => s + (i.Balance || 0), 0);
  const totalPaid = totalInvoiced - totalOutstanding;
  const overdue = qbInvoices.filter(i => i.Balance > 0 && i.DueDate && new Date(i.DueDate) < new Date()).length;

  const tabs = `
    <div style="display:flex;gap:0;margin-bottom:16px;">
      <button class="board-tab active" onclick="filterQBInvoices('all',this)">All (${qbInvoices.length})</button>
      <button class="board-tab" onclick="filterQBInvoices('open',this)">Open (${qbInvoices.filter(i=>i.Balance>0).length})</button>
      <button class="board-tab" onclick="filterQBInvoices('paid',this)">Paid (${qbInvoices.filter(i=>i.Balance===0).length})</button>
      <button class="board-tab" onclick="filterQBInvoices('overdue',this)">Overdue (${overdue})</button>
    </div>`;

  content.innerHTML = `
    <div class="stats-grid" style="padding:0 0 16px;">
      <div class="stat-card"><div class="stat-label">Total Invoiced</div><div class="stat-value">$${totalInvoiced.toLocaleString()}</div></div>
      <div class="stat-card"><div class="stat-label">Collected</div><div class="stat-value" style="color:var(--green);">$${totalPaid.toLocaleString()}</div></div>
      <div class="stat-card"><div class="stat-label">Outstanding</div><div class="stat-value" style="color:var(--yellow);">$${totalOutstanding.toLocaleString()}</div></div>
      <div class="stat-card"><div class="stat-label">Overdue</div><div class="stat-value" style="color:var(--red);">${overdue}</div></div>
    </div>
    ${tabs}
    <div id="qbInvoicesList"></div>`;

  filterQBInvoices('all', document.querySelector('.board-tab.active'));
}

function filterQBInvoices(filter, btn) {
  document.querySelectorAll('#view-qb-invoices .board-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');

  let filtered = qbInvoices;
  if (filter === 'open') filtered = qbInvoices.filter(i => i.Balance > 0);
  if (filter === 'paid') filtered = qbInvoices.filter(i => i.Balance === 0);
  if (filter === 'overdue') filtered = qbInvoices.filter(i => i.Balance > 0 && i.DueDate && new Date(i.DueDate) < new Date());

  document.getElementById('qbInvoicesList').innerHTML = `
    <table class="data-table">
      <thead><tr><th>Invoice #</th><th>Customer</th><th>Date</th><th>Due</th><th>Total</th><th>Balance</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${filtered.map(inv => {
        const bal = inv.Balance || 0;
        const total = inv.TotalAmt || 0;
        const badge = bal === 0 ? 'green' : (inv.DueDate && new Date(inv.DueDate) < new Date() ? 'red' : 'yellow');
        const status = bal === 0 ? 'Paid' : (inv.DueDate && new Date(inv.DueDate) < new Date() ? 'Overdue' : 'Open');
        const pct = total > 0 ? Math.round((1 - bal / total) * 100) : 100;
        return '<tr>' +
          '<td><strong>#' + (inv.DocNumber || inv.Id) + '</strong></td>' +
          '<td>' + (inv.CustomerRef ? inv.CustomerRef.name : '-') + '</td>' +
          '<td style="font-size:12px;color:var(--muted);">' + (inv.TxnDate || '-') + '</td>' +
          '<td style="font-size:12px;color:var(--muted);">' + (inv.DueDate || '-') + '</td>' +
          '<td><strong>$' + total.toLocaleString('en-US', {minimumFractionDigits:2}) + '</strong></td>' +
          '<td style="color:' + (bal > 0 ? 'var(--yellow)' : 'var(--green)') + ';">$' + bal.toLocaleString('en-US', {minimumFractionDigits:2}) + '</td>' +
          '<td><span class="badge badge-' + badge + '">' + status + '</span>' +
            (pct > 0 && pct < 100 ? ' <span style="font-size:10px;color:var(--muted);">' + pct + '% paid</span>' : '') + '</td>' +
          '<td class="actions">' +
            '<button onclick="viewQBInvoice(' + inv.Id + ')">View</button>' +
            (bal > 0 ? '<button onclick="createProgressInvoice(' + inv.Id + ')">Progress</button>' : '') +
            '<button onclick="emailQBInvoice(' + inv.Id + ')">Email</button>' +
          '</td></tr>';
      }).join('')}
      ${filtered.length === 0 ? '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:30px;">No invoices found</td></tr>' : ''}
      </tbody>
    </table>`;
}

async function connectQB() {
  try {
    const r = await API.get('/api/qb/connect');
    if (r.url) window.open(r.url, '_blank', 'width=600,height=700');
  } catch (e) { toast('Connect failed: ' + e.message, 'error'); }
}

async function viewQBInvoice(id) {
  try {
    const inv = await API.get('/api/qb/invoices/' + id);
    const lines = (inv.Line || []).filter(l => l.DetailType === 'SalesItemLineDetail');
    document.getElementById('customerModalTitle').textContent = 'Invoice #' + (inv.DocNumber || inv.Id);
    document.getElementById('customerModalBody').innerHTML = `
      <div style="display:flex;justify-content:space-between;margin-bottom:16px;">
        <div><strong style="color:var(--brand);">Customer:</strong> ${inv.CustomerRef ? inv.CustomerRef.name : '-'}</div>
        <div><strong style="color:var(--brand);">Date:</strong> ${inv.TxnDate || '-'}</div>
      </div>
      <table class="data-table" style="font-size:12px;">
        <thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
        <tbody>${lines.map(l => {
          const d = l.SalesItemLineDetail || {};
          return '<tr><td>' + (l.Description || d.ItemRef?.name || '-') + '</td><td>' + (d.Qty || 1) + '</td><td>$' + (d.UnitPrice || 0).toFixed(2) + '</td><td style="text-align:right;font-weight:600;">$' + (l.Amount || 0).toFixed(2) + '</td></tr>';
        }).join('')}
        <tr style="border-top:2px solid var(--brand);background:var(--dark3);"><td colspan="3" style="font-weight:700;">Total</td><td style="text-align:right;font-weight:700;font-size:14px;">$${(inv.TotalAmt || 0).toFixed(2)}</td></tr>
        <tr><td colspan="3" style="color:var(--muted);">Balance Due</td><td style="text-align:right;font-weight:700;color:${inv.Balance > 0 ? 'var(--yellow)' : 'var(--green)'};">$${(inv.Balance || 0).toFixed(2)}</td></tr>
        </tbody>
      </table>
      ${inv.CustomerMemo ? '<div style="margin-top:12px;padding:10px;background:var(--dark);border-radius:6px;font-size:12px;color:var(--muted);">' + inv.CustomerMemo.value + '</div>' : ''}
      <div class="form-actions" style="margin-top:16px;">
        <button class="btn-secondary" onclick="emailQBInvoice(${inv.Id})">Email Invoice</button>
        <button class="btn-secondary" onclick="closeCustomerModal()">Close</button>
      </div>`;
    document.getElementById('customerModal').classList.add('active');
  } catch (e) { toast(e.message, 'error'); }
}

async function emailQBInvoice(id) {
  try {
    await API.post('/api/qb/invoices/' + id + '/send-email-graph', {});
    toast('Invoice emailed', 'success');
  } catch (e) { toast('Email failed: ' + e.message, 'error'); }
}

// Progressive Invoice from Estimate
async function createProgressiveFromEstimate(jobId) {
  const job = jobs.find(j => j.id === jobId);
  if (!job) { toast('Job not found', 'error'); return; }

  // Find or create QB customer
  let qbCustRef = null;
  if (job.customer_id) {
    const cust = customers.find(c => c.id === job.customer_id);
    if (cust) {
      const qbCust = qbCustomers.find(q => q.DisplayName.toLowerCase() === cust.name.toLowerCase());
      if (qbCust) {
        qbCustRef = { value: qbCust.Id, name: qbCust.DisplayName };
      } else {
        try {
          const newCust = await API.post('/api/qb/customers', {
            DisplayName: cust.name,
            PrimaryEmailAddr: cust.email ? { Address: cust.email } : undefined,
            PrimaryPhone: cust.phone ? { FreeFormNumber: cust.phone } : undefined
          });
          qbCustRef = { value: newCust.Id, name: newCust.DisplayName };
          qbCustomers.push(newCust);
          toast('Customer synced to QB: ' + cust.name, 'success');
        } catch (e) { toast('Failed to sync customer: ' + e.message, 'error'); }
      }
    }
  }

  // Load estimate items
  let items = [];
  try { items = await API.getEstimateItems(jobId); } catch {}

  // Build progressive invoice modal
  const totalEstimate = job.quoted_price || items.reduce((s, i) => s + (i.amount || 0), 0);
  const paid1 = job.first_invoice_paid ? (job.first_invoice_amount || 0) : 0;
  const paid2 = job.second_invoice_paid ? (job.second_invoice_amount || 0) : 0;
  const totalPaid = paid1 + paid2;
  const remaining = totalEstimate - totalPaid;

  document.getElementById('customerModalTitle').textContent = 'Progressive Invoice — ' + job.job_name;
  document.getElementById('customerModalBody').innerHTML = `
    <div style="display:flex;gap:12px;margin-bottom:16px;">
      <div class="stat-card" style="flex:1;"><div class="stat-label">Estimate Total</div><div class="stat-value" style="font-size:18px;">$${totalEstimate.toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>
      <div class="stat-card" style="flex:1;"><div class="stat-label">Previously Invoiced</div><div class="stat-value" style="font-size:18px;color:var(--green);">$${totalPaid.toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>
      <div class="stat-card" style="flex:1;"><div class="stat-label">Remaining</div><div class="stat-value" style="font-size:18px;color:var(--yellow);">$${remaining.toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>
    </div>
    <div class="form-group">
      <label>Invoice Type</label>
      <select id="progType" onchange="updateProgressAmount()">
        <option value="deposit">Deposit (50%)</option>
        <option value="milestone">Milestone Payment</option>
        <option value="final">Final Payment (Remaining Balance)</option>
        <option value="custom">Custom Amount</option>
      </select>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Invoice Amount *</label><input type="number" id="progAmount" step="0.01" value="${(totalEstimate * 0.5).toFixed(2)}"></div>
      <div class="form-group"><label>Due Date</label><input type="date" id="progDue" value="${new Date(Date.now() + 30*86400000).toISOString().split('T')[0]}"></div>
    </div>
    <div class="form-group"><label>Description / Memo</label><input type="text" id="progDesc" value="Progress payment — ${job.job_name}${job.estimate_number ? ' (Est. ' + job.estimate_number + ')' : ''}"></div>

    <h4 style="color:var(--brand);margin:16px 0 8px;font-size:13px;">Line Items from Estimate</h4>
    <div id="progLineItems">
      ${items.length > 0 ? items.map((item, i) => `
        <div style="display:flex;gap:8px;margin-bottom:4px;align-items:center;">
          <input type="checkbox" id="progLine${i}" checked>
          <span style="flex:1;font-size:12px;">${item.description}</span>
          <span style="font-size:12px;color:var(--brand);">$${(item.amount || 0).toFixed(2)}</span>
        </div>`).join('') : '<div style="color:var(--muted);font-size:12px;">No line items — will invoice as single line</div>'}
    </div>

    <input type="hidden" id="progJobId" value="${jobId}">
    <input type="hidden" id="progEstTotal" value="${totalEstimate}">
    <input type="hidden" id="progRemaining" value="${remaining}">
    <input type="hidden" id="progCustRef" value='${qbCustRef ? JSON.stringify(qbCustRef) : ""}'>

    <div class="form-actions" style="margin-top:16px;">
      <button class="btn-primary" onclick="submitProgressInvoice()">Create Invoice in QuickBooks</button>
      <button class="btn-secondary" onclick="closeCustomerModal()">Cancel</button>
    </div>`;

  document.getElementById('customerModal').classList.add('active');
}

function updateProgressAmount() {
  const type = document.getElementById('progType').value;
  const total = parseFloat(document.getElementById('progEstTotal').value) || 0;
  const remaining = parseFloat(document.getElementById('progRemaining').value) || 0;
  const amtField = document.getElementById('progAmount');

  if (type === 'deposit') amtField.value = (total * 0.5).toFixed(2);
  else if (type === 'final') amtField.value = remaining.toFixed(2);
  else if (type === 'milestone') amtField.value = (total * 0.25).toFixed(2);
}

async function submitProgressInvoice() {
  const jobId = document.getElementById('progJobId').value;
  const amount = parseFloat(document.getElementById('progAmount').value);
  const dueDate = document.getElementById('progDue').value;
  const desc = document.getElementById('progDesc').value;
  const custRefStr = document.getElementById('progCustRef').value;

  if (!amount || amount <= 0) { toast('Enter an amount', 'error'); return; }

  let custRef = null;
  try { custRef = JSON.parse(custRefStr); } catch {}

  if (!custRef) { toast('No QuickBooks customer linked — sync customer first', 'error'); return; }

  const invoice = {
    CustomerRef: custRef,
    DueDate: dueDate,
    Line: [{
      Amount: amount,
      DetailType: 'SalesItemLineDetail',
      Description: desc,
      SalesItemLineDetail: {
        ItemRef: { value: '1', name: 'Services' },
        UnitPrice: amount,
        Qty: 1
      }
    }],
    CustomerMemo: { value: desc }
  };

  try {
    const result = await API.post('/api/qb/invoices', invoice);
    if (result.Id) {
      toast('Invoice #' + (result.DocNumber || result.Id) + ' created in QuickBooks — $' + amount.toFixed(2), 'success');

      // Update job invoice tracking
      const job = jobs.find(j => j.id == jobId);
      if (job) {
        const update = {};
        if (!job.first_invoice_sent) {
          update.first_invoice_sent = new Date().toISOString().split('T')[0];
          update.first_invoice_amount = amount;
        } else if (!job.second_invoice_sent) {
          update.second_invoice_sent = new Date().toISOString().split('T')[0];
          update.second_invoice_amount = amount;
        }
        if (Object.keys(update).length > 0) await API.updateJob(jobId, update);
      }

      closeCustomerModal();
      await loadQBInvoices();
    } else {
      toast('QB error: ' + JSON.stringify(result).substring(0, 200), 'error');
    }
  } catch (e) { toast('Failed: ' + e.message, 'error'); }
}

// Sync estimate to QB as estimate object
async function syncEstimateToQB(jobId) {
  const job = jobs.find(j => j.id === jobId);
  if (!job) { toast('Job not found', 'error'); return; }

  let qbCustRef = null;
  if (job.customer_id) {
    const cust = customers.find(c => c.id === job.customer_id);
    if (cust) {
      const qbCust = qbCustomers.find(q => q.DisplayName.toLowerCase() === cust.name.toLowerCase());
      if (qbCust) {
        qbCustRef = { value: qbCust.Id, name: qbCust.DisplayName };
      } else {
        try {
          const newCust = await API.post('/api/qb/customers', {
            DisplayName: cust.name,
            PrimaryEmailAddr: cust.email ? { Address: cust.email } : undefined,
            PrimaryPhone: cust.phone ? { FreeFormNumber: cust.phone } : undefined
          });
          qbCustRef = { value: newCust.Id, name: newCust.DisplayName };
          qbCustomers.push(newCust);
        } catch (e) { toast('Customer sync failed: ' + e.message, 'error'); return; }
      }
    }
  }

  if (!qbCustRef) { toast('No customer linked to this job', 'error'); return; }

  let items = [];
  try { items = await API.getEstimateItems(jobId); } catch {}

  const lines = items.length > 0
    ? items.map(item => ({
        Amount: item.amount || 0,
        DetailType: 'SalesItemLineDetail',
        Description: item.description || '',
        SalesItemLineDetail: {
          ItemRef: { value: '1', name: 'Services' },
          UnitPrice: item.rate || 0,
          Qty: item.quantity || 1
        }
      }))
    : [{
        Amount: job.quoted_price || 0,
        DetailType: 'SalesItemLineDetail',
        Description: job.job_name + (job.job_color ? ' — ' + job.job_color : ''),
        SalesItemLineDetail: {
          ItemRef: { value: '1', name: 'Services' },
          UnitPrice: job.quoted_price || 0,
          Qty: 1
        }
      }];

  try {
    const result = await API.post('/api/qb/invoices', {
      CustomerRef: qbCustRef,
      DueDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      Line: lines,
      CustomerMemo: { value: 'Estimate ' + (job.estimate_number || '') + ' — ' + job.job_name }
    });

    if (result.Id) {
      toast('Estimate synced to QB as Invoice #' + (result.DocNumber || result.Id), 'success');
    } else {
      toast('QB error: ' + JSON.stringify(result).substring(0, 200), 'error');
    }
  } catch (e) { toast('Sync failed: ' + e.message, 'error'); }
}

function createProgressInvoice(qbInvoiceId) {
  // Find the job linked to this QB invoice
  const inv = qbInvoices.find(i => i.Id === qbInvoiceId);
  if (!inv) return;
  // For now open the estimate modal approach with the customer pre-filled
  toast('Use the Estimates view to create progressive invoices from jobs', 'success');
}
