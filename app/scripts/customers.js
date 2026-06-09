// Customers — QB is source of truth

async function renderCustomers() {
  const wrap = document.getElementById('customersTable');

  let qbCusts = [];
  try { qbCusts = await API.get('/api/qb/customers'); } catch {}

  if (qbCusts.length === 0) {
    wrap.innerHTML = '<div style="text-align:center;padding:60px;color:var(--muted);">QuickBooks not connected. Connect in Settings to see customers.</div>';
    return;
  }

  qbCustomers = qbCusts;
  const sorted = qbCusts.sort((a,b) => (a.DisplayName||'').localeCompare(b.DisplayName||''));

  // Get invoices for balance info
  let invoices = [];
  try { const cached = await API.get('/api/qb/cached'); invoices = cached.invoices || []; } catch {}
  if (invoices.length === 0) try { invoices = await API.get('/api/qb/invoices'); } catch {}

  wrap.innerHTML = `
    <div style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;">
      <span style="color:var(--muted);font-size:12px;">${sorted.length} customers from QuickBooks</span>
    </div>
    <table class="data-table">
      <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Address</th><th>Balance</th><th>Invoices</th><th>Actions</th></tr></thead>
      <tbody>${sorted.map(c => {
        const email = c.PrimaryEmailAddr ? c.PrimaryEmailAddr.Address : '-';
        const phone = c.PrimaryPhone ? c.PrimaryPhone.FreeFormNumber : '-';
        let addr = '-';
        if (c.BillAddr) {
          const parts = [c.BillAddr.Line1, c.BillAddr.City, c.BillAddr.CountrySubDivisionCode, c.BillAddr.PostalCode].filter(Boolean);
          addr = parts.join(', ') || '-';
        }
        const custInv = invoices.filter(i => i.CustomerRef && i.CustomerRef.name === c.DisplayName);
        const bal = custInv.reduce((s,i) => s + (i.Balance||0), 0);
        const openCount = custInv.filter(i => i.Balance > 0).length;
        const totalCount = custInv.length;

        return '<tr>' +
          '<td><strong>' + c.DisplayName + '</strong></td>' +
          '<td style="font-size:12px;">' + email + '</td>' +
          '<td style="font-size:12px;">' + phone + '</td>' +
          '<td style="font-size:11px;color:var(--muted);">' + addr + '</td>' +
          '<td style="color:' + (bal > 0 ? 'var(--yellow)' : 'var(--green)') + ';">$' + bal.toFixed(2) + '</td>' +
          '<td style="font-size:12px;">' + totalCount + (openCount > 0 ? ' <span style="color:var(--yellow);">(' + openCount + ' open)</span>' : '') + '</td>' +
          '<td class="actions">' +
            '<button onclick="viewQBCustomer(\'' + c.Id + '\')">View</button>' +
            '<button onclick="newEstimateForCustomer(\'' + c.Id + '\')">Estimate</button>' +
            '<button onclick="newAdhocInvoice(\'' + c.Id + '\')">Invoice</button>' +
          '</td></tr>';
      }).join('')}</tbody>
    </table>`;
}

