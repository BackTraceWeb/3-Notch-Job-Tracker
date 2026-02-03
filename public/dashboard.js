// Dashboard JavaScript

let dashboardData = { jobs: [], orders: [] };
let currentUser = null;

// Check authentication
async function checkAuth() {
  try {
    const response = await fetch('/api/auth/check');
    const data = await response.json();

    if (!data.authenticated) {
      window.location.href = 'login.html';
      return false;
    }

    currentUser = data.user;
    document.getElementById('user-name').textContent = data.user.fullName;
    return true;
  } catch (error) {
    console.error('Auth check failed:', error);
    window.location.href = 'login.html';
    return false;
  }
}

// Logout
document.getElementById('logout-btn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = 'login.html';
});

// Load dashboard data
async function loadDashboardData() {
  try {
    const response = await fetch('/api/dashboard');
    if (!response.ok) throw new Error('Failed to fetch dashboard data');

    dashboardData = await response.json();
    console.log('Dashboard data loaded:', dashboardData);

    renderStatistics();
    renderAllTable();
    renderInvoicingSummary();
    renderInvoicingTable();
    renderCompletedTable();
    renderOrdersTable();

  } catch (error) {
    console.error('Error loading dashboard:', error);
    showToast('Failed to load dashboard data', 'error');
  }
}

// Render statistics cards
function renderStatistics() {
  const { jobs, orders } = dashboardData;

  // Calculate stats
  const totalJobs = jobs.length;
  const completedJobs = jobs.filter(j => j.stage === 'Completed').length;
  const pendingOrders = orders.filter(o => o.order_status === 'pending').length;
  const invoicesPending = jobs.filter(j =>
    (j.first_invoice_sent && !j.first_invoice_paid) ||
    (j.second_invoice_sent && !j.second_invoice_paid)
  ).length;

  const totalRevenue = jobs.reduce((sum, j) => {
    const first = j.first_invoice_amount || 0;
    const second = j.second_invoice_amount || 0;
    return sum + first + second;
  }, 0);

  const paidRevenue = jobs.reduce((sum, j) => {
    let paid = 0;
    if (j.first_invoice_paid) paid += (j.first_invoice_amount || 0);
    if (j.second_invoice_paid) paid += (j.second_invoice_amount || 0);
    return sum + paid;
  }, 0);

  const statsHtml = `
    <div class="stat-card">
      <div class="stat-value">${totalJobs}</div>
      <div class="stat-label">Total Jobs</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${completedJobs}</div>
      <div class="stat-label">Completed</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${pendingOrders}</div>
      <div class="stat-label">Pending Orders</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${invoicesPending}</div>
      <div class="stat-label">Invoices Pending</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">$${formatMoney(paidRevenue)}</div>
      <div class="stat-label">Paid Revenue</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">$${formatMoney(totalRevenue - paidRevenue)}</div>
      <div class="stat-label">Outstanding</div>
    </div>
  `;

  document.getElementById('stats-grid').innerHTML = statsHtml;
}

// Render All Jobs & Orders table
function renderAllTable() {
  const { jobs, orders } = dashboardData;

  // Combine jobs and orders
  const allItems = [];

  // Add jobs
  jobs.forEach(job => {
    allItems.push({
      type: 'job',
      id: job.id,
      name: job.job_name,
      address: job.job_address,
      stage: job.stage,
      created_at: job.created_at,
      order_id: job.order_id,
      quoted_price: job.quoted_price,
      estimate_number: job.estimate_number
    });
  });

  // Add orders that aren't linked to jobs
  orders.forEach(order => {
    const hasJob = jobs.some(j => j.order_id === order.order_id);
    if (!hasJob) {
      allItems.push({
        type: 'order',
        id: order.order_id,
        name: order.company_name || order.contact_name,
        address: '',
        stage: order.order_status,
        created_at: order.order_created_at,
        order_id: order.order_id,
        cost: order.cost
      });
    }
  });

  // Sort by date
  allItems.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const tableHtml = `
    <thead>
      <tr>
        <th>Type</th>
        <th>Name</th>
        <th>Address</th>
        <th>Stage/Status</th>
        <th>Amount</th>
        <th>Created</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      ${allItems.length === 0 ? '<tr><td colspan="7"><div class="empty-state"><div class="empty-state-icon">📋</div><div>No jobs or orders yet</div></div></td></tr>' : ''}
      ${allItems.map(item => `
        <tr>
          <td>${item.type === 'job' ? '🔧 Job' : '📦 Order'}</td>
          <td>
            ${item.name}
            ${item.order_id ? '<span class="linked-indicator">Linked</span>' : ''}
          </td>
          <td>${item.address || '-'}</td>
          <td><span class="status-badge status-${getStatusClass(item.stage)}">${item.stage}</span></td>
          <td>$${formatMoney(item.quoted_price || item.cost || 0)}</td>
          <td>${formatDate(item.created_at)}</td>
          <td>
            ${item.type === 'job' ? `
              <button class="btn-action btn-edit" onclick="window.location.href='index.html?edit=${item.id}'">Edit</button>
              <button class="btn-action btn-delete" onclick="deleteJob(${item.id}, '${item.name.replace(/'/g, "\\'")}')">Delete</button>
            ` : '-'}
          </td>
        </tr>
      `).join('')}
    </tbody>
  `;

  document.getElementById('table-all').innerHTML = tableHtml;
}

