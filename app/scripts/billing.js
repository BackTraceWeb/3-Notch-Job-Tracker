let qbInvoices = [];
let qbCustomers = [];
let qbEstimates = [];
let qbConnected = false;
let billingTab = 'invoices';
let billingRefreshTimer = null;

async function loadBillingView() {
  try {
    const status = await API.get('/api/qb/status');
    qbConnected = status.connected;
  } catch { qbConnected = false; }

  if (!qbConnected) {
    document.getElementById('billingContent').innerHTML = `
      <div style="text-align:center;padding:60px;">
        <h2 style="color:var(--brand);margin-bottom:12px;">QuickBooks Not Connected</h2>
        <p style="color:var(--muted);margin-bottom:20px;">Connect to QuickBooks to manage estimates and invoices.</p>
        <button class="btn-primary" onclick="connectQB()">Connect QuickBooks</button>
      </div>`;
    return;
  }

  try {
    const [cached, cust, localJobs, items] = await Promise.all([
      API.get('/api/qb/cached'),
      API.get('/api/qb/customers'),
      API.getJobs(),
      API.get('/api/qb/items').catch(() => [])
    ]);
    qbCustomers = cust;
    jobs = localJobs;
    qbItems = items;

    // Always fetch live invoices for accurate payment status
    try { qbInvoices = await API.get('/api/qb/invoices'); }
    catch { qbInvoices = cached.invoices || []; }

    try { qbEstimates = await API.get('/api/qb/estimates'); } catch {}

    renderBillingView();

    // Auto-refresh every 60 seconds while billing tab is active
    if (billingRefreshTimer) clearInterval(billingRefreshTimer);
    billingRefreshTimer = setInterval(() => {
      if (document.getElementById('view-billing').classList.contains('active')) {
        loadBillingView();
      } else {
        clearInterval(billingRefreshTimer);
        billingRefreshTimer = null;
      }
    }, 60000);
  } catch (e) { toast('Failed to load billing: ' + e.message, 'error'); }
}


function renderBillingView() {
  const totalInvoiced = qbInvoices.reduce((s, i) => s + (i.TotalAmt || 0), 0);
  const totalOutstanding = qbInvoices.reduce((s, i) => s + (i.Balance || 0), 0);
  const totalPaid = totalInvoiced - totalOutstanding;
  const overdue = qbInvoices.filter(i => i.Balance > 0 && i.DueDate && new Date(i.DueDate) < new Date()).length;

  const localEstimates = jobs.filter(j => j.estimate_number);

  document.getElementById('billingContent').innerHTML = `
    <div class="stats-grid" style="padding:0 0 16px;">
      <div class="stat-card"><div class="stat-label">Total Revenue</div><div class="stat-value">$${totalInvoiced.toLocaleString()}</div></div>
      <div class="stat-card"><div class="stat-label">Collected</div><div class="stat-value" style="color:var(--green);">$${totalPaid.toLocaleString()}</div></div>
      <div class="stat-card"><div class="stat-label">Outstanding</div><div class="stat-value" style="color:var(--yellow);">$${totalOutstanding.toLocaleString()}</div></div>
      <div class="stat-card"><div class="stat-label">Estimates</div><div class="stat-value">${localEstimates.length}</div></div>
    </div>
    <div style="display:flex;gap:0;margin-bottom:16px;flex-wrap:wrap;">
      <button class="board-tab ${billingTab === 'invoices' ? 'active' : ''}" onclick="switchBillingTab('invoices',this)">Invoices (${qbInvoices.length})</button>
      <button class="board-tab ${billingTab === 'estimates' ? 'active' : ''}" onclick="switchBillingTab('estimates',this)">Estimates (${localEstimates.length})</button>
      <button class="board-tab ${billingTab === 'open' ? 'active' : ''}" onclick="switchBillingTab('open',this)">Open (${qbInvoices.filter(i => i.Balance > 0).length})</button>
      <button class="board-tab ${billingTab === 'paid' ? 'active' : ''}" onclick="switchBillingTab('paid',this)">Paid (${qbInvoices.filter(i => i.Balance === 0).length})</button>
      <button class="board-tab ${billingTab === 'overdue' ? 'active' : ''}" onclick="switchBillingTab('overdue',this)">Overdue (${overdue})</button>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:16px;">
      <button class="btn-primary" onclick="openEstimateModal()">+ New Estimate</button>
      <button class="btn-primary" onclick="newAdhocInvoiceFromBilling()" style="background:var(--green);">+ New Invoice</button>
      <button class="btn-secondary" onclick="loadBillingView()">Refresh</button>
    </div>
    <div id="billingTableWrap"></div>`;

  switchBillingTab(billingTab);
}

