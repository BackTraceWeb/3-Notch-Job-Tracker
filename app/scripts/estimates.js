let estLines = [];
let allEstimates = [];
let qbItems = [];

async function loadQBItems() {
  if (qbItems.length > 0) return;
  try { qbItems = await API.get('/api/qb/items'); } catch {}
}

async function loadEstimates() {
  try {
    const jobsData = await API.getJobs();
    allEstimates = jobsData.filter(j => j.estimate_number);
    renderEstimatesList();
  } catch (e) { toast('Failed to load estimates: ' + e.message, 'error'); }
}

function renderEstimatesList() {
  const wrap = document.getElementById('estimatesTable') || document.getElementById('billingTableWrap');
  if (!wrap) return;
  if (allEstimates.length === 0) {
    wrap.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);">No estimates yet. Click "+ New Estimate" to create one.</div>';
    return;
  }
  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Estimate #</th><th>Customer</th><th>Job</th><th>Date</th><th>Amount</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${allEstimates.sort((a, b) => (b.estimate_number || '').localeCompare(a.estimate_number || '')).map(j => {
        const cust = customers.find(c => c.id === j.customer_id);
        const badge = j.stage === 'Completed' ? 'green' : j.stage === 'Quote/Estimate' ? 'blue' : 'yellow';
        return '<tr><td><strong>' + (j.estimate_number || '-') + '</strong></td><td>' + (cust ? cust.name : '-') + '</td><td>' + j.job_name + '</td><td style="color:var(--muted);font-size:12px;">' + (j.estimate_date || '-') + '</td><td><strong>' + (j.quoted_price ? '$' + j.quoted_price.toLocaleString('en-US', {minimumFractionDigits: 2}) : '-') + '</strong></td><td><span class="badge badge-' + badge + '">' + j.stage + '</span></td><td class="actions"><button onclick="editEstimate(' + j.id + ')">Edit</button><button onclick="printEstimateFromList(' + j.id + ')">PDF</button><button onclick="syncEstimateToQB(' + j.id + ')" style="color:var(--green);border-color:var(--green);">To QB</button><button onclick="createProgressiveFromEstimate(' + j.id + ')" style="color:var(--brand);border-color:var(--brand);">Invoice</button></td></tr>';
      }).join('')}</tbody>
    </table>`;
}

async function openEstimateModal(jobId) {
  document.getElementById('estModalTitle').textContent = jobId ? 'Edit Estimate' : 'New Estimate';
  document.getElementById('estJobId').value = jobId || '';

  await loadQBItems();

  const sel = document.getElementById('estCustomer');
  let qbCusts = qbCustomers || [];
  if (qbCusts.length === 0) try { qbCusts = await API.get('/api/qb/customers'); qbCustomers = qbCusts; } catch {}
  sel.innerHTML = '<option value="">— Select Customer —</option>' +
    '<option value="__new__" style="color:#b8ae97;font-weight:700;">+ New Customer</option>' +
    qbCusts.sort((a,b) => (a.DisplayName||'').localeCompare(b.DisplayName||'')).map(c => '<option value="qb_' + c.Id + '" data-email="' + (c.PrimaryEmailAddr ? c.PrimaryEmailAddr.Address : '') + '" data-addr="' + (c.BillAddr ? [c.BillAddr.Line1,c.BillAddr.City,c.BillAddr.CountrySubDivisionCode].filter(Boolean).join(', ') : '') + '" data-phone="' + (c.PrimaryPhone ? c.PrimaryPhone.FreeFormNumber : '') + '">' + c.DisplayName + '</option>').join('');

  document.getElementById('estDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('estJobName').value = '';
  document.getElementById('estAddress').value = '';
  document.getElementById('estEmail').value = '';
  document.getElementById('estColor').value = '';
  document.getElementById('estNotes').value = 'Valid for 30 days. 50% deposit required to begin production.';

  let maxNum = allEstimates.reduce((m, j) => {
    const n = parseInt((j.estimate_number || '').replace('EST-', ''));
    return n > m ? n : m;
  }, 1000);
  try {
    const qbEsts = await API.get('/api/qb/estimates');
    const qbMax = qbEsts.reduce((m, e) => {
      const n = parseInt(e.DocNumber || '0');
      return n > m ? n : m;
    }, 0);
    if (qbMax > maxNum) maxNum = qbMax;
  } catch {}
  document.getElementById('estNumber').value = 'EST-' + (maxNum + 1);

  if (jobId) {
    const job = jobs.find(j => j.id === jobId);
    if (job) {
      document.getElementById('estJobName').value = job.job_name || '';
      document.getElementById('estAddress').value = job.job_address || '';
      document.getElementById('estEmail').value = job.job_email || '';
      document.getElementById('estColor').value = job.job_color || '';
      if (job.customer_id) {
        const localCust = customers.find(c => c.id === job.customer_id);
        if (localCust) {
          const qbMatch = qbCusts.find(q => q.DisplayName.toLowerCase() === localCust.name.toLowerCase());
          if (qbMatch) {
            document.getElementById('estCustomer').value = 'qb_' + qbMatch.Id;
          } else {
            document.getElementById('estCustomer').value = job.customer_id;
          }
        }
      }
      document.getElementById('estNumber').value = job.estimate_number || document.getElementById('estNumber').value;
      document.getElementById('estDate').value = job.estimate_date || document.getElementById('estDate').value;
      loadEstimateItems(jobId);
    }
  } else {
    estLines = [{ category: '', categoryId: '', description: '', qty: 1, sqft: '', rate: 0, amount: 0 }];
    renderEstimateLines();
  }

  document.getElementById('estimateModal').classList.add('active');
}

function cleanDescription(raw) {
  if (!raw) return { category: '', categoryId: '', description: '' };
  const qbNames = qbItems.map(i => i.Name.toLowerCase());
  let desc = raw;
  let matchedCat = '';
  let matchedId = '';
  // Strip repeated category prefixes from corrupted data
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of qbItems) {
      const prefix = item.Name + ' - ';
      if (desc.startsWith(prefix)) {
        matchedCat = item.Name;
        matchedId = item.Id;
        desc = desc.substring(prefix.length);
        changed = true;
      }
    }
  }
  // If nothing matched via QB items, try splitting on first " - "
  if (!matchedCat) {
    const dashIdx = desc.indexOf(' - ');
    if (dashIdx > 0) {
      const possible = desc.substring(0, dashIdx);
      const match = qbItems.find(i => i.Name.toLowerCase() === possible.toLowerCase());
      if (match) {
        matchedCat = match.Name;
        matchedId = match.Id;
        desc = desc.substring(dashIdx + 3);
      }
    }
  }
  return { category: matchedCat, categoryId: matchedId, description: desc };
}

async function loadEstimateItems(jobId) {
  try {
    const items = await API.getEstimateItems(jobId);
    if (items && items.length > 0) {
      estLines = items.map(i => {
        const cleaned = cleanDescription(i.description);
        return {
          id: i.id,
          category: cleaned.category,
          categoryId: cleaned.categoryId,
          description: cleaned.description,
          qty: i.quantity || 1,
          sqft: '',
          rate: i.rate || 0,
          amount: i.amount || 0
        };
      });
    } else {
      estLines = [{ category: '', categoryId: '', description: '', qty: 1, sqft: '', rate: 0, amount: 0 }];
    }
    renderEstimateLines();
  } catch {
    estLines = [{ category: '', categoryId: '', description: '', qty: 1, sqft: '', rate: 0, amount: 0 }];
    renderEstimateLines();
  }
}

function closeEstimateModal() { document.getElementById('estimateModal').classList.remove('active'); }

function fillCustomerInfo() {
  const val = document.getElementById('estCustomer').value;
  if (!val) return;

  if (val === '__new__') {
    openNewQBCustomer();
    document.getElementById('estCustomer').value = '';
    return;
  }

  if (val.startsWith('qb_')) {
    const opt = document.getElementById('estCustomer').selectedOptions[0];
    if (opt) {
      if (!document.getElementById('estEmail').value) document.getElementById('estEmail').value = opt.dataset.email || '';
      if (!document.getElementById('estAddress').value) document.getElementById('estAddress').value = opt.dataset.addr || '';
    }
    return;
  }

  const cust = customers.find(c => c.id == val);
  if (cust) {
    if (!document.getElementById('estEmail').value) document.getElementById('estEmail').value = cust.email || '';
    if (!document.getElementById('estAddress').value) document.getElementById('estAddress').value = cust.address || '';
  }
}

function addEstimateLine() {
  estLines.push({ category: '', categoryId: '', description: '', qty: 1, sqft: '', rate: 0, amount: 0 });
  renderEstimateLines();
}

function removeEstimateLine(idx) {
  estLines.splice(idx, 1);
  renderEstimateLines();
}

function onCategoryChange(idx, selectEl) {
  const val = selectEl.value;
  if (!val) { estLines[idx].category = ''; estLines[idx].categoryId = ''; return; }
  const item = qbItems.find(i => i.Id === val);
  if (item) {
    estLines[idx].category = item.Name;
    estLines[idx].categoryId = item.Id;
  }
}

function renderEstimateLines() {
  const tbody = document.getElementById('estLineItems');
  const catOpts = qbItems.filter(i => i.Type === 'Service' && i.Active).map(i =>
    '<option value="' + i.Id + '">' + i.Name + '</option>'
  ).join('');

  tbody.innerHTML = estLines.map((l, i) => {
    const selectedId = l.categoryId || (l.category ? (qbItems.find(q => q.Name === l.category) || {}).Id || '' : '');
    return '<tr>' +
      '<td>' + (i + 1) + '</td>' +
      '<td><select style="width:100%;padding:5px;background:var(--dark);border:1px solid var(--border);color:var(--light);border-radius:4px;font-size:11px;" onchange="onCategoryChange(' + i + ',this)"><option value="">—</option>' + catOpts.replace('value="' + selectedId + '"', 'value="' + selectedId + '" selected') + '</select></td>' +
      '<td><input style="width:100%;padding:5px;background:var(--dark);border:1px solid var(--border);color:var(--light);border-radius:4px;font-size:12px;" value="' + (l.description || '').replace(/"/g, '&quot;') + '" onchange="estLines[' + i + '].description=this.value"></td>' +
      '<td><input type="number" style="width:100%;padding:5px;background:var(--dark);border:1px solid var(--border);color:var(--light);border-radius:4px;font-size:12px;text-align:center;" value="' + l.qty + '" min="0" onchange="estLines[' + i + '].qty=parseFloat(this.value)||0;calcEstimateLine(' + i + ')"></td>' +
      '<td><input type="number" style="width:100%;padding:5px;background:var(--dark);border:1px solid var(--border);color:var(--light);border-radius:4px;font-size:12px;text-align:center;" value="' + (l.sqft || '') + '" onchange="estLines[' + i + '].sqft=this.value"></td>' +
      '<td><input type="number" step="0.01" style="width:100%;padding:5px;background:var(--dark);border:1px solid var(--border);color:var(--light);border-radius:4px;font-size:12px;text-align:right;" value="' + l.rate + '" onchange="estLines[' + i + '].rate=parseFloat(this.value)||0;calcEstimateLine(' + i + ')"></td>' +
      '<td style="text-align:right;font-weight:600;color:var(--brand);">$' + (l.qty * l.rate).toFixed(2) + '</td>' +
      '<td><button style="background:none;border:none;color:var(--red);cursor:pointer;font-size:14px;" onclick="removeEstimateLine(' + i + ')">&times;</button></td>' +
      '</tr>';
  }).join('');
  calcEstimateTotal();
}

function calcEstimateLine(idx) {
  estLines[idx].amount = estLines[idx].qty * estLines[idx].rate;
  renderEstimateLines();
}

function calcEstimateTotal() {
  const total = estLines.reduce((s, l) => s + (l.qty * l.rate), 0);
  document.getElementById('estSubtotal').textContent = '$' + total.toFixed(2);
  document.getElementById('estTotal').textContent = '$' + total.toFixed(2);
}

async function saveEstimate() {
  let custVal = document.getElementById('estCustomer').value;
  const jobName = document.getElementById('estJobName').value.trim();
  if (!jobName) { toast('Job name required', 'error'); return; }

  let custId = null;
  if (custVal && custVal.startsWith('qb_')) {
    const qbId = custVal.replace('qb_', '');
    const qbCust = qbCustomers.find(c => c.Id == qbId);
    if (qbCust) {
      custId = await syncQBCustomerToLocal(qbCust);
    }
  } else if (custVal && custVal !== '__new__') {
    custId = custVal;
  }

  const total = estLines.reduce((s, l) => s + (l.qty * l.rate), 0);
  const jobData = {
    job_name: jobName,
    customer_id: custId || null,
    job_address: document.getElementById('estAddress').value.trim(),
    job_email: document.getElementById('estEmail').value.trim(),
    job_color: document.getElementById('estColor').value.trim(),
    stage: 'Quote/Estimate',
    quoted_price: total,
    estimate_number: document.getElementById('estNumber').value,
    estimate_date: document.getElementById('estDate').value
  };

  const items = estLines.filter(l => l.description || l.rate > 0).map((l, i) => ({
    description: (l.category ? l.category + ' - ' : '') + l.description,
    quantity: l.qty,
    rate: l.rate,
    amount: l.qty * l.rate,
    line_order: i + 1
  }));

  try {
    const jobId = document.getElementById('estJobId').value;
    let savedJob;
    if (jobId) {
      savedJob = await API.updateJob(jobId, jobData);
      const idx = jobs.findIndex(j => j.id == jobId);
      if (idx >= 0) jobs[idx] = { ...jobs[idx], ...savedJob };
    } else {
      savedJob = await API.createJob(jobData);
      jobs.push(savedJob);
    }

    await API.saveEstimateItems(savedJob.id, items);

    await loadEstimates();
    renderBoard();
    closeEstimateModal();
    toast('Estimate saved: ' + jobData.estimate_number, 'success');

    try { await syncEstimateToQB(savedJob.id); } catch {}
  } catch (e) { toast('Save failed: ' + e.message, 'error'); }
}

async function editEstimate(jobId) {
  openEstimateModal(jobId);
}

function printEstimateFromList(jobId) {
  openEstimateModal(jobId);
  setTimeout(() => printEstimate(), 500);
}

function printEstimate() {
  const custVal = document.getElementById('estCustomer').value;
  let cust = null;
  if (custVal && custVal.startsWith('qb_')) {
    const qbId = custVal.replace('qb_', '');
    const qbCust = qbCustomers.find(c => c.Id == qbId);
    if (qbCust) cust = {
      name: qbCust.DisplayName,
      email: qbCust.PrimaryEmailAddr ? qbCust.PrimaryEmailAddr.Address : '',
      phone: qbCust.PrimaryPhone ? qbCust.PrimaryPhone.FreeFormNumber : ''
    };
  } else if (custVal) {
    cust = customers.find(c => c.id == custVal);
  }
  const jobName = document.getElementById('estJobName').value;
  const estNum = document.getElementById('estNumber').value;
  const estDate = document.getElementById('estDate').value;
  const address = document.getElementById('estAddress').value;
  const email = document.getElementById('estEmail').value;
  const color = document.getElementById('estColor').value;
  const notes = document.getElementById('estNotes').value;
  const total = estLines.reduce((s, l) => s + (l.qty * l.rate), 0);
  const dateF = estDate ? new Date(estDate + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
  const validUntil = estDate ? new Date(new Date(estDate + 'T12:00:00').getTime() + 30*86400000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
  const salesman = currentUser ? (currentUser.fullName || currentUser.full_name || currentUser.username || '') : '';
  const salesPhone = currentUser ? (currentUser.phone || '') : '';

  let rows = estLines.filter(l => l.description || l.rate > 0).map((l, i) => {
    const amt = l.qty * l.rate;
    const label = (l.category ? l.category + ' - ' : '') + l.description;
    return '<tr style="background:' + (i % 2 ? '#f8f7f5' : '#fff') + '"><td style="padding:8px 12px;">' + label + '</td><td style="padding:8px 12px;text-align:center;">' + l.qty + '</td><td style="padding:8px 12px;text-align:right;">$' + l.rate.toFixed(2) + '</td><td style="padding:8px 12px;text-align:right;font-weight:600;">$' + amt.toFixed(2) + '</td></tr>';
  }).join('');

  const html = '<!DOCTYPE html><html><head><title>Estimate ' + estNum + ' — ' + (cust ? cust.name : jobName) + '</title><style>@page{size:letter;margin:.5in .6in;}*{margin:0;padding:0;box-sizing:border-box;}body{font-family:"Segoe UI",Arial,sans-serif;color:#1a1a1a;font-size:10.5pt;line-height:1.5;}table{width:100%;border-collapse:collapse;}th{background:#191917;color:#b8ae97;padding:8px 12px;text-align:left;font-weight:600;font-size:9.5pt;}td{padding:8px 12px;border-bottom:1px solid #e0e0e0;}</style></head><body>' +

    '<table style="margin-bottom:0;border-bottom:3px solid #b8ae97;"><tr>' +
    '<td style="border:none;padding:10px 0;"><img src="https://www.3notchcabinets.com/logo-transparent.png" height="70"></td>' +
    '<td style="border:none;text-align:right;padding:10px 0;font-size:10pt;color:#555;">' +
    '<div style="font-size:14pt;font-weight:700;color:#b8ae97;">3 Notch Cabinet Co</div>' +
    '1213 Dr MLK Jr Expy<br>Andalusia, AL 36420' +
    (salesman ? '<br><br><span style="color:#b8ae97;font-weight:600;">Salesman: ' + salesman + '</span>' : '') +
    (salesPhone ? '<br><span style="color:#555;">' + salesPhone + '</span>' : '') +
    '</td></tr></table>' +

    '<div style="text-align:center;margin:16px 0 12px;"><span style="font-size:22pt;color:#b8ae97;font-weight:700;letter-spacing:2px;">ESTIMATE</span></div>' +

    '<table style="margin-bottom:16px;"><tr>' +
    '<td style="width:50%;vertical-align:top;border:none;padding:0 8px 0 0;">' +
    '<div style="background:#f5f3ef;border-left:3px solid #b8ae97;padding:12px 16px;">' +
    '<div style="color:#b8ae97;font-weight:700;font-size:11pt;margin-bottom:6px;">Prepared For</div>' +
    '<div style="font-size:12pt;font-weight:600;">' + (cust ? cust.name : '-') + '</div>' +
    (address ? '<div>' + address + '</div>' : '') +
    (email ? '<div>' + email + '</div>' : '') +
    (cust && cust.phone ? '<div>' + cust.phone + '</div>' : '') +
    '</div></td>' +
    '<td style="width:50%;vertical-align:top;border:none;padding:0 0 0 8px;">' +
    '<div style="background:#f5f3ef;border-left:3px solid #b8ae97;padding:12px 16px;">' +
    '<div style="color:#b8ae97;font-weight:700;font-size:11pt;margin-bottom:6px;">Estimate Details</div>' +
    'Estimate #: <strong>' + estNum + '</strong><br>' +
    'Date: ' + dateF + '<br>' +
    'Valid Until: ' + validUntil + '<br>' +
    'Job: <strong>' + jobName + '</strong>' +
    (color ? '<br>Color/Finish: ' + color : '') +
    '</div></td></tr></table>' +

    '<table><tr><th style="width:55%;">Description</th><th style="text-align:center;width:10%;">Qty</th><th style="text-align:right;width:15%;">Rate</th><th style="text-align:right;width:20%;">Amount</th></tr>' + rows +
    '<tr style="border-top:3px solid #b8ae97;background:#f5f3ef;"><td colspan="3" style="padding:10px 12px;font-weight:700;font-size:13pt;">Total</td><td style="padding:10px 12px;text-align:right;font-weight:700;font-size:13pt;">$' + total.toFixed(2) + '</td></tr></table>' +

    (notes ? '<div style="background:#f5f3ef;border-left:3px solid #b8ae97;padding:10px 14px;margin:16px 0;font-size:10pt;"><strong style="color:#b8ae97;">Terms & Conditions:</strong> ' + notes + '</div>' : '') +

    '<div style="text-align:center;margin:20px 0;padding:14px;background:#191917;border-radius:6px;color:#b8ae97;font-size:11pt;font-weight:600;">50% deposit ($' + (total * 0.5).toFixed(2) + ') required to begin production</div>' +

    '<div style="text-align:center;margin-top:20px;font-size:8pt;color:#888;border-top:1px solid #ddd;padding-top:8px;">3 Notch Cabinet Co &bull; 1213 Dr MLK Jr Expy, Andalusia, AL 36420 &bull; 3notchcabinets.com</div></body></html>';

  const win = window.open('', '_blank');
  if (win) {
    win.document.write(html);
    win.document.close();
    win.onload = () => win.print();
  } else {
    // Electron fallback — use iframe
    let frame = document.getElementById('printFrame');
    if (!frame) {
      frame = document.createElement('iframe');
      frame.id = 'printFrame';
      frame.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:99999;border:none;background:#fff;';
      document.body.appendChild(frame);
    }
    frame.style.display = 'block';
    frame.contentDocument.open();
    frame.contentDocument.write(html + '<div style="text-align:center;margin:20px;"><button onclick="window.print()" style="padding:12px 30px;font-size:16px;background:#b8ae97;color:#191917;border:none;border-radius:6px;cursor:pointer;font-weight:700;">Print</button> <button onclick="parent.document.getElementById(\'printFrame\').style.display=\'none\'" style="padding:12px 30px;font-size:16px;background:#555;color:#fff;border:none;border-radius:6px;cursor:pointer;">Close</button></div>');
    frame.contentDocument.close();
  }
}

async function saveAndSendEstimate() {
  const email = document.getElementById('estEmail').value.trim();
  if (!email || !email.includes('@')) {
    toast('Enter customer email before sending', 'error');
    document.getElementById('estEmail').focus();
    return;
  }

  // Save first
  let custVal = document.getElementById('estCustomer').value;
  const jobName = document.getElementById('estJobName').value.trim();
  if (!jobName) { toast('Job name required', 'error'); return; }

  let custId = null;
  if (custVal && custVal.startsWith('qb_')) {
    const qbId = custVal.replace('qb_', '');
    const qbCust = qbCustomers.find(c => c.Id == qbId);
    if (qbCust) custId = await syncQBCustomerToLocal(qbCust);
  } else if (custVal && custVal !== '__new__') {
    custId = custVal;
  }

  const total = estLines.reduce((s, l) => s + (l.qty * l.rate), 0);
  const jobData = {
    job_name: jobName,
    customer_id: custId || null,
    job_address: document.getElementById('estAddress').value.trim(),
    job_email: email,
    job_color: document.getElementById('estColor').value.trim(),
    stage: 'Quote/Estimate',
    quoted_price: total,
    estimate_number: document.getElementById('estNumber').value,
    estimate_date: document.getElementById('estDate').value
  };

  const items = estLines.filter(l => l.description || l.rate > 0).map((l, i) => ({
    description: (l.category ? l.category + ' - ' : '') + l.description,
    quantity: l.qty,
    rate: l.rate,
    amount: l.qty * l.rate,
    line_order: i + 1
  }));

  try {
    const jobId = document.getElementById('estJobId').value;
    let savedJob;
    if (jobId) {
      savedJob = await API.updateJob(jobId, jobData);
      const idx = jobs.findIndex(j => j.id == jobId);
      if (idx >= 0) jobs[idx] = { ...jobs[idx], ...savedJob };
    } else {
      savedJob = await API.createJob(jobData);
      jobs.push(savedJob);
    }

    await API.saveEstimateItems(savedJob.id, items);
    toast('Estimate saved — syncing to QB...', 'success');

    try { await syncEstimateToQB(savedJob.id); } catch {}

    // Send email with approval link
    const result = await API.post('/api/jobs/' + savedJob.id + '/send-estimate', { email });
    if (result.ok) {
      toast('Estimate sent to ' + email + ' with approval link', 'success');
    } else {
      toast('Saved but email failed: ' + (result.error || 'Unknown'), 'error');
    }

    await loadEstimates();
    renderBoard();
    closeEstimateModal();
  } catch (e) { toast('Failed: ' + e.message, 'error'); }
}

async function emailEstimate() {
  const jobId = document.getElementById('estJobId').value;
  if (!jobId) { toast('Save the estimate first', 'error'); return; }

  let email = document.getElementById('estEmail').value.trim();
  if (!email || !email.includes('@')) {
    const entered = prompt('Send estimate to email:');
    if (!entered || !entered.includes('@')) return;
    email = entered;
    document.getElementById('estEmail').value = email;
  }

  try {
    const result = await API.post('/api/jobs/' + jobId + '/send-estimate', { email });
    if (result.ok) {
      toast('Estimate emailed to ' + email + ' with approval link', 'success');
    } else {
      toast('Failed: ' + (result.error || 'Unknown error'), 'error');
    }
  } catch (e) { toast('Email failed: ' + e.message, 'error'); }
}