async function viewQBCustomer(qbId) {
  const c = qbCustomers.find(x => x.Id == qbId);
  if (!c) return;

  const email = c.PrimaryEmailAddr ? c.PrimaryEmailAddr.Address : '-';
  const phone = c.PrimaryPhone ? c.PrimaryPhone.FreeFormNumber : '-';
  let addr = '-';
  if (c.BillAddr) {
    addr = [c.BillAddr.Line1, c.BillAddr.City, c.BillAddr.CountrySubDivisionCode, c.BillAddr.PostalCode].filter(Boolean).join(', ');
  }

  let invoices = [];
  try { const cached = await API.get('/api/qb/cached'); invoices = cached.invoices || []; } catch {}
  const custInv = invoices.filter(i => i.CustomerRef && i.CustomerRef.name === c.DisplayName);
  const totalInvoiced = custInv.reduce((s,i) => s + (i.TotalAmt||0), 0);
  const totalBal = custInv.reduce((s,i) => s + (i.Balance||0), 0);

  document.getElementById('customerModalTitle').textContent = c.DisplayName;
  document.getElementById('customerModalBody').innerHTML = `
    <div style="display:flex;gap:12px;margin-bottom:16px;">
      <div class="stat-card" style="flex:1;"><div class="stat-label">Total Invoiced</div><div class="stat-value" style="font-size:18px;">$${totalInvoiced.toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>
      <div class="stat-card" style="flex:1;"><div class="stat-label">Paid</div><div class="stat-value" style="font-size:18px;color:var(--green);">$${(totalInvoiced-totalBal).toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>
      <div class="stat-card" style="flex:1;"><div class="stat-label">Balance</div><div class="stat-value" style="font-size:18px;color:${totalBal>0?'var(--yellow)':'var(--green)'};">$${totalBal.toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>
    </div>
    <div style="margin-bottom:16px;">
      <div style="font-size:13px;margin-bottom:4px;"><strong style="color:var(--brand);">Email:</strong> ${email}</div>
      <div style="font-size:13px;margin-bottom:4px;"><strong style="color:var(--brand);">Phone:</strong> ${phone}</div>
      <div style="font-size:13px;"><strong style="color:var(--brand);">Address:</strong> ${addr}</div>
    </div>
    ${custInv.length > 0 ? '<h4 style="color:var(--brand);margin:12px 0 8px;">Invoice History</h4><table class="data-table" style="font-size:12px;"><thead><tr><th>#</th><th>Date</th><th>Due</th><th>Total</th><th>Balance</th><th>Status</th><th>Actions</th></tr></thead><tbody>' + custInv.map(i => {
      const badge = i.Balance === 0 ? 'green' : (i.DueDate && new Date(i.DueDate) < new Date() ? 'red' : 'yellow');
      const status = i.Balance === 0 ? 'Paid' : (i.DueDate && new Date(i.DueDate) < new Date() ? 'Overdue' : 'Open');
      return '<tr><td>#'+(i.DocNumber||i.Id)+'</td><td>'+i.TxnDate+'</td><td>'+(i.DueDate||'-')+'</td><td>$'+i.TotalAmt.toFixed(2)+'</td><td style="color:'+(i.Balance>0?'var(--yellow)':'var(--green)')+';">$'+i.Balance.toFixed(2)+'</td><td><span class="badge badge-'+badge+'">'+status+'</span></td><td class="actions">'+(i.Balance>0?'<button onclick="remindQBInvoice('+i.Id+')">Remind</button>':'')+'<button onclick="printQBInvoice('+i.Id+')">Print</button></td></tr>';
    }).join('') + '</tbody></table>' : '<div style="color:var(--muted);font-size:12px;">No invoices</div>'}
    <div class="form-actions" style="margin-top:16px;">
      <button class="btn-primary" onclick="closeCustomerModal();newEstimateForCustomer('${qbId}')">New Estimate</button>
      <button class="btn-primary" onclick="closeCustomerModal();newAdhocInvoice('${qbId}')" style="background:var(--green);">New Invoice</button>
      <button class="btn-secondary" onclick="closeCustomerModal()">Close</button>
    </div>`;
  document.getElementById('customerModal').classList.add('active');
}

function newEstimateForCustomer(qbCustId) {
  const c = qbCustomers.find(x => x.Id == qbCustId);
  if (!c) return;
  // Sync to local customers if needed, then open estimate modal
  syncQBCustomerToLocal(c).then(localId => {
    openEstimateModal();
    setTimeout(() => {
      document.getElementById('estCustomer').value = localId || '';
      fillCustomerInfo();
    }, 100);
  });
}