function switchBillingTab(tab, btn) {
  billingTab = tab;
  document.querySelectorAll('#view-billing .board-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  else document.querySelectorAll('#view-billing .board-tab').forEach(t => { if (t.textContent.toLowerCase().startsWith(tab)) t.classList.add('active'); });

  const wrap = document.getElementById('billingTableWrap');

  if (tab === 'estimates') {
    const ests = jobs.filter(j => j.estimate_number).sort((a, b) => (b.estimate_number || '').localeCompare(a.estimate_number || ''));
    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Estimate #</th><th>Customer</th><th>Job</th><th>Date</th><th>Amount</th><th>QB Invoices</th><th>Email</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${ests.map(j => {
          const cust = customers.find(c => c.id === j.customer_id);

          const custName = cust ? cust.name.toLowerCase() : '';
          const linkedInv = qbInvoices.filter(inv => {
            const qbCust = inv.CustomerRef ? inv.CustomerRef.name.toLowerCase() : '';
            if (qbCust !== custName) return false;
            const memo = inv.CustomerMemo ? (inv.CustomerMemo.value || '').toLowerCase() : '';
            return memo.includes(j.job_name.toLowerCase()) ||
              (j.estimate_number && memo.includes(j.estimate_number.toLowerCase())) ||
              j.quoted_price === inv.TotalAmt ||
              j.first_invoice_amount === inv.TotalAmt ||
              j.second_invoice_amount === inv.TotalAmt;
          });

          const totalInvoiced = linkedInv.reduce((s, i) => s + (i.TotalAmt || 0), 0);
          const totalBal = linkedInv.reduce((s, i) => s + (i.Balance || 0), 0);
          const allPaid = linkedInv.length > 0 && totalBal === 0;
          const partialPaid = linkedInv.length > 0 && totalBal > 0 && totalBal < totalInvoiced;

          let badge, status;
          if (allPaid) { badge = 'green'; status = 'Paid'; }
          else if (partialPaid) { badge = 'yellow'; status = Math.round((1 - totalBal/totalInvoiced)*100) + '% Paid'; }
          else if (linkedInv.length > 0) { badge = 'yellow'; status = 'Invoiced'; }
          else { badge = 'blue'; status = 'Estimate'; }

          // Email status from QB estimate + local approval
          const estNum = (j.estimate_number || '').replace('EST-', '');
          const qbEst = qbEstimates.find(e => e.DocNumber === estNum);
          const qbEmailStatus = qbEst ? qbEst.EmailStatus : '';
          const qbTxnStatus = qbEst ? qbEst.TxnStatus : '';
          const localSent = j.approval_token ? true : false;

          let emailBadge = '';
          if (j.estimate_approved) {
            emailBadge = '<span class="badge badge-green" style="font-size:9px;">Approved</span>';
          } else if (qbEmailStatus === 'EmailSent' || localSent) {
            emailBadge = '<span class="badge badge-blue" style="font-size:9px;">Sent</span>';
          } else if (qbEmailStatus === 'NeedToSend') {
            emailBadge = '<span class="badge badge-yellow" style="font-size:9px;">Pending</span>';
          } else {
            emailBadge = '<span style="font-size:10px;color:var(--muted);">Not sent</span>';
          }
          if (qbTxnStatus === 'Accepted' && !j.estimate_approved) {
            emailBadge = '<span class="badge badge-green" style="font-size:9px;">Accepted</span>';
          }

          const invHtml = linkedInv.length > 0
            ? linkedInv.map(i => '<div style="font-size:11px;"><span style="color:var(--muted);">#' + (i.DocNumber||i.Id) + '</span> $' + (i.TotalAmt||0).toLocaleString('en-US',{minimumFractionDigits:2}) + ' <span class="badge badge-' + (i.Balance===0?'green':'yellow') + '" style="font-size:9px;">' + (i.Balance===0?'Paid':'$'+i.Balance+' due') + '</span></div>').join('')
            : '<span style="font-size:11px;color:var(--muted);">None</span>';

          return '<tr><td><strong>' + j.estimate_number + '</strong></td><td>' + (cust ? cust.name : '-') + '</td><td>' + j.job_name + '</td><td style="font-size:12px;color:var(--muted);">' + (j.estimate_date || '-') + '</td><td><strong>' + (j.quoted_price ? '$' + j.quoted_price.toLocaleString('en-US', {minimumFractionDigits: 2}) : '-') + '</strong></td><td>' + invHtml + '</td><td>' + emailBadge + '</td><td><span class="badge badge-' + badge + '">' + status + '</span></td><td class="actions"><button onclick="editEstimate(' + j.id + ')">Edit</button><button onclick="printEstimateFromList(' + j.id + ')">PDF</button><button onclick="emailEstimateFromQB(' + j.id + ')" style="color:var(--blue);border-color:var(--blue);">Email</button><button onclick="syncEstimateToQB(' + j.id + ')" style="color:var(--green);border-color:var(--green);">Sync QB</button><button onclick="createProgressiveFromEstimate(' + j.id + ')" style="color:var(--brand);border-color:var(--brand);">Invoice</button></td></tr>';
        }).join('')}
        ${ests.length === 0 ? '<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--muted);">No estimates. Click "+ New Estimate" to create one.</td></tr>' : ''}
        </tbody>
      </table>`;
    return;
  }

  let filtered = qbInvoices;
  if (tab === 'open') filtered = qbInvoices.filter(i => i.Balance > 0);
  if (tab === 'paid') filtered = qbInvoices.filter(i => i.Balance === 0);
  if (tab === 'overdue') filtered = qbInvoices.filter(i => i.Balance > 0 && i.DueDate && new Date(i.DueDate) < new Date());

  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Invoice #</th><th>Customer</th><th>Date</th><th>Due</th><th>Total</th><th>Paid</th><th>Balance</th><th>Email</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${filtered.map(inv => {
        const bal = inv.Balance || 0;
        const total = inv.TotalAmt || 0;
        const paidAmt = total - bal;
        const badge = bal === 0 ? 'green' : (inv.DueDate && new Date(inv.DueDate) < new Date() ? 'red' : 'yellow');
        const status = bal === 0 ? 'Paid' : (inv.DueDate && new Date(inv.DueDate) < new Date() ? 'Overdue' : 'Open');
        const pct = total > 0 ? Math.round(paidAmt / total * 100) : 100;
        const invEmail = inv.EmailStatus === 'EmailSent' ? '<span class="badge badge-green" style="font-size:9px;">Sent</span>'
          : inv.EmailStatus === 'NeedToSend' ? '<span class="badge badge-yellow" style="font-size:9px;">Pending</span>'
          : '<span style="font-size:10px;color:var(--muted);">Not sent</span>';
        return '<tr>' +
          '<td><strong>#' + (inv.DocNumber || inv.Id) + '</strong></td>' +
          '<td>' + (inv.CustomerRef ? inv.CustomerRef.name : '-') + '</td>' +
          '<td style="font-size:12px;color:var(--muted);">' + (inv.TxnDate || '-') + '</td>' +
          '<td style="font-size:12px;color:var(--muted);">' + (inv.DueDate || '-') + '</td>' +
          '<td><strong>$' + total.toLocaleString('en-US', {minimumFractionDigits: 2}) + '</strong></td>' +
          '<td style="color:var(--green);">$' + paidAmt.toLocaleString('en-US', {minimumFractionDigits: 2}) + '</td>' +
          '<td style="color:' + (bal > 0 ? 'var(--yellow)' : 'var(--green)') + ';">$' + bal.toLocaleString('en-US', {minimumFractionDigits: 2}) + '</td>' +
          '<td>' + invEmail + '</td>' +
          '<td><span class="badge badge-' + badge + '">' + status + '</span>' +
            (pct > 0 && pct < 100 ? '<div class="progress-bar" style="margin-top:4px;width:60px;"><div class="progress-fill" style="width:' + pct + '%;"></div></div>' : '') + '</td>' +
          '<td class="actions">' +
            '<button onclick="viewQBInvoice(' + inv.Id + ')">View</button>' +
            '<button onclick="printQBInvoice(' + inv.Id + ')">Print</button>' +
            '<button onclick="emailQBInvoice(' + inv.Id + ')">Email</button>' +
            (inv.DueDate && new Date(inv.DueDate) < new Date() && bal > 0 ? '<button onclick="remindQBInvoice(' + inv.Id + ')" style="color:var(--yellow);border-color:var(--yellow);">Remind</button>' : '') +
          '</td></tr>';
      }).join('')}
      ${filtered.length === 0 ? '<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--muted);">No invoices</td></tr>' : ''}
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
        <div><strong style="color:var(--brand);">Date:</strong> ${inv.TxnDate || '-'} &nbsp; <strong style="color:var(--brand);">Due:</strong> ${inv.DueDate || '-'}</div>
      </div>
      <table class="data-table" style="font-size:12px;">
        <thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th style="text-align:right;">Amount</th></tr></thead>
        <tbody>${lines.map(l => {
          const d = l.SalesItemLineDetail || {};
          return '<tr><td>' + (l.Description || d.ItemRef?.name || '-') + '</td><td>' + (d.Qty || 1) + '</td><td>$' + (d.UnitPrice || 0).toFixed(2) + '</td><td style="text-align:right;font-weight:600;">$' + (l.Amount || 0).toFixed(2) + '</td></tr>';
        }).join('')}
        <tr style="border-top:2px solid var(--brand);background:var(--dark3);"><td colspan="3" style="font-weight:700;">Total</td><td style="text-align:right;font-weight:700;font-size:14px;">$${(inv.TotalAmt || 0).toFixed(2)}</td></tr>
        <tr><td colspan="3" style="color:var(--green);">Paid</td><td style="text-align:right;color:var(--green);">$${((inv.TotalAmt || 0) - (inv.Balance || 0)).toFixed(2)}</td></tr>
        <tr><td colspan="3" style="color:${inv.Balance > 0 ? 'var(--yellow)' : 'var(--green)'};">Balance Due</td><td style="text-align:right;font-weight:700;color:${inv.Balance > 0 ? 'var(--yellow)' : 'var(--green)'};">$${(inv.Balance || 0).toFixed(2)}</td></tr>
        </tbody>
      </table>
      ${inv.CustomerMemo ? '<div style="margin-top:12px;padding:10px;background:var(--dark);border-radius:6px;font-size:12px;color:var(--muted);">' + inv.CustomerMemo.value + '</div>' : ''}
      <div class="form-actions" style="margin-top:16px;">
        <button class="btn-primary" onclick="emailQBInvoice(${inv.Id})">Email Invoice</button>
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

async function remindQBInvoice(id) {
  const inv = qbInvoices.find(i => i.Id === id);
  const name = inv && inv.CustomerRef ? inv.CustomerRef.name : 'customer';
  if (!confirm('Send payment reminder to ' + name + '?')) return;
  try {
    await API.post('/api/qb/invoices/' + id + '/send-email-graph', {});
    toast('Reminder sent to ' + name, 'success');
  } catch (e) { toast('Reminder failed: ' + e.message, 'error'); }
}

function printQBInvoice(id) {
  // Open QB invoice in a printable view
  const inv = qbInvoices.find(i => i.Id === id);
  if (!inv) return;
  const lines = (inv.Line || []).filter(l => l.DetailType === 'SalesItemLineDetail');
  const custName = inv.CustomerRef ? inv.CustomerRef.name : '-';
  const total = inv.TotalAmt || 0;
  const bal = inv.Balance || 0;

  let rows = lines.map((l,i) => {
    const d = l.SalesItemLineDetail || {};
    return '<tr style="background:'+(i%2?'#f8f7f5':'#fff')+'"><td style="padding:7px 10px;">'+(l.Description||'-')+'</td><td style="padding:7px 10px;text-align:center;">'+(d.Qty||1)+'</td><td style="padding:7px 10px;text-align:right;">$'+(d.UnitPrice||0).toFixed(2)+'</td><td style="padding:7px 10px;text-align:right;font-weight:600;">$'+(l.Amount||0).toFixed(2)+'</td></tr>';
  }).join('');

  const html = '<!DOCTYPE html><html><head><title>Invoice #'+(inv.DocNumber||inv.Id)+'</title><style>@page{size:letter;margin:.6in .75in;}*{margin:0;padding:0;box-sizing:border-box;}body{font-family:"Segoe UI",Arial,sans-serif;color:#1a1a1a;font-size:10.5pt;}table{width:100%;border-collapse:collapse;}th{background:#191917;color:#b8ae97;padding:8px 10px;text-align:left;}td{padding:7px 10px;border-bottom:1px solid #e0e0e0;}.total td{font-weight:700;font-size:12pt;border-top:2px solid #b8ae97;background:#f5f3ef;}</style></head><body>'+
    '<div style="display:flex;justify-content:space-between;border-bottom:3px solid #b8ae97;padding-bottom:15px;margin-bottom:20px;"><div><img src="https://www.3notchcabinets.com/logo-transparent.png" height="60"></div><div style="text-align:right;font-size:9pt;color:#555;"><h2 style="color:#b8ae97;font-size:16pt;">Invoice #'+(inv.DocNumber||inv.Id)+'</h2>3 Notch Cabinet Co<br>Opp, Alabama<br>(334) 493-0092</div></div>'+
    '<div style="display:flex;gap:20px;margin-bottom:20px;"><div style="flex:1;background:#f5f3ef;border-left:3px solid #b8ae97;padding:10px 15px;font-size:10pt;"><strong style="color:#b8ae97;">Bill To</strong><br>'+custName+'</div><div style="flex:1;background:#f5f3ef;border-left:3px solid #b8ae97;padding:10px 15px;font-size:10pt;"><strong style="color:#b8ae97;">Details</strong><br>Date: '+(inv.TxnDate||'-')+'<br>Due: '+(inv.DueDate||'-')+'<br>Balance: $'+bal.toFixed(2)+'</div></div>'+
    '<table><tr><th>Description</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Rate</th><th style="text-align:right;">Amount</th></tr>'+rows+
    '<tr class="total"><td colspan="3">Total</td><td style="text-align:right;">$'+total.toFixed(2)+'</td></tr></table>'+
    (inv.CustomerMemo?'<div style="margin-top:15px;padding:10px;background:#f5f3ef;border-left:3px solid #b8ae97;font-size:10pt;">'+inv.CustomerMemo.value+'</div>':'')+
    '<div style="text-align:center;margin-top:25px;font-size:8pt;color:#888;border-top:1px solid #ddd;padding-top:8px;">3 Notch Cabinet Co &bull; Opp, Alabama &bull; (334) 493-0092</div></body></html>';

  const win = window.open('','_blank');
  win.document.write(html);
  win.document.close();
}

let _newCustContext = null;

function openNewQBCustomer(context) {
  _newCustContext = context || null;
  document.getElementById('customerModalTitle').textContent = 'New Customer';
  document.getElementById('customerModalBody').innerHTML = `
    <div class="form-row">
      <div class="form-group"><label>Name *</label><input type="text" id="newCustName"></div>
      <div class="form-group"><label>Email</label><input type="text" id="newCustEmail"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Phone</label><input type="text" id="newCustPhone"></div>
      <div class="form-group"><label>Address</label><input type="text" id="newCustAddr"></div>
    </div>
    <div class="form-actions">
      <button class="btn-primary" onclick="saveNewQBCustomer()">Save to QuickBooks</button>
      <button class="btn-secondary" onclick="closeCustomerModal()">Cancel</button>
    </div>`;
  document.getElementById('customerModal').classList.add('active');
}

async function newAdhocInvoiceFromBilling() {
  // Show customer picker first
  let qbCusts = qbCustomers || [];
  if (qbCusts.length === 0) try { qbCusts = await API.get('/api/qb/customers'); qbCustomers = qbCusts; } catch {}

  const custOpts = qbCusts.sort((a,b) => (a.DisplayName||'').localeCompare(b.DisplayName||'')).map(c => '<option value="' + c.Id + '">' + c.DisplayName + '</option>').join('');

  document.getElementById('customerModalTitle').textContent = 'New Invoice';
  document.getElementById('customerModalBody').innerHTML = `
    <div class="form-group"><label>Customer *</label><select id="adhocCustPicker" onchange="if(this.value==='__new__'){this.value='';openNewQBCustomerForInvoice();}" style="width:100%;padding:9px 12px;background:var(--dark);border:1px solid var(--border);border-radius:6px;color:var(--light);font-family:'Oswald',sans-serif;font-size:14px;"><option value="">— Select Customer —</option><option value="__new__" style="color:#b8ae97;font-weight:700;">+ New Customer</option>${custOpts}</select></div>
    <div class="form-actions"><button class="btn-primary" onclick="openAdhocForSelected()">Next</button><button class="btn-secondary" onclick="closeCustomerModal()">Cancel</button></div>`;
  document.getElementById('customerModal').classList.add('active');
}

function openNewQBCustomerForInvoice() {
  closeCustomerModal();
  openNewQBCustomer('invoice');
}

function openAdhocForSelected() {
  const qbId = document.getElementById('adhocCustPicker').value;
  if (!qbId) { toast('Select a customer', 'error'); return; }
  closeCustomerModal();
  newAdhocInvoice(qbId);
}

async function emailEstimateFromQB(jobId) {
  const job = jobs.find(j => j.id === jobId);
  if (!job) { toast('Job not found', 'error'); return; }

  // Find the QB estimate for this job
  try { qbEstimates = await API.get('/api/qb/estimates'); } catch {}

  const cust = customers.find(c => c.id === job.customer_id);
  const custName = cust ? cust.name.toLowerCase() : '';

  const match = qbEstimates.find(e => {
    const qbCust = e.CustomerRef ? e.CustomerRef.name.toLowerCase() : '';
    if (qbCust !== custName) return false;
    const memo = e.CustomerMemo ? (e.CustomerMemo.value || '').toLowerCase() : '';
    return memo.includes(job.job_name.toLowerCase()) || (job.estimate_number && e.DocNumber === job.estimate_number.replace('EST-',''));
  });

  if (!match) {
    toast('Estimate not found in QB — click Sync QB first', 'error');
    return;
  }

  try {
    // QB sends estimates via the same send endpoint pattern
    // Send estimate email with approval link
    const email = prompt('Send estimate to email:', job.job_email || '');
    if (!email || !email.includes('@')) return;
    try {
      const result = await API.post('/api/jobs/' + jobId + '/send-estimate', { email });
      if (result.ok) {
        toast('Estimate emailed to ' + email + ' with approval link', 'success');
        loadBillingView();
      } else {
        toast('Failed: ' + (result.error || 'Unknown'), 'error');
      }
    } catch (e) { toast('Failed: ' + e.message, 'error'); }
  } catch (e) { toast('Email failed: ' + e.message, 'error'); }
}

async function saveNewQBCustomer() {
  const name = document.getElementById('newCustName').value.trim();
  if (!name) { toast('Name required', 'error'); return; }
  const email = document.getElementById('newCustEmail').value.trim();
  const phone = document.getElementById('newCustPhone').value.trim();
  const addr = document.getElementById('newCustAddr').value.trim();

  try {
    const qbCust = await API.post('/api/qb/customers', {
      DisplayName: name,
      PrimaryEmailAddr: email ? { Address: email } : undefined,
      PrimaryPhone: phone ? { FreeFormNumber: phone } : undefined,
      BillAddr: addr ? { Line1: addr } : undefined
    });
    await API.createCustomer({ name, email, phone, address: addr });
    qbCustomers.push(qbCust);
    toast('Customer created in QuickBooks: ' + name, 'success');
    closeCustomerModal();

    if (_newCustContext === 'invoice') {
      _newCustContext = null;
      setTimeout(() => {
        newAdhocInvoiceFromBilling();
        setTimeout(() => {
          const picker = document.getElementById('adhocCustPicker');
          if (picker) picker.value = qbCust.Id;
        }, 100);
      }, 200);
    } else {
      renderCustomers();
    }
  } catch (e) { toast('Failed: ' + e.message, 'error'); }
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
      <div class="form-group"><label>Due Date</label>
        <select id="progDueTerms" onchange="updateProgDue()" style="width:100%;padding:9px 12px;background:var(--dark);border:1px solid var(--border);border-radius:6px;color:var(--light);font-family:'Oswald',sans-serif;margin-bottom:6px;">
          <option value="0">Due on Receipt</option>
          <option value="10">Net 10</option>
          <option value="15">Net 15</option>
          <option value="30" selected>Net 30</option>
          <option value="custom">Custom</option>
        </select>
        <input type="date" id="progDue" value="${new Date(Date.now() + 30*86400000).toISOString().split('T')[0]}">
      </div>
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

function updateProgDue() {
  const terms = document.getElementById('progDueTerms').value;
  const dueDateField = document.getElementById('progDue');
  if (terms === 'custom') return;
  const days = parseInt(terms) || 0;
  const due = new Date(Date.now() + days * 86400000);
  dueDateField.value = due.toISOString().split('T')[0];
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

  // Get next invoice number from QB
  let nextDocNum = '';
  try {
    const allInv = qbInvoices.length > 0 ? qbInvoices : await API.get('/api/qb/invoices');
    const nums = allInv.map(i => parseInt(i.DocNumber || '0')).filter(n => !isNaN(n));
    nextDocNum = String(Math.max(...nums) + 1);
  } catch {}

  function matchItemRef2(desc) {
    if (qbItems && qbItems.length > 0) {
      const lower = (desc || '').toLowerCase();
      const match = qbItems.find(i => lower.startsWith(i.Name.toLowerCase()));
      if (match) return { value: match.Id, name: match.Name };
    }
    return { value: '1', name: 'Services' };
  }

  const invoice = {
    DocNumber: nextDocNum,
    CustomerRef: custRef,
    DueDate: dueDate,
    Line: [{
      Amount: amount,
      DetailType: 'SalesItemLineDetail',
      Description: desc,
      SalesItemLineDetail: {
        ItemRef: matchItemRef2(desc),
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
      await loadBillingView();
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

  function matchItemRef(desc) {
    if (qbItems && qbItems.length > 0) {
      const lower = (desc || '').toLowerCase();
      const match = qbItems.find(i => lower.startsWith(i.Name.toLowerCase()));
      if (match) return { value: match.Id, name: match.Name };
    }
    return { value: '1', name: 'Services' };
  }

  const lines = items.length > 0
    ? items.map(item => ({
        Amount: item.amount || 0,
        DetailType: 'SalesItemLineDetail',
        Description: item.description || '',
        SalesItemLineDetail: {
          ItemRef: matchItemRef(item.description),
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
    const estNum = (job.estimate_number || '').replace('EST-', '');
    const cust = customers.find(c => c.id === job.customer_id);
    const custEmail = cust ? cust.email : job.job_email;

    // Always fetch fresh from QB to check if estimate exists
    let existingEst = null;
    try {
      const freshEsts = await API.get('/api/qb/estimates');
      qbEstimates = freshEsts;
      existingEst = freshEsts.find(e => e.DocNumber === estNum);
    } catch {}

    const estBody = {
      DocNumber: estNum,
      CustomerRef: qbCustRef,
      TxnDate: job.estimate_date || new Date().toISOString().split('T')[0],
      ExpirationDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      TxnStatus: 'Pending',
      BillEmail: custEmail ? { Address: custEmail } : undefined,
      Line: lines,
      CustomerMemo: { value: 'Estimate ' + (job.estimate_number || '') + ' — ' + job.job_name }
    };

    if (existingEst) {
      estBody.Id = existingEst.Id;
      estBody.SyncToken = existingEst.SyncToken;
    }

    const result = await API.post('/api/qb/estimates', estBody);

    if (result.Id) {
      toast('Estimate #' + (result.DocNumber || estNum) + (existingEst ? ' updated' : ' synced') + ' in QuickBooks', 'success');
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