// Render Invoice Summary (read-only overview)
function renderInvoicingSummary() {
  const { jobs } = dashboardData;

  // Filter jobs with invoices
  const invoicedJobs = jobs.filter(j =>
    j.first_invoice_sent || j.second_invoice_sent || j.first_invoice_paid || j.second_invoice_paid ||
    j.first_invoice_amount || j.second_invoice_amount
  );

  const tableHtml = `
    <thead>
      <tr>
        <th>Job Name</th>
        <th>1st Invoice</th>
        <th>1st Paid</th>
        <th>2nd Invoice</th>
        <th>2nd Paid</th>
        <th>Total</th>
        <th>Paid</th>
        <th>Outstanding</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      ${invoicedJobs.length === 0 ? '<tr><td colspan="9"><div class="empty-state"><div class="empty-state-icon">💳</div><div>No invoices yet</div></div></td></tr>' : ''}
      ${invoicedJobs.map(job => {
        const first = job.first_invoice_amount || 0;
        const second = job.second_invoice_amount || 0;
        const total = first + second;
        const paid = (job.first_invoice_paid ? first : 0) + (job.second_invoice_paid ? second : 0);
        const outstanding = total - paid;
        const jobIdentifierHtml = job.job_identifier ? ` <span class="job-identifier-badge">${job.job_identifier}</span>` : '';

        return `
          <tr>
            <td>${job.job_name}${jobIdentifierHtml}</td>
            <td>
              ${job.first_invoice_sent ? formatDate(job.first_invoice_sent) : '-'}
              <br><small>$${formatMoney(first)}</small>
            </td>
            <td><span class="invoice-status ${job.first_invoice_paid ? 'invoice-paid' : 'invoice-pending'}">${job.first_invoice_paid ? formatDate(job.first_invoice_paid) : 'Pending'}</span></td>
            <td>
              ${job.second_invoice_sent ? formatDate(job.second_invoice_sent) : '-'}
              <br><small>$${formatMoney(second)}</small>
            </td>
            <td><span class="invoice-status ${job.second_invoice_paid ? 'invoice-paid' : 'invoice-pending'}">${job.second_invoice_paid ? formatDate(job.second_invoice_paid) : 'Pending'}</span></td>
            <td>$${formatMoney(total)}</td>
            <td class="invoice-paid">$${formatMoney(paid)}</td>
            <td class="${outstanding > 0 ? 'invoice-pending' : ''}">$${formatMoney(outstanding)}</td>
            <td>
              <button class="btn-action btn-edit" onclick="window.location.href='index.html?edit=${job.id}'">Edit</button>
              <button class="btn-action btn-delete" onclick="deleteJob(${job.id}, '${job.job_name.replace(/'/g, "\\'")}')">Delete</button>
            </td>
          </tr>
        `;
      }).join('')}
    </tbody>
  `;

  document.getElementById('table-invoicing-summary').innerHTML = tableHtml;
}