async function newAdhocInvoice(qbCustId) {
  const c = qbCustomers.find(x => x.Id == qbCustId);
  if (!c) return;

  document.getElementById('customerModalTitle').textContent = 'New Invoice — ' + c.DisplayName;
  document.getElementById('customerModalBody').innerHTML = `
    <input type="hidden" id="adhocQBCustId" value="${qbCustId}">
    <input type="hidden" id="adhocQBCustName" value="${c.DisplayName}">
    <div class="form-row">
      <div class="form-group"><label>Customer</label><input type="text" value="${c.DisplayName}" readonly></div>
      <div class="form-group"><label>Due Date</label>
        <select onchange="var d=parseInt(this.value);if(d>=0)document.getElementById('adhocDue').value=new Date(Date.now()+d*86400000).toISOString().split('T')[0];" style="width:100%;padding:9px 12px;background:var(--dark);border:1px solid var(--border);border-radius:6px;color:var(--light);font-family:'Oswald',sans-serif;margin-bottom:6px;">
          <option value="0">Due on Receipt</option>
          <option value="10">Net 10</option>
          <option value="15">Net 15</option>
          <option value="30" selected>Net 30</option>
          <option value="-1">Custom</option>
        </select>
        <input type="date" id="adhocDue" value="${new Date(Date.now()+30*86400000).toISOString().split('T')[0]}">
      </div>
    </div>
    <h4 style="color:var(--brand);margin:12px 0 8px;font-size:13px;">Line Items</h4>
    <table class="data-table" style="font-size:12px;">
      <thead><tr><th style="width:50%;">Description</th><th>Qty</th><th>Rate</th><th>Amount</th><th></th></tr></thead>
      <tbody id="adhocLines"></tbody>
    </table>
    <button style="width:100%;padding:6px;border:1px dashed var(--border);background:none;color:var(--muted);cursor:pointer;border-radius:4px;font-family:'Oswald',sans-serif;margin-top:4px;" onclick="addAdhocLine()">+ Add Line</button>
    <div style="text-align:right;margin-top:12px;padding:10px;background:var(--dark);border-radius:6px;">
      <span style="color:var(--brand);font-size:20px;font-weight:700;">Total: $<span id="adhocTotal">0.00</span></span>
    </div>
    <div class="form-group" style="margin-top:12px;"><label>Memo</label><input type="text" id="adhocMemo" placeholder="e.g. Cabinet installation"></div>
    <div class="form-actions" style="margin-top:16px;">
      <button class="btn-primary" onclick="submitAdhocInvoice()">Create & Send via QB</button>
      <button class="btn-secondary" onclick="closeCustomerModal()">Cancel</button>
    </div>`;
  adhocLineItems = [{desc:'',qty:1,rate:0}];
  renderAdhocLines();
  document.getElementById('customerModal').classList.add('active');
}

let adhocLineItems = [];

function addAdhocLine() {
  adhocLineItems.push({desc:'',qty:1,rate:0});
  renderAdhocLines();
}

function removeAdhocLine(idx) {
  adhocLineItems.splice(idx,1);
  renderAdhocLines();
}

