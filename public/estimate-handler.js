// Estimate and Customer Management for Job Tracker

let customers = [];
let services = [];
let estimateItems = [];
let currentJobCabinetData = null; // Stored mozaik_cabinet_data for import

// Load customers and services
async function loadCustomersAndServices() {
  try {
    const [customersRes, servicesRes] = await Promise.all([
      fetch('/api/customers'),
      fetch('/api/services')
    ]);

    customers = await customersRes.json();
    services = await servicesRes.json();

    populateCustomerDropdown();
  } catch (error) {
    console.error('Error loading customers/services:', error);
  }
}

// Populate customer dropdown
function populateCustomerDropdown() {
  const select = document.getElementById('customer-select');
  select.innerHTML = '<option value="">Select Customer...</option>';

  customers.forEach(customer => {
    const option = document.createElement('option');
    option.value = customer.id;
    option.textContent = customer.name;
    option.dataset.email = customer.email || '';
    option.dataset.phone = customer.phone || '';
    option.dataset.address = customer.address || '';
    select.appendChild(option);
  });
}

// Show/hide new customer form
document.getElementById('add-customer-btn').addEventListener('click', () => {
  document.getElementById('new-customer-form').style.display = 'block';
  document.getElementById('new-customer-name').focus();
});

document.getElementById('cancel-new-customer-btn').addEventListener('click', () => {
  document.getElementById('new-customer-form').style.display = 'none';
  document.getElementById('new-customer-name').value = '';
  document.getElementById('new-customer-email').value = '';
  document.getElementById('new-customer-phone').value = '';
  document.getElementById('new-customer-address').value = '';
});

// Save new customer
document.getElementById('save-customer-btn').addEventListener('click', async () => {
  const name = document.getElementById('new-customer-name').value.trim();
  if (!name) {
    showToast('Please enter customer name', 'error');
    return;
  }

  const customerData = {
    name: name,
    email: document.getElementById('new-customer-email').value.trim(),
    phone: document.getElementById('new-customer-phone').value.trim(),
    address: document.getElementById('new-customer-address').value.trim(),
    is_contractor: false,
    contractor_id: null,
    notes: ''
  };

  try {
    const response = await fetch('/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(customerData)
    });

    const newCustomer = await response.json();
    customers.push(newCustomer);
    populateCustomerDropdown();

    document.getElementById('customer-select').value = newCustomer.id;
    document.getElementById('cancel-new-customer-btn').click();

    showToast('Customer added successfully', 'success');
  } catch (error) {
    console.error('Error saving customer:', error);
    showToast('Error saving customer', 'error');
  }
});

// Customer selection handler - auto-fill email if available
document.getElementById('customer-select').addEventListener('change', (e) => {
  const selectedOption = e.target.options[e.target.selectedIndex];
  if (selectedOption.dataset.email) {
    document.getElementById('job-email').value = selectedOption.dataset.email;
  }
  if (selectedOption.dataset.address && !document.getElementById('job-address').value) {
    document.getElementById('job-address').value = selectedOption.dataset.address;
  }
});

// Add line item - simplified QuickBooks style (Description | Qty | Rate | Amount)
function addLineItem(item = null) {
  const tbody = document.getElementById('estimate-items-body');
  const row = tbody.insertRow();
  row.className = 'estimate-item-row';

  const lineItem = item || {
    description: '',
    quantity: 1,
    rate: 0,
    amount: 0
  };

  row.innerHTML = `
    <td style="padding: 8px;">
      <input type="text" class="line-item-description" value="${lineItem.description || ''}"
             placeholder="e.g. Base Cabinets, Wall Cabinets..."
             style="width: 100%; padding: 10px; background: #1e1e1c; color: #e5e3df; border: 1px solid #444; border-radius: 4px; font-size: 14px;">
    </td>
    <td style="padding: 8px; text-align: center;">
      <input type="number" class="line-item-qty" value="${lineItem.quantity || 1}" min="1" step="1"
             style="width: 60px; padding: 10px; background: #1e1e1c; color: #e5e3df; border: 1px solid #444; border-radius: 4px; text-align: center; font-size: 14px;">
    </td>
    <td style="padding: 8px; text-align: right;">
      <input type="number" class="line-item-rate" value="${(lineItem.rate || 0).toFixed(2)}" min="0" step="0.01"
             style="width: 90px; padding: 10px; background: #1e1e1c; color: #e5e3df; border: 1px solid #444; border-radius: 4px; text-align: right; font-size: 14px;">
    </td>
    <td style="padding: 8px; text-align: right;">
      <span class="line-item-amount" style="font-weight: 700; color: #4caf50; font-size: 15px;">$${(lineItem.amount || 0).toFixed(2)}</span>
    </td>
    <td style="padding: 8px; text-align: center;">
      <button type="button" class="btn-delete-line" style="padding: 6px 10px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; font-weight: 700; line-height: 1;">&times;</button>
    </td>
  `;

  // Event handlers
  row.querySelector('.line-item-qty').addEventListener('input', () => updateLineItemAmount(row));
  row.querySelector('.line-item-rate').addEventListener('input', () => updateLineItemAmount(row));
  row.querySelector('.btn-delete-line').addEventListener('click', () => {
    row.remove();
    updateEstimateTotal();
  });

  updateLineItemAmount(row);
}