// Render Invoicing table (interactive version)
function renderInvoicingTable() {
  const { jobs } = dashboardData;
  const invoicingBody = document.getElementById('invoicing-body');

  if (!invoicingBody) return;

  invoicingBody.innerHTML = '';

  jobs.forEach(job => {
    const row = document.createElement('tr');
    row.dataset.jobId = job.id;

    const completionDate = job.completion_date ? new Date(job.completion_date).toLocaleDateString() : '-';
    const isSingleInvoice = job.single_invoice_mode === 1;

    // Generate stage dropdown options with optgroups
    const stageOptionsHTML = `
      <option value="Quote/Estimate" ${job.stage === 'Quote/Estimate' ? 'selected' : ''}>Quote/Estimate</option>
      <optgroup label="In Progress">
        <option value="In Progress - Ready to Cut" ${job.stage === 'In Progress - Ready to Cut' ? 'selected' : ''}>Ready to Cut</option>
        <option value="In Progress - Cut" ${job.stage === 'In Progress - Cut' ? 'selected' : ''}>Cut</option>
        <option value="In Progress - Paint & Sand" ${job.stage === 'In Progress - Paint & Sand' ? 'selected' : ''}>Paint & Sand</option>
        <option value="In Progress - Assemble" ${job.stage === 'In Progress - Assemble' ? 'selected' : ''}>Assemble</option>
        <option value="In Progress - Ready to Install" ${job.stage === 'In Progress - Ready to Install' ? 'selected' : ''}>Ready to Install</option>
        <option value="In Progress - Installed" ${job.stage === 'In Progress - Installed' ? 'selected' : ''}>Installed</option>
        <option value="In Progress - Installed - Finish Work" ${job.stage === 'In Progress - Installed - Finish Work' ? 'selected' : ''}>Installed - Finish Work</option>
      </optgroup>
      <option value="Completed" ${job.stage === 'Completed' ? 'selected' : ''}>Completed</option>
    `;

    // Job identifier badge
    const jobIdentifierHtml = job.job_identifier ? ` <span class="job-identifier-badge">${job.job_identifier}</span>` : '';

    row.innerHTML = `
      <td class="whiteboard-name" data-job-id="${job.id}">${job.job_name}${jobIdentifierHtml}</td>
      <td class="whiteboard-email">${job.job_email || '-'}</td>
      <td class="whiteboard-stage-cell">
        <select class="whiteboard-stage-select" data-job-id="${job.id}">
          ${stageOptionsHTML}
        </select>
      </td>
      <td class="price-cell">
        <div class="invoice-amount-wrapper">
          <span class="currency-symbol">$</span>
          <input type="number" class="price-input" data-job-id="${job.id}" data-field="quoted_price" value="${job.quoted_price || ''}" placeholder="0.00" step="0.01" min="0">
        </div>
      </td>
      <td class="price-cell">
        <div class="invoice-amount-wrapper">
          <span class="currency-symbol">$</span>
          <input type="number" class="price-input" data-job-id="${job.id}" data-field="material_cost" value="${job.material_cost || ''}" placeholder="0.00" step="0.01" min="0">
        </div>
      </td>
      <td class="invoice-type-cell">
        <select class="invoice-type-select" data-job-id="${job.id}">
          <option value="dual" ${!isSingleInvoice ? 'selected' : ''}>Dual</option>
          <option value="single" ${isSingleInvoice ? 'selected' : ''}>Single</option>
        </select>
      </td>
      <td class="whiteboard-invoice-cell ${isSingleInvoice ? 'disabled-cell' : ''}">
        <div class="invoice-group">
          <div class="invoice-amount-wrapper">
            <span class="currency-symbol">$</span>
            <input type="number" class="invoice-amount-input" data-job-id="${job.id}" data-field="first_invoice_amount" value="${job.first_invoice_amount || ''}" placeholder="0.00" step="0.01" min="0" ${isSingleInvoice ? 'disabled' : ''}>
          </div>
          <div class="invoice-dates">
            <input type="date" class="whiteboard-invoice-input" data-job-id="${job.id}" data-field="first_invoice_sent" value="${job.first_invoice_sent || ''}" title="Sent" ${isSingleInvoice ? 'disabled' : ''}>
            <input type="date" class="whiteboard-invoice-input" data-job-id="${job.id}" data-field="first_invoice_paid" value="${job.first_invoice_paid || ''}" title="Paid" ${isSingleInvoice ? 'disabled' : ''}>
          </div>
          <button class="mark-paid-btn ${job.first_invoice_paid ? 'paid' : ''}" data-job-id="${job.id}" data-invoice="first" ${isSingleInvoice ? 'disabled' : ''}>${job.first_invoice_paid ? '✓ Paid' : 'Mark Paid'}</button>
        </div>
      </td>
      <td class="whiteboard-invoice-cell">
        <div class="invoice-group">
          <div class="invoice-amount-wrapper">
            <span class="currency-symbol">$</span>
            <input type="number" class="invoice-amount-input" data-job-id="${job.id}" data-field="second_invoice_amount" value="${job.second_invoice_amount || ''}" placeholder="0.00" step="0.01" min="0">
          </div>
          <div class="invoice-dates">
            <input type="date" class="whiteboard-invoice-input" data-job-id="${job.id}" data-field="second_invoice_sent" value="${job.second_invoice_sent || ''}" title="Sent">
            <input type="date" class="whiteboard-invoice-input" data-job-id="${job.id}" data-field="second_invoice_paid" value="${job.second_invoice_paid || ''}" title="Paid">
          </div>
          <button class="mark-paid-btn ${job.second_invoice_paid ? 'paid' : ''}" data-job-id="${job.id}" data-invoice="second">${job.second_invoice_paid ? '✓ Paid' : 'Mark Paid'}</button>
        </div>
      </td>
      <td class="whiteboard-date">${completionDate}</td>
    `;

    invoicingBody.appendChild(row);

    // Add event listeners for interactive elements
    setupInvoiceRowListeners(row, job);
  });
}