function renderAdhocLines() {
  document.getElementById('adhocLines').innerHTML = adhocLineItems.map((l,i) => {
    const amt = l.qty * l.rate;
    return '<tr><td><input style="width:100%;padding:5px;background:var(--dark);border:1px solid var(--border);color:var(--light);border-radius:4px;font-size:12px;" value="'+(l.desc||'').replace(/"/g,'&quot;')+'" onchange="adhocLineItems['+i+'].desc=this.value"></td><td><input type="number" style="width:60px;padding:5px;background:var(--dark);border:1px solid var(--border);color:var(--light);border-radius:4px;text-align:center;" value="'+l.qty+'" min="1" onchange="adhocLineItems['+i+'].qty=parseFloat(this.value)||1;renderAdhocLines()"></td><td><input type="number" step="0.01" style="width:80px;padding:5px;background:var(--dark);border:1px solid var(--border);color:var(--light);border-radius:4px;text-align:right;" value="'+l.rate+'" onchange="adhocLineItems['+i+'].rate=parseFloat(this.value)||0;renderAdhocLines()"></td><td style="text-align:right;font-weight:600;color:var(--brand);">$'+amt.toFixed(2)+'</td><td><button style="background:none;border:none;color:var(--red);cursor:pointer;" onclick="removeAdhocLine('+i+')">&times;</button></td></tr>';
  }).join('');
  const total = adhocLineItems.reduce((s,l) => s + (l.qty*l.rate), 0);
  document.getElementById('adhocTotal').textContent = total.toFixed(2);
}

async function submitAdhocInvoice() {
  const qbCustId = document.getElementById('adhocQBCustId').value;
  const qbCustName = document.getElementById('adhocQBCustName').value;
  const due = document.getElementById('adhocDue').value;
  const memo = document.getElementById('adhocMemo').value;
  const lines = adhocLineItems.filter(l => l.desc && l.rate > 0);

  if (lines.length === 0) { toast('Add at least one line item', 'error'); return; }

  const qbLines = lines.map(l => {
    let itemRef = { value: '1', name: 'Services' };
    if (typeof qbItems !== 'undefined' && qbItems.length > 0) {
      const lower = (l.desc || '').toLowerCase();
      const match = qbItems.find(i => lower.startsWith(i.Name.toLowerCase()));
      if (match) itemRef = { value: match.Id, name: match.Name };
    }
    return {
      Amount: l.qty * l.rate,
      DetailType: 'SalesItemLineDetail',
      Description: l.desc,
      SalesItemLineDetail: { ItemRef: itemRef, UnitPrice: l.rate, Qty: l.qty }
    };
  });

  try {
    // Get next invoice number
    let nextDocNum = '';
    try {
      const allInv = await API.get('/api/qb/invoices');
      const nums = allInv.map(i => parseInt(i.DocNumber || '0')).filter(n => !isNaN(n));
      nextDocNum = String(Math.max(...nums) + 1);
    } catch {}

    const inv = await API.post('/api/qb/invoices', {
      DocNumber: nextDocNum,
      CustomerRef: { value: qbCustId, name: qbCustName },
      DueDate: due,
      Line: qbLines,
      CustomerMemo: memo ? { value: memo } : undefined
    });

    if (inv.Id) {
      // Send via QB email
      try { await API.post('/api/qb/invoices/' + inv.Id + '/send-email-graph', {}); } catch {}
      toast('Invoice #' + (inv.DocNumber||inv.Id) + ' created and sent — $' + (inv.TotalAmt||0).toFixed(2), 'success');
      closeCustomerModal();
    } else {
      toast('QB error: ' + JSON.stringify(inv).substring(0,200), 'error');
    }
  } catch (e) { toast('Failed: ' + e.message, 'error'); }
}

async function syncQBCustomerToLocal(qbCust) {
  const localMatch = customers.find(c => c.name.toLowerCase() === qbCust.DisplayName.toLowerCase());
  if (localMatch) return localMatch.id;

  try {
    const created = await API.createCustomer({
      name: qbCust.DisplayName,
      email: qbCust.PrimaryEmailAddr ? qbCust.PrimaryEmailAddr.Address : '',
      phone: qbCust.PrimaryPhone ? qbCust.PrimaryPhone.FreeFormNumber : '',
      address: qbCust.BillAddr ? [qbCust.BillAddr.Line1, qbCust.BillAddr.City, qbCust.BillAddr.CountrySubDivisionCode].filter(Boolean).join(', ') : ''
    });
    customers.push(created);
    return created.id;
  } catch { return null; }
}

async function remindQBInvoice(id) {
  const inv = (qbInvoices||[]).find(i => i.Id === id);
  const name = inv && inv.CustomerRef ? inv.CustomerRef.name : 'customer';
  if (!confirm('Send payment reminder to ' + name + '?')) return;
  try {
    await API.post('/api/qb/invoices/' + id + '/send-email-graph', {});
    toast('Reminder sent to ' + name, 'success');
  } catch (e) { toast('Reminder failed: ' + e.message, 'error'); }
}

function printQBInvoice(id) {
  window.open(API.baseUrl + '/api/qb/invoices/' + id + '/pdf', '_blank');
}
