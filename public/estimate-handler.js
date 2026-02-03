// Estimate and Customer Management for Job Tracker

let customers = [];
let services = [];
let estimateItems = [];

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

// Add line item
function addLineItem(item = null) {
  const tbody = document.getElementById('estimate-items-body');
  const row = tbody.insertRow();
  row.className = 'estimate-item-row';

  const lineItem = item || {
    service_id: '',
    description: '',
    quantity: 1,
    sqft: 1,
    rate: 0,
    amount: 0
  };

  // Build services options
  let servicesOptions = '<option value="">Select...</option>';
  services.forEach(s => {
    servicesOptions += `<option value="${s.id}" data-rate="${s.default_rate || 0}">${s.name}</option>`;
  });

  row.innerHTML = `
    <td style="padding: 10px;">
      <select class="line-item-service" style="width: 100%; padding: 12px; background: #1e1e1c; color: #e5e3df; border: 2px solid #4caf50; border-radius: 6px; font-size: 16px; font-weight: 600;">
        ${servicesOptions}
      </select>
    </td>
    <td style="padding: 10px;">
      <input type="text" class="line-item-description" value="${lineItem.description}"
             style="width: 100%; padding: 12px; background: #1e1e1c; color: #e5e3df; border: 2px solid #4caf50; border-radius: 6px; font-size: 16px; font-weight: 600;">
    </td>
    <td style="padding: 10px; text-align: center;">
      <input type="number" class="line-item-qty" value="${lineItem.quantity}" min="1" step="1"
             style="width: 80px; padding: 12px; background: #1e1e1c; color: #e5e3df; border: 2px solid #b8ae97; border-radius: 6px; text-align: center; font-size: 16px; font-weight: 600;">
    </td>
    <td style="padding: 10px; text-align: center;">
      <input type="number" class="line-item-sqft" value="${lineItem.sqft || 1}" min="0" step="0.01"
             style="width: 90px; padding: 12px; background: #1e1e1c; color: #e5e3df; border: 2px solid #b8ae97; border-radius: 6px; text-align: center; font-size: 16px; font-weight: 600;">
    </td>
    <td style="padding: 10px; text-align: right;">
      <input type="number" class="line-item-rate" value="${lineItem.rate}" min="0" step="0.01"
             style="width: 100px; padding: 12px; background: #1e1e1c; color: #e5e3df; border: 2px solid #b8ae97; border-radius: 6px; text-align: right; font-size: 16px; font-weight: 600;">
    </td>
    <td style="padding: 10px; text-align: right;">
      <span class="line-item-amount" style="font-weight: 700; color: #4caf50; font-size: 18px;">$${lineItem.amount.toFixed(2)}</span>
    </td>
    <td style="padding: 10px; text-align: center;">
      <button type="button" class="btn-delete-line" style="padding: 8px 12px; background: #f44336; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 18px; font-weight: 700;">×</button>
    </td>
  `;

  // Set service if provided
  if (lineItem.service_id) {
    row.querySelector('.line-item-service').value = lineItem.service_id;
  }

  // Service selection handler
  row.querySelector('.line-item-service').addEventListener('change', (e) => {
    const selectedOption = e.target.options[e.target.selectedIndex];
    const defaultRate = parseFloat(selectedOption.dataset.rate) || 0;
    const serviceName = selectedOption.textContent;

    row.querySelector('.line-item-rate').value = defaultRate.toFixed(2);
    if (!row.querySelector('.line-item-description').value) {
      row.querySelector('.line-item-description').value = serviceName;
    }
    updateLineItemAmount(row);
  });

  // Qty, SqFt, and Rate change handlers
  row.querySelector('.line-item-qty').addEventListener('input', () => updateLineItemAmount(row));
  row.querySelector('.line-item-sqft').addEventListener('input', () => updateLineItemAmount(row));
  row.querySelector('.line-item-rate').addEventListener('input', () => updateLineItemAmount(row));

  // Delete button handler
  row.querySelector('.btn-delete-line').addEventListener('click', () => {
    row.remove();
    updateEstimateTotal();
  });

  updateLineItemAmount(row);
}

// Update single line item amount
function updateLineItemAmount(row) {
  const qty = parseFloat(row.querySelector('.line-item-qty').value) || 0;
  const sqft = parseFloat(row.querySelector('.line-item-sqft').value) || 0;
  const rate = parseFloat(row.querySelector('.line-item-rate').value) || 0;
  const amount = qty * sqft * rate;

  row.querySelector('.line-item-amount').textContent = '$' + amount.toFixed(2);
  updateEstimateTotal();
}

// Update estimate total
function updateEstimateTotal() {
  const rows = document.querySelectorAll('.estimate-item-row');
  let total = 0;

  rows.forEach(row => {
    const qty = parseFloat(row.querySelector('.line-item-qty').value) || 0;
    const sqft = parseFloat(row.querySelector('.line-item-sqft').value) || 0;
    const rate = parseFloat(row.querySelector('.line-item-rate').value) || 0;
    total += qty * sqft * rate;
  });

  document.getElementById('estimate-total').textContent = '$' + total.toFixed(2);

  // Update hidden fields for backwards compatibility
  document.getElementById('quoted-price').value = total;

  // Update profit display
  updateProfitDisplay(total);

  return total;
}