// Setup event listeners for invoice row
function setupInvoiceRowListeners(row, job) {
  const stageSelect = row.querySelector('.whiteboard-stage-select');
  const invoiceTypeSelect = row.querySelector('.invoice-type-select');
  const invoiceInputs = row.querySelectorAll('.whiteboard-invoice-input');
  const amountInputs = row.querySelectorAll('.invoice-amount-input');
  const priceInputs = row.querySelectorAll('.price-input');

  // Stage dropdown handler
  stageSelect.addEventListener('change', async (e) => {
    const newStage = e.target.value;
    if (newStage !== job.stage) {
      await updateJobField(job.id, 'stage', newStage);
      renderInvoicingSummary();
      await loadDashboardData();
    }
  });

  // Invoice type toggle handler
  invoiceTypeSelect.addEventListener('change', async (e) => {
    const isSingle = e.target.value === 'single';
    const updates = { single_invoice_mode: isSingle ? 1 : 0 };
    const quotedPrice = parseFloat(job.quoted_price) || 0;

    if (isSingle) {
      // Single invoice mode: put full quoted price in second invoice, clear first
      updates.first_invoice_amount = null;
      updates.first_invoice_sent = null;
      updates.first_invoice_paid = null;
      if (quotedPrice > 0) {
        updates.second_invoice_amount = quotedPrice;
      }
    } else {
      // Dual invoice mode: split quoted price 50/50
      if (quotedPrice > 0) {
        const half = (quotedPrice / 2).toFixed(2);
        updates.first_invoice_amount = parseFloat(half);
        updates.second_invoice_amount = parseFloat(half);
      }
    }

    await updateJobFields(job.id, updates);
    renderInvoicingSummary();
    await loadDashboardData();
  });

  // Invoice date input handlers
  invoiceInputs.forEach(input => {
    input.addEventListener('change', async (e) => {
      const field = e.target.dataset.field;
      const newDate = e.target.value;
      await updateJobField(job.id, field, newDate);
      renderInvoicingSummary();
    });
  });

  // Invoice amount input handlers
  amountInputs.forEach(input => {
    input.addEventListener('change', async (e) => {
      const field = e.target.dataset.field;
      const newAmount = e.target.value ? parseFloat(e.target.value) : null;

      // Update the changed field
      await updateJobField(job.id, field, newAmount);

      // Auto-calculate the other invoice if in dual mode and quoted price exists
      const quotedPrice = parseFloat(job.quoted_price) || 0;
      const isSingle = job.single_invoice_mode === 1;

      if (!isSingle && quotedPrice > 0 && newAmount > 0) {
        const otherField = field === 'first_invoice_amount' ? 'second_invoice_amount' : 'first_invoice_amount';
        const remainder = quotedPrice - newAmount;

        // Only auto-update if remainder is positive and makes sense
        if (remainder >= 0) {
          await updateJobField(job.id, otherField, remainder);
          await loadDashboardData(); // Reload to show updated values
        }
      }

      renderInvoicingSummary();
    });
  });

  // Mark Paid button handlers
  const markPaidBtns = row.querySelectorAll('.mark-paid-btn');
  markPaidBtns.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const invoice = e.target.dataset.invoice;
      const paidField = invoice === 'first' ? 'first_invoice_paid' : 'second_invoice_paid';
      const currentValue = job[paidField];
      const newValue = currentValue ? null : new Date().toISOString().split('T')[0];

      await updateJobField(job.id, paidField, newValue);
      renderInvoicingSummary();
      await loadDashboardData();
    });
  });

  // Price input handlers (quoted_price and material_cost)
  priceInputs.forEach(input => {
    input.addEventListener('change', async (e) => {
      const field = e.target.dataset.field;
      const newValue = parseFloat(e.target.value) || null;
      await updateJobField(job.id, field, newValue);

      // Update job object for immediate use
      job[field] = newValue;

      // If quoted price changed, handle auto-population intelligently
      if (field === 'quoted_price' && newValue > 0) {
        const isSingle = job.single_invoice_mode === 1;
        const firstAmount = parseFloat(job.first_invoice_amount) || 0;
        const secondAmount = parseFloat(job.second_invoice_amount) || 0;

        const updates = {};

        if (isSingle) {
          // Single mode: put full amount in second invoice
          updates.second_invoice_amount = newValue;
          await updateJobFields(job.id, updates);
          await loadDashboardData();
        } else {
          // Dual mode: smart calculation
          if (firstAmount === 0 && secondAmount === 0) {
            // Both empty: split 50/50
            const half = (newValue / 2).toFixed(2);
            updates.first_invoice_amount = parseFloat(half);
            updates.second_invoice_amount = parseFloat(half);
            await updateJobFields(job.id, updates);
            await loadDashboardData();
          } else if (firstAmount > 0 && secondAmount === 0) {
            // First has value: calculate second as remainder
            const remainder = (newValue - firstAmount).toFixed(2);
            if (parseFloat(remainder) >= 0) {
              updates.second_invoice_amount = parseFloat(remainder);
              await updateJobFields(job.id, updates);
              await loadDashboardData();
            }
          } else if (firstAmount === 0 && secondAmount > 0) {
            // Second has value: calculate first as remainder
            const remainder = (newValue - secondAmount).toFixed(2);
            if (parseFloat(remainder) >= 0) {
              updates.first_invoice_amount = parseFloat(remainder);
              await updateJobFields(job.id, updates);
              await loadDashboardData();
            }
          }
        }
      }

      renderInvoicingSummary();
    });
  });
}