// Update single line item amount
function updateLineItemAmount(row) {
  const qty = parseFloat(row.querySelector('.line-item-qty').value) || 0;
  const rate = parseFloat(row.querySelector('.line-item-rate').value) || 0;
  const amount = qty * rate;

  row.querySelector('.line-item-amount').textContent = '$' + amount.toFixed(2);
  updateEstimateTotal();
}

// Update estimate total
function updateEstimateTotal() {
  const rows = document.querySelectorAll('.estimate-item-row');
  let total = 0;

  rows.forEach(row => {
    const qty = parseFloat(row.querySelector('.line-item-qty').value) || 0;
    const rate = parseFloat(row.querySelector('.line-item-rate').value) || 0;
    total += qty * rate;
  });

  document.getElementById('estimate-total').textContent = '$' + total.toFixed(2);

  // Sync with quoted price input if line items have values
  if (total > 0) {
    const quotedPriceInput = document.getElementById('quoted-price-input');
    if (quotedPriceInput) {
      quotedPriceInput.value = total.toFixed(2);
    }
    document.getElementById('quoted-price').value = total;
  }

  // Update profit display
  updateProfitDisplay(total > 0 ? total : null);

  return total;
}

// Update profit margin display
function updateProfitDisplay(quotedPrice = null) {
  const materialCostInput = document.getElementById('material-cost-input');
  if (!materialCostInput) return;

  const materialCost = parseFloat(materialCostInput.value) || 0;

  let quoted = quotedPrice;
  if (quoted === null || quoted === undefined) {
    const quotedInput = document.getElementById('quoted-price-input');
    quoted = quotedInput ? parseFloat(quotedInput.value) || 0 : 0;
  }

  const profit = quoted - materialCost;
  const profitPercentValue = materialCost > 0 ? (profit / materialCost * 100) : 0;

  const profitQuoted = document.getElementById('profit-quoted');
  const profitCost = document.getElementById('profit-cost');
  const profitValue = document.getElementById('profit-value');
  const profitPercentEl = document.getElementById('profit-percent');

  if (profitQuoted) profitQuoted.textContent = '$' + quoted.toFixed(2);
  if (profitCost) profitCost.textContent = '$' + materialCost.toFixed(2);
  if (profitValue) {
    profitValue.textContent = '$' + profit.toFixed(2);
    profitValue.style.color = profit >= 0 ? '#4caf50' : '#f44336';
  }
  if (profitPercentEl) {
    profitPercentEl.textContent = '(' + profitPercentValue.toFixed(1) + '%)';
    profitPercentEl.style.color = profit >= 0 ? '#81c784' : '#e57373';
  }

  const hiddenField = document.getElementById('material-cost');
  if (hiddenField) hiddenField.value = materialCost;

  return { quoted, materialCost, profit, profitPercentValue };
}