// Update profit margin display
function updateProfitDisplay(quotedPrice = null) {
  console.log('========== updateProfitDisplay CALLED ==========');

  const materialCostInput = document.getElementById('material-cost-input');
  if (!materialCostInput) {
    console.error('❌ Material cost input not found');
    return;
  }

  const materialCost = parseFloat(materialCostInput.value) || 0;
  console.log('📊 Material Cost from input:', materialCost, '(raw value:', materialCostInput.value, ')');
  console.log('📊 Material Cost Input element:', materialCostInput);

  // Get quoted price from parameter or calculate from line items
  let quoted = quotedPrice;
  if (quoted === null || quoted === undefined) {
    const rows = document.querySelectorAll('.estimate-item-row');
    quoted = 0;
    console.log('📝 Calculating quoted price from', rows.length, 'line items:');
    rows.forEach((row, index) => {
      const qty = parseFloat(row.querySelector('.line-item-qty')?.value) || 0;
      const sqft = parseFloat(row.querySelector('.line-item-sqft')?.value) || 0;
      const rate = parseFloat(row.querySelector('.line-item-rate')?.value) || 0;
      const lineTotal = qty * sqft * rate;
      console.log(`  Line ${index + 1}: ${qty} × ${sqft} × $${rate} = $${lineTotal.toFixed(2)}`);
      quoted += lineTotal;
    });
  }
  console.log('💵 Total Quoted Price:', quoted);

  const profit = quoted - materialCost;
  const profitPercentValue = materialCost > 0 ? (profit / materialCost * 100) : 0;
  console.log('💰 Calculated Profit: $' + profit.toFixed(2), '(' + profitPercentValue.toFixed(1) + '%)');

  // Update profit display elements
  const profitQuoted = document.getElementById('profit-quoted');
  const profitCost = document.getElementById('profit-cost');
  const profitValue = document.getElementById('profit-value');
  const profitPercentEl = document.getElementById('profit-percent');

  console.log('🎯 Updating display elements:');
  if (profitQuoted) {
    profitQuoted.textContent = '$' + quoted.toFixed(2);
    console.log('  ✓ profit-quoted: $' + quoted.toFixed(2));
  } else {
    console.error('  ❌ profit-quoted element not found!');
  }

  if (profitCost) {
    profitCost.textContent = '$' + materialCost.toFixed(2);
    console.log('  ✓ profit-cost: $' + materialCost.toFixed(2));
  } else {
    console.error('  ❌ profit-cost element not found!');
  }

  if (profitValue) {
    profitValue.textContent = '$' + profit.toFixed(2);
    profitValue.style.color = profit >= 0 ? '#4caf50' : '#f44336';
    console.log('  ✓ profit-value: $' + profit.toFixed(2));
  } else {
    console.error('  ❌ profit-value element not found!');
  }

  if (profitPercentEl) {
    profitPercentEl.textContent = '(' + profitPercentValue.toFixed(1) + '%)';
    profitPercentEl.style.color = profit >= 0 ? '#81c784' : '#e57373';
    console.log('  ✓ profit-percent:', profitPercentValue.toFixed(1) + '%');
  } else {
    console.error('  ❌ profit-percent element not found!');
  }

  // Update hidden field
  const hiddenField = document.getElementById('material-cost');
  if (hiddenField) {
    hiddenField.value = materialCost;
    console.log('  ✓ Hidden field updated');
  }

  console.log('========== updateProfitDisplay COMPLETE ==========\n');

  return { quoted, materialCost, profit, profitPercentValue };
}

// Get line items for saving
function getLineItems() {
  const rows = document.querySelectorAll('.estimate-item-row');
  const items = [];

  rows.forEach(row => {
    const serviceId = row.querySelector('.line-item-service').value;
    const description = row.querySelector('.line-item-description').value.trim();
    const qty = parseFloat(row.querySelector('.line-item-qty').value) || 1;
    const sqft = parseFloat(row.querySelector('.line-item-sqft').value) || 1;
    const rate = parseFloat(row.querySelector('.line-item-rate').value) || 0;
    const amount = qty * sqft * rate;

    if (description) {
      items.push({
        service_id: serviceId || null,
        description: description,
        quantity: qty,
        sqft: sqft,
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

// Material cost input handler - attach after DOM loads
let materialCostListenerAttached = false;

function initMaterialCostListener() {
  const materialCostInput = document.getElementById('material-cost-input');

  if (!materialCostInput) {
    console.error('❌ Material cost input element not found!');
    return;
  }

  // Only attach listener once per page load
  if (!materialCostListenerAttached) {
    console.log('✓ Attaching material cost listener to:', materialCostInput);

    // Add input event listener
    materialCostInput.addEventListener('input', (e) => {
      console.log('💰 Material cost INPUT event fired. Value:', e.target.value);
      updateProfitDisplay();
    });

    // Add change event listener as backup
    materialCostInput.addEventListener('change', (e) => {
      console.log('💰 Material cost CHANGE event fired. Value:', e.target.value);
      updateProfitDisplay();
    });

    // Add keyup event listener for more responsiveness
    materialCostInput.addEventListener('keyup', (e) => {
      console.log('💰 Material cost KEYUP event fired. Value:', e.target.value);
      updateProfitDisplay();
    });

    materialCostListenerAttached = true;
    console.log('✅ Material cost listener attached successfully');
  } else {
    console.log('✓ Material cost listener already attached');
  }

  // Always trigger calculation when this is called (even if listener was already attached)
  console.log('🔄 Triggering profit calculation. Current value:', materialCostInput.value);
  updateProfitDisplay();
}

// Call on DOM load
document.addEventListener('DOMContentLoaded', () => {
  initMaterialCostListener();
});

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
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
  initMaterialCostListener
};