// Helper function to update a single job field
async function updateJobField(jobId, field, value) {
  try {
    const response = await fetch(`/api/jobs/${jobId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value })
    });

    if (!response.ok) throw new Error('Update failed');
    showToast('Updated successfully', 'success');
  } catch (error) {
    console.error('Error updating job:', error);
    showToast('Failed to update', 'error');
  }
}

// Helper function to update multiple job fields
async function updateJobFields(jobId, fields) {
  try {
    const response = await fetch(`/api/jobs/${jobId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields)
    });

    if (!response.ok) throw new Error('Update failed');
    showToast('Updated successfully', 'success');
  } catch (error) {
    console.error('Error updating job:', error);
    showToast('Failed to update', 'error');
  }
}

// Current completed filter
let completedFilter = 'week';

// Filter completed jobs by time period
function filterCompleted(period) {
  completedFilter = period;

  // Update active button
  const buttons = document.querySelectorAll('#tab-completed .tab-button');
  buttons.forEach(btn => btn.classList.remove('active'));
  event.target.classList.add('active');

  renderCompletedTable();
}

// Get date range for filter
function getDateRange(period) {
  const now = new Date();
  const ranges = {
    week: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
    month: new Date(now.getFullYear(), now.getMonth(), 1),
    year: new Date(now.getFullYear(), 0, 1),
    all: new Date(0)
  };
  return ranges[period] || ranges.week;
}