// Import cabinet details from Mozaik data
function importFromMozaik() {
  if (!currentJobCabinetData) {
    showToast('No Mozaik cabinet data available for this job', 'error');
    return;
  }

  const data = typeof currentJobCabinetData === 'string'
    ? JSON.parse(currentJobCabinetData)
    : currentJobCabinetData;

  // Clear existing items
  document.getElementById('estimate-items-body').innerHTML = '';

  // Detect format: detailed (counts > 1) vs simple (cabinets[] with amounts)
  const isDetailed = data.rooms && data.rooms.some(r =>
    r.counts && (r.counts.base > 1 || r.counts.wall > 1 || r.counts.tall > 1));

  if (data.rooms && data.rooms.length > 0) {
    if (isDetailed) {
      // Detailed format: use counts for descriptions
      data.rooms.forEach(room => {
        const roomLabel = data.rooms.length > 1 ? ` (${room.name})` : '';

        if (room.counts.base > 0) {
          addLineItem({ description: `${room.counts.base} Base Cabinets${roomLabel}`, quantity: 1, rate: 0, amount: 0 });
        }
        if (room.counts.wall > 0) {
          addLineItem({ description: `${room.counts.wall} Wall Cabinets${roomLabel}`, quantity: 1, rate: 0, amount: 0 });
        }
        if (room.counts.tall > 0) {
          addLineItem({ description: `${room.counts.tall} Tall Cabinets${roomLabel}`, quantity: 1, rate: 0, amount: 0 });
        }
        if (room.doors && room.doors.base_tall > 0) {
          addLineItem({ description: `${room.doors.base_tall} Base/Tall Doors${roomLabel}`, quantity: 1, rate: 0, amount: 0 });
        }
        if (room.doors && room.doors.wall > 0) {
          addLineItem({ description: `${room.doors.wall} Wall Doors${roomLabel}`, quantity: 1, rate: 0, amount: 0 });
        }
        if (room.doors && room.doors.drawer_fronts > 0) {
          addLineItem({ description: `${room.doors.drawer_fronts} Drawer Fronts${roomLabel}`, quantity: 1, rate: 0, amount: 0 });
        }
        if (room.crown_molding_ft > 0) {
          addLineItem({ description: `Crown Molding - ${room.crown_molding_ft} LF${roomLabel}`, quantity: 1, rate: 0, amount: 0 });
        }
      });
    } else {
      // Simple format: use cabinets[] array with pre-filled amounts
      data.rooms.forEach(room => {
        const roomLabel = data.rooms.length > 1 ? ` (${room.name})` : '';

        if (room.cabinets && room.cabinets.length > 0) {
          room.cabinets.forEach(cab => {
            const desc = cab.qty > 1
              ? `${cab.qty} ${cab.type}${roomLabel}`
              : `${cab.type}${roomLabel}`;
            addLineItem({ description: desc, quantity: 1, rate: cab.amount || 0, amount: cab.amount || 0 });
          });
        }
        if (room.crown_molding_ft > 0) {
          addLineItem({ description: `Crown Molding - ${room.crown_molding_ft} LF${roomLabel}`, quantity: 1, rate: 0, amount: 0 });
        }
      });
    }

    // Add finish line if available
    if (data.finish) {
      addLineItem({ description: `Cabinet Finish: ${data.finish}`, quantity: 1, rate: 0, amount: 0 });
    }
  }

  updateEstimateTotal();
  showToast('Cabinet details imported from Mozaik', 'success');
}

// Set cabinet data for current job (called from app.js when loading a job)
function setCabinetData(cabinetData) {
  currentJobCabinetData = cabinetData;
  const importBtn = document.getElementById('import-mozaik-btn');
  if (importBtn) {
    importBtn.style.display = cabinetData ? 'inline-block' : 'none';
  }
}

// Get line items for saving
function getLineItems() {
  const rows = document.querySelectorAll('.estimate-item-row');
  const items = [];

  rows.forEach(row => {
    const description = row.querySelector('.line-item-description').value.trim();
    const qty = parseFloat(row.querySelector('.line-item-qty').value) || 1;
    const rate = parseFloat(row.querySelector('.line-item-rate').value) || 0;
    const amount = qty * rate;

    if (description) {
      items.push({
        service_id: null,
        description: description,
        quantity: qty,
        sqft: 1,
        rate: rate,
        amount: amount
      });
    }
  });

  return items;
}

// Load line items for a job
async function loadLineItems(jobId) {
  try {
    const response = await fetch(`/api/jobs/${jobId}/estimate-items`);
    const items = await response.json();

    // Clear existing items
    document.getElementById('estimate-items-body').innerHTML = '';

    // Add each item
    items.forEach(item => addLineItem(item));

    if (items.length === 0) {
      // Add one blank line if no items
      addLineItem();
    }

    updateEstimateTotal();
  } catch (error) {
    console.error('Error loading line items:', error);
    addLineItem(); // Add blank line on error
  }
}

// Clear line items
function clearLineItems() {
  document.getElementById('estimate-items-body').innerHTML = '';
  addLineItem(); // Add one blank line
  updateEstimateTotal();
}

// Add line item button handler
document.getElementById('add-line-item-btn').addEventListener('click', () => {
  addLineItem();
});

// Import from Mozaik button handler
document.getElementById('import-mozaik-btn').addEventListener('click', () => {
  importFromMozaik();
});

// Material cost input handler
let materialCostListenerAttached = false;

function initMaterialCostListener() {
  const materialCostInput = document.getElementById('material-cost-input');
  if (!materialCostInput) return;

  if (!materialCostListenerAttached) {
    materialCostInput.addEventListener('input', () => updateProfitDisplay());
    materialCostInput.addEventListener('change', () => updateProfitDisplay());
    materialCostListenerAttached = true;
  }

  updateProfitDisplay();
}

// Call on DOM load
document.addEventListener('DOMContentLoaded', () => {
  initMaterialCostListener();
  loadCustomersAndServices();
});

// Export functions for use in app.js
window.estimateHandler = {
  loadCustomersAndServices,
  loadLineItems,
  clearLineItems,
  getLineItems,
  updateEstimateTotal,
  addLineItem,
  initMaterialCostListener,
  importFromMozaik,
  setCabinetData
};