// Render Completed table
function renderCompletedTable() {
  const { jobs } = dashboardData;

  let completedJobs = jobs.filter(j => j.stage === 'Completed');

  // Apply time filter
  const filterDate = getDateRange(completedFilter);
  completedJobs = completedJobs.filter(j => {
    const completionDate = new Date(j.completion_date || j.updated_at);
    return completionDate >= filterDate;
  });

  // Calculate stats for filtered period
  const count = completedJobs.length;
  const totalRevenue = completedJobs.reduce((sum, j) => {
    return sum + (j.first_invoice_amount || 0) + (j.second_invoice_amount || 0);
  }, 0);
  const paidRevenue = completedJobs.reduce((sum, j) => {
    let paid = 0;
    if (j.first_invoice_paid) paid += (j.first_invoice_amount || 0);
    if (j.second_invoice_paid) paid += (j.second_invoice_amount || 0);
    return sum + paid;
  }, 0);
  const outstanding = totalRevenue - paidRevenue;

  // Update stats cards
  document.getElementById('completed-count').textContent = count;
  document.getElementById('completed-revenue').textContent = `$${formatMoney(totalRevenue)}`;
  document.getElementById('completed-paid').textContent = `$${formatMoney(paidRevenue)}`;
  document.getElementById('completed-outstanding').textContent = `$${formatMoney(outstanding)}`;

  const tableHtml = `
    <thead>
      <tr>
        <th>Job Name</th>
        <th>Address</th>
        <th>Color</th>
        <th>Completed</th>
        <th>Total Invoice</th>
        <th>Payment Status</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      ${completedJobs.length === 0 ? '<tr><td colspan="7"><div class="empty-state"><div class="empty-state-icon">✅</div><div>No completed jobs yet</div></div></td></tr>' : ''}
      ${completedJobs.map(job => {
        const total = (job.first_invoice_amount || 0) + (job.second_invoice_amount || 0);
        const paid = (job.first_invoice_paid ? (job.first_invoice_amount || 0) : 0) +
                     (job.second_invoice_paid ? (job.second_invoice_amount || 0) : 0);
        const paymentStatus = paid >= total ? 'Paid in Full' : `$${formatMoney(total - paid)} Outstanding`;
        const statusClass = paid >= total ? 'invoice-paid' : 'invoice-pending';
        const jobIdentifierHtml = job.job_identifier ? ` <span class="job-identifier-badge">${job.job_identifier}</span>` : '';

        return `
          <tr>
            <td>${job.job_name}${jobIdentifierHtml}</td>
            <td>${job.job_address || '-'}</td>
            <td>${job.job_color || '-'}</td>
            <td>${formatDate(job.completion_date || job.updated_at)}</td>
            <td>$${formatMoney(total)}</td>
            <td><span class="invoice-status ${statusClass}">${paymentStatus}</span></td>
            <td>
              <button class="btn-action btn-edit" onclick="window.location.href='index.html?edit=${job.id}'">Edit</button>
              <button class="btn-action btn-delete" onclick="deleteJob(${job.id}, '${job.job_name.replace(/'/g, "\\'")}')">Delete</button>
            </td>
          </tr>
        `;
      }).join('')}
    </tbody>
  `;

  document.getElementById('table-completed').innerHTML = tableHtml;
}

// Render Contractor Orders table
function renderOrdersTable() {
  const { orders } = dashboardData;

  const tableHtml = `
    <thead>
      <tr>
        <th>Order ID</th>
        <th>Contractor</th>
        <th>Product</th>
        <th>Quantity</th>
        <th>Cost</th>
        <th>Status</th>
        <th>Created</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      ${orders.length === 0 ? '<tr><td colspan="8"><div class="empty-state"><div class="empty-state-icon">📦</div><div>No orders yet</div></div></td></tr>' : ''}
      ${orders.map(order => `
        <tr>
          <td>#${order.order_id}</td>
          <td>${order.company_name || order.contact_name}</td>
          <td>${order.door_style} - ${order.finish_type}<br><small>${order.width}" x ${order.height}" x ${order.thickness}</small></td>
          <td>${order.quantity}</td>
          <td>$${formatMoney(order.cost)}</td>
          <td><span class="status-badge status-${order.order_status}">${order.order_status}</span></td>
          <td>${formatDate(order.order_created_at)}</td>
          <td>
            <button class="btn-action btn-edit" onclick="editOrder(${order.order_id})">Edit</button>
            <button class="btn-action btn-delete" onclick="deleteOrder(${order.order_id}, '${(order.company_name || order.contact_name).replace(/'/g, "\\'")}')">Delete</button>
          </td>
        </tr>
      `).join('')}
    </tbody>
  `;

  document.getElementById('table-orders').innerHTML = tableHtml;
}

// Switch tabs
function switchTab(tabName) {
  // Hide all tabs
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.remove('active');
  });

  // Deactivate all buttons
  document.querySelectorAll('.tab-button').forEach(btn => {
    btn.classList.remove('active');
  });

  // Show selected tab
  document.getElementById(`tab-${tabName}`).classList.add('active');

  // Activate button
  event.target.classList.add('active');

  // Load data for specific tabs
  if (tabName === 'customers') {
    renderCustomersTable();
  }
}

// Helper functions
function formatMoney(value) {
  return (value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getStatusClass(status) {
  if (!status) return 'pending';
  const s = status.toLowerCase();
  if (s.includes('complete')) return 'complete';
  if (s === 'approved') return 'approved';
  if (s === 'denied') return 'denied';
  if (s === 'pending') return 'pending';
  return 'pending';
}

function showToast(message, type = 'info') {
  // Simple toast notification
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: ${type === 'error' ? '#e57373' : type === 'success' ? '#81c784' : '#64b5f6'};
    color: white;
    padding: 15px 20px;
    border-radius: 8px;
    font-weight: 600;
    z-index: 10000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  `;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// Delete job function
async function deleteJob(jobId, jobName) {
  if (!confirm(`Are you sure you want to delete "${jobName}"? This action cannot be undone.`)) {
    return;
  }

  try {
    const response = await fetch(`/api/jobs/${jobId}`, {
      method: 'DELETE'
    });

    if (response.ok) {
      showToast('Job deleted successfully', 'success');
      // Reload dashboard data
      await loadDashboardData();
    } else {
      const error = await response.json();
      showToast(error.error || 'Failed to delete job', 'error');
    }
  } catch (error) {
    console.error('Error deleting job:', error);
    showToast('Failed to delete job', 'error');
  }
}

// Edit contractor order
async function editOrder(orderId) {
  // Redirect to contractor portal with order ID for editing
  window.location.href = `https://www.3notchcabinet.com/storefront.html?edit=${orderId}`;
}

// Delete contractor order
async function deleteOrder(orderId, contractorName) {
  if (!confirm(`Are you sure you want to delete order #${orderId} from "${contractorName}"? This action cannot be undone.`)) {
    return;
  }

  try {
    const response = await fetch(`/api/contractor-orders/${orderId}`, {
      method: 'DELETE'
    });

    if (response.ok) {
      showToast('Order deleted successfully', 'success');
      // Reload dashboard data
      await loadDashboardData();
    } else {
      const error = await response.json();
      showToast(error.error || 'Failed to delete order', 'error');
    }
  } catch (error) {
    console.error('Error deleting order:', error);
    showToast('Failed to delete order', 'error');
  }
}

// ==================== CUSTOMERS TAB ====================

async function renderCustomersTable() {
  try {
    const customersResponse = await fetch('/api/customers');
    const jobsResponse = await fetch('/api/jobs');

    const customers = await customersResponse.json();
    const jobs = await jobsResponse.json();

    // Count jobs per customer
    const jobCounts = {};
    jobs.forEach(job => {
      if (job.customer_id) {
        jobCounts[job.customer_id] = (jobCounts[job.customer_id] || 0) + 1;
      }
    });

    const tbody = document.getElementById('customers-body');
    tbody.innerHTML = '';

    if (customers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px; color: #9a9189;">No customers found</td></tr>';
      return;
    }

    customers.forEach(customer => {
      const row = tbody.insertRow();
      const jobCount = jobCounts[customer.id] || 0;
      const isContractor = customer.is_contractor ? 'Yes' : 'No';
      const contractorBg = customer.is_contractor ? 'rgba(76, 175, 80, 0.2)' : 'rgba(158, 158, 158, 0.2)';
      const contractorColor = customer.is_contractor ? '#81c784' : '#9e9e9e';

      row.innerHTML = '<td>' + (customer.name || '') + '</td>' +
        '<td>' + (customer.email || '') + '</td>' +
        '<td>' + (customer.phone || '') + '</td>' +
        '<td>' + (customer.address || '') + '</td>' +
        '<td style="text-align: center;"><span style="background: rgba(184, 174, 151, 0.2); padding: 4px 12px; border-radius: 12px; font-weight: 700;">' + jobCount + '</span></td>' +
        '<td style="text-align: center;"><span style="background: ' + contractorBg + '; color: ' + contractorColor + '; padding: 4px 12px; border-radius: 12px; font-weight: 700; font-size: 0.8rem;">' + isContractor + '</span></td>' +
        '<td><button class="btn-action btn-edit" onclick="viewCustomer(' + customer.id + ')">View</button></td>';
    });
  } catch (error) {
    console.error('Error loading customers:', error);
    const tbody = document.getElementById('customers-body');
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px; color: #f44336;">Error loading customers</td></tr>';
  }
}

async function viewCustomer(customerId) {
  try {
    const customerResponse = await fetch('/api/customers/' + customerId);
    if (!customerResponse.ok) throw new Error('Failed to fetch customer');

    const customer = await customerResponse.json();

    // Populate modal with customer data
    document.getElementById('edit-customer-id').value = customer.id;
    document.getElementById('edit-customer-name').value = customer.name || '';
    document.getElementById('edit-customer-email').value = customer.email || '';
    document.getElementById('edit-customer-phone').value = customer.phone || '';
    document.getElementById('edit-customer-address').value = customer.address || '';
    document.getElementById('edit-customer-notes').value = customer.notes || '';
    document.getElementById('edit-customer-is-contractor').checked = customer.is_contractor === 1;

    // Fetch all jobs for this customer
    const jobsResponse = await fetch('/api/jobs');
    if (jobsResponse.ok) {
      const allJobs = await jobsResponse.json();
      const customerJobs = allJobs.filter(job => job.customer_id === customerId);

      // Populate jobs list
      const jobsList = document.getElementById('customer-jobs-list');
      if (customerJobs.length === 0) {
        jobsList.innerHTML = '<div style="text-align: center; padding: 30px; color: #9a9189;">No jobs found for this customer</div>';
      } else {
        jobsList.innerHTML = customerJobs.map(job => {
          const quotedPrice = job.quoted_price ? '$' + parseFloat(job.quoted_price).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : 'N/A';
          const materialCost = job.material_cost ? '$' + parseFloat(job.material_cost).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : 'N/A';

          return `
            <div style="margin-bottom: 15px; padding: 15px; background: #2a2a28; border-radius: 8px; border: 1px solid #3a3a38;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <div style="font-weight: 700; color: #b8ae97; font-size: 1rem;">${job.job_name}</div>
                <span style="background: rgba(184, 174, 151, 0.2); padding: 4px 12px; border-radius: 12px; font-size: 0.8rem; font-weight: 700;">${job.stage}</span>
              </div>
              ${job.job_address ? `<div style="color: #9a9189; font-size: 0.9rem; margin-bottom: 8px;">${job.job_address}</div>` : ''}
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px;">
                <div style="background: rgba(184, 174, 151, 0.05); padding: 8px; border-radius: 4px;">
                  <div style="font-size: 0.75rem; color: #9a9189;">Quoted Price</div>
                  <div style="font-size: 1rem; font-weight: 700; color: #b8ae97;">${quotedPrice}</div>
                </div>
                <div style="background: rgba(184, 174, 151, 0.05); padding: 8px; border-radius: 4px;">
                  <div style="font-size: 0.75rem; color: #9a9189;">Material Cost</div>
                  <div style="font-size: 1rem; font-weight: 700; color: #b8ae97;">${materialCost}</div>
                </div>
              </div>
              <div style="margin-top: 10px;">
                <button class="btn-action btn-edit" onclick="window.location.href='index.html?edit=${job.id}'">View Job</button>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // Show modal
    document.getElementById('edit-customer-modal').classList.add('show');
  } catch (error) {
    console.error('Error loading customer:', error);
    alert('Error loading customer details');
  }
}

// Close customer modal
document.getElementById('close-edit-customer-modal').addEventListener('click', () => {
  document.getElementById('edit-customer-modal').classList.remove('show');
});

document.getElementById('cancel-edit-customer').addEventListener('click', () => {
  document.getElementById('edit-customer-modal').classList.remove('show');
});

// Close modal on background click
document.getElementById('edit-customer-modal').addEventListener('click', (e) => {
  if (e.target.id === 'edit-customer-modal') {
    document.getElementById('edit-customer-modal').classList.remove('show');
  }
});

// Save customer changes
document.getElementById('edit-customer-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const customerId = document.getElementById('edit-customer-id').value;
  const customerData = {
    name: document.getElementById('edit-customer-name').value.trim(),
    email: document.getElementById('edit-customer-email').value.trim(),
    phone: document.getElementById('edit-customer-phone').value.trim(),
    address: document.getElementById('edit-customer-address').value.trim(),
    notes: document.getElementById('edit-customer-notes').value.trim(),
    is_contractor: document.getElementById('edit-customer-is-contractor').checked ? 1 : 0
  };

  try {
    const response = await fetch('/api/customers/' + customerId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(customerData)
    });

    if (!response.ok) throw new Error('Failed to update customer');

    showToast('Customer updated successfully', 'success');
    document.getElementById('edit-customer-modal').classList.remove('show');

    // Reload customers table
    renderCustomersTable();
  } catch (error) {
    console.error('Error updating customer:', error);
    showToast('Failed to update customer', 'error');
  }
});

// Delete customer
document.getElementById('delete-customer-btn').addEventListener('click', async () => {
  if (!confirm('Are you sure you want to delete this customer? This will not delete their jobs, but will unlink them.')) {
    return;
  }

  const customerId = document.getElementById('edit-customer-id').value;

  try {
    const response = await fetch('/api/customers/' + customerId, {
      method: 'DELETE'
    });

    if (!response.ok) throw new Error('Failed to delete customer');

    showToast('Customer deleted successfully', 'success');
    document.getElementById('edit-customer-modal').classList.remove('show');

    // Reload customers table
    renderCustomersTable();
  } catch (error) {
    console.error('Error deleting customer:', error);
    showToast('Failed to delete customer', 'error');
  }
});

// Initialize
(async () => {
  const authenticated = await checkAuth();
  if (authenticated) {
    await loadDashboardData();
  }
})();
