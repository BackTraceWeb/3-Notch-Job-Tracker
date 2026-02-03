// Socket.IO connection
const socket = io();

// State
let currentUser = null;
let jobs = [];
let editingJobId = null;
let currentBoard = 'production'; // quotes, production, milestone

// Stage definitions for different boards
const allStages = [
  'Quote/Estimate',
  'In Progress - Ready to Cut',
  'In Progress - Cut',
  'In Progress - Paint & Sand',
  'In Progress - Assemble',
  'In Progress - Ready to Install',
  'In Progress - Installed',
  'In Progress - Installed - Finish Work',
  'Completed'
];

// Quote/Estimate board
const quotesStages = ['Quote/Estimate'];

const productionStages = [
  'In Progress - Ready to Cut',
  'In Progress - Cut',
  'In Progress - Paint & Sand',
  'In Progress - Assemble',
  'In Progress - Ready to Install',
  'In Progress - Installed',
  'In Progress - Installed - Finish Work'
];

// Milestone board shows grouped stages
const milestoneStages = ['Quote/Estimate', 'In Progress', 'Installed'];

// Stage to completion percentage mapping
function getStagePercentage(stage) {
  const percentageMap = {
    'Quote/Estimate': 0,
    'In Progress - Ready to Cut': 15,
    'Ready to Cut': 15,
    'In Progress - Cut': 30,
    'Cut': 30,
    'In Progress - Paint & Sand': 50,
    'In Progress - Paint': 50,
    'Paint & Sand': 50,
    'Paint': 50,
    'In Progress - Assemble': 70,
    'Assemble': 70,
    'In Progress - Ready to Install': 85,
    'Ready to Install': 85,
    'In Progress - Installed': 95,
    'Installed': 95,
    'In Progress - Installed - Finish Work': 98,
    'Installed - Finish Work': 98,
    'Completed': 100
  };
  return percentageMap[stage] || 0;
}

// Paint colors dictionary loaded from paint-colors.js
// Contains 1,500+ Sherwin-Williams colors plus Benjamin Moore and generic colors

// Helper function to get actual color value from paint name or hex
function getPaintColor(colorInput) {
  if (!colorInput) return null;

  // If it starts with # or rgb, it's already a valid CSS color
  if (colorInput.startsWith('#') || colorInput.startsWith('rgb')) {
    return colorInput;
  }

  // Look up paint color name (case-insensitive)
  const lookup = colorInput.toLowerCase().trim();
  return paintColors[lookup] || colorInput; // Return original if not found
}

// Helper function to check if job belongs to milestone stage
function getMilestoneStage(job) {
  if (job.stage === 'Quote/Estimate') return 'Quote/Estimate';
  if (job.stage.startsWith('In Progress')) return 'In Progress';
  if (job.stage === 'Installed' || job.stage.startsWith('In Progress - Installed')) return 'Installed';
  return null;
}

// Helper function to determine if text should be light or dark based on background color
function getTextColorForBackground(bgColor) {
  // Default to dark text if no color provided
  if (!bgColor) return '#181715';

  // Create a temporary element to get computed background color
  const temp = document.createElement('div');
  temp.style.backgroundColor = bgColor; // Set background color, not text color
  temp.style.display = 'none'; // Hide it
  document.body.appendChild(temp);
  const computed = window.getComputedStyle(temp).backgroundColor; // Read backgroundColor
  document.body.removeChild(temp);

  // Parse RGB values from computed style (format: "rgb(r, g, b)" or "rgba(r, g, b, a)")
  const rgb = computed.match(/\d+/g);
  if (!rgb || rgb.length < 3) return '#181715';

  const r = parseInt(rgb[0]);
  const g = parseInt(rgb[1]);
  const b = parseInt(rgb[2]);

  // Calculate relative luminance using WCAG 2.1 formula with gamma correction
  const rsRGB = r / 255;
  const gsRGB = g / 255;
  const bsRGB = b / 255;

  const rLinear = rsRGB <= 0.03928 ? rsRGB / 12.92 : Math.pow((rsRGB + 0.055) / 1.055, 2.4);
  const gLinear = gsRGB <= 0.03928 ? gsRGB / 12.92 : Math.pow((gsRGB + 0.055) / 1.055, 2.4);
  const bLinear = bsRGB <= 0.03928 ? bsRGB / 12.92 : Math.pow((bsRGB + 0.055) / 1.055, 2.4);

  const luminance = 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;

  // Use threshold of 0.179 (approximately midpoint for good contrast)
  // This ensures dark browns, auburns, and dark colors get white text
  return luminance > 0.179 ? '#181715' : '#FFFFFF';
}

// DOM Elements
const userNameEl = document.getElementById('user-name');
const newQuoteBtn = document.getElementById('new-quote-btn');
const logoutBtn = document.getElementById('logout-btn');
const modal = document.getElementById('job-modal');
const jobForm = document.getElementById('job-form');
const deleteJobBtn = document.getElementById('delete-job-btn');
const toast = document.getElementById('toast');

// Board elements
const quotesBoard = document.getElementById('quotes-board');
const productionBoard = document.getElementById('production-board');
const milestoneBoard = document.getElementById('milestone-board');

// Initialize
async function init() {
  await checkAuth();
  if (currentUser) {
    setupBoardSwitcher();
    createQuotesBoard();
    createProductionBoard();
    createMilestoneBoard();
    await loadJobs();
    await loadCustomersAndServices();  // Load customers for dropdown
    setupEventListeners();
    setupSocketListeners();

    // Check if we need to open a job for editing from dashboard
    const urlParams = new URLSearchParams(window.location.search);
    const editJobId = urlParams.get('edit');
    if (editJobId) {
      const job = jobs.find(j => j.id == editJobId);
      if (job) {
        openEditJobModal(job);
        // Clear the query parameter from URL without reloading
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }

    // Show admin button for admin users
    if (currentUser.role === 'admin') {
      const adminBtn = document.getElementById('admin-btn');
      if (adminBtn) {
        adminBtn.style.display = 'inline-block';
      }
      setupAdminPanel();
    }
  }
}

// Check authentication
async function checkAuth() {
  try {
    const response = await fetch('/api/auth/check');
    const data = await response.json();

    if (data.authenticated) {
      currentUser = data.user;
      userNameEl.textContent = data.user.fullName;
    } else {
      window.location.href = 'login.html';
    }
  } catch (error) {
    console.error('Auth check failed:', error);
    window.location.href = 'login.html';
  }
}

// Logout
logoutBtn.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = 'login.html';
});

// Board Switcher
function setupBoardSwitcher() {
  const boardTabs = document.querySelectorAll('.board-tab');
  boardTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const boardType = tab.dataset.board;
      switchBoard(boardType);

      // Update active tab
      boardTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
    });
  });
}

function switchBoard(boardType) {
  currentBoard = boardType;

  // Hide all boards
  document.getElementById('quotes-view').style.display = 'none';
  document.getElementById('production-view').style.display = 'none';
  document.getElementById('milestone-view').style.display = 'none';

  // Show selected board
  document.getElementById(`${boardType}-view`).style.display = 'block';

  // Render jobs
  renderJobs();
}

function createQuotesBoard() {
  quotesBoard.innerHTML = '';
  createBoardColumns(quotesBoard, quotesStages);
}

function createProductionBoard() {
  productionBoard.innerHTML = '';
  createBoardColumns(productionBoard, productionStages);
}

function createMilestoneBoard() {
  milestoneBoard.innerHTML = '';
  createBoardColumns(milestoneBoard, milestoneStages);
}

function createBoardColumns(boardElement, stages) {
  stages.forEach(stage => {
    const column = document.createElement('div');
    column.className = 'kanban-column';
    column.dataset.stage = stage;

    column.innerHTML = `
      <div class="column-header">
        <h3>${stage}</h3>
        <div class="count">0 jobs</div>
      </div>
      <div class="column-body" data-stage="${stage}"></div>
    `;

    boardElement.appendChild(column);

    // Setup drop zone
    const columnBody = column.querySelector('.column-body');
    setupDropZone(columnBody);
  });
}

// Load all jobs
async function loadJobs() {
  try {
    const response = await fetch('/api/jobs');
    jobs = await response.json();
    renderJobs();
  } catch (error) {
    console.error('Failed to load jobs:', error);
    showToast('Failed to load jobs');
  }
}

// Render all jobs
function renderJobs() {
  let boardElement, stages;

  if (currentBoard === 'quotes') {
    boardElement = quotesBoard;
    stages = quotesStages;
  } else if (currentBoard === 'production') {
    boardElement = productionBoard;
    stages = productionStages;
  } else if (currentBoard === 'milestone') {
    boardElement = milestoneBoard;
    stages = milestoneStages;
  } else {
    // Default to production if invalid board
    boardElement = productionBoard;
    stages = productionStages;
  }

  // Clear all columns in current board
  boardElement.querySelectorAll('.column-body').forEach(col => {
    col.innerHTML = '';
  });

  // Add jobs to their respective columns
  jobs.forEach(job => {
    // Skip completed jobs on production and milestone boards
    // They are shown in the dashboard instead
    if (job.stage === 'Completed') {
      return;
    }

    let targetStage = job.stage;

    // For milestone board, group stages
    if (currentBoard === 'milestone') {
      targetStage = getMilestoneStage(job);
    }

    // Only show jobs that belong to stages in current board
    if (targetStage && stages.includes(targetStage)) {
      const columnBody = boardElement.querySelector(`.column-body[data-stage="${targetStage}"]`);
      if (columnBody) {
        const card = createJobCard(job);
        columnBody.appendChild(card);
      }
    }
  });

  // Update counts
  updateCounts(boardElement, stages);
}

function createJobCard(job) {
  const card = document.createElement('div');
  card.className = 'job-card';
  card.draggable = true;
  card.dataset.jobId = job.id;

  // Check if past install date
  let isPastDue = false;
  if (job.install_date && job.stage !== 'Complete') {
    const installDate = new Date(job.install_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    installDate.setHours(0, 0, 0, 0);
    isPastDue = installDate < today;
  }

  if (isPastDue) {
    card.classList.add('past-due');
  }

  let itemsNeededHtml = '';
  if (job.items_needed) {
    itemsNeededHtml = `<div class="items-needed"><strong>Waiting:</strong> ${job.items_needed}</div>`;
  }

  let installDateHtml = '';
  if (job.install_date) {
    const date = new Date(job.install_date).toLocaleDateString();
    const alertIcon = isPastDue ? '<span class="alert-icon">⚠️</span> ' : '';
    installDateHtml = `<div class="install-date ${isPastDue ? 'past-due-date' : ''}"><strong>Install:</strong> ${alertIcon}${date}</div>`;
  }

  // Generate stage dropdown options
  const stageOptions = allStages.map(stage =>
    `<option value="${stage}" ${stage === job.stage ? 'selected' : ''}>${stage}</option>`
  ).join('');

  // Get actual paint color hex and calculate text color for badge
  const actualColor = job.job_color ? getPaintColor(job.job_color) : null;
  const textColor = actualColor ? getTextColorForBackground(actualColor) : '#181715';

  // Estimate button HTML
  let estimateButtonHtml = '';
  if (job.stage === 'Quote/Estimate') {
    if (job.estimate_number) {
      estimateButtonHtml = `
        <div class="estimate-section">
          <div class="estimate-info">Estimate #${job.estimate_number}</div>
          <button class="btn-estimate btn-download" data-job-id="${job.id}">📄 Download</button>
        </div>
      `;
    } else {
      estimateButtonHtml = `
        <div class="estimate-section">
          <button class="btn-estimate btn-generate" data-job-id="${job.id}">📝 Generate Estimate</button>
        </div>
      `;
    }
  }

  // Quote details (customer and price) - only for Quote/Estimate stage
  let quoteDetailsHtml = '';
  if (job.stage === 'Quote/Estimate') {
    const customerName = job.customer_name || 'No customer';
    const quotedPrice = job.quoted_price ? `$${parseFloat(job.quoted_price).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : 'No quote';
    const materialCost = job.material_cost ? `$${parseFloat(job.material_cost).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : '$0.00';

    quoteDetailsHtml = `
      <div class="quote-details">
        <div class="quote-detail-row"><strong>Customer:</strong> ${customerName}</div>
        <div class="quote-detail-row"><strong>Quote:</strong> ${quotedPrice}</div>
        <div class="quote-detail-row"><strong>Materials:</strong> ${materialCost}</div>
      </div>
    `;
  }

  // Completion percentage bar
  const completionPercentage = job.completion_percentage || 0;
  const completionHtml = `
    <div class="completion-bar">
      <div class="completion-label">${completionPercentage}% Complete</div>
      <div class="completion-track">
        <div class="completion-fill" style="width: ${completionPercentage}%"></div>
      </div>
    </div>
  `;

  card.innerHTML = `
    <div class="job-card-header">
      <div>
        <div class="job-name">${job.job_name}${job.job_identifier ? ` <span class="job-identifier-badge">${job.job_identifier}</span>` : ''}</div>
        ${job.job_address ? `<div class="job-address">${job.job_address}</div>` : ''}
      </div>
      ${job.job_color ? `<div class="job-color-badge" style="background-color: ${actualColor}; color: ${textColor};">${job.job_color}</div>` : ''}
    </div>
    ${quoteDetailsHtml}
    ${itemsNeededHtml}
    ${installDateHtml}
    ${completionHtml}
    ${estimateButtonHtml}
    <div class="card-stage-dropdown">
      <label>Stage:</label>
      <select class="stage-select" data-job-id="${job.id}">
        ${stageOptions}
      </select>
    </div>
  `;

  // Stage dropdown change handler
  const stageSelect = card.querySelector('.stage-select');
  stageSelect.addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent card click
  });
  stageSelect.addEventListener('change', async (e) => {
    e.stopPropagation(); // Prevent card click
    const newStage = e.target.value;
    if (newStage !== job.stage) {
      // Update locally first (optimistic update)
      job.stage = newStage;
      // Auto-update completion percentage based on stage
      job.completion_percentage = getStagePercentage(newStage);
      renderJobs();

      // Update on server
      try {
        await updateJob(job.id, job);
      } catch (error) {
        console.error('Failed to update job:', error);
        await loadJobs(); // Reload from server on error
      }
    }
  });

  // Estimate button handlers
  const generateBtn = card.querySelector('.btn-generate');
  if (generateBtn) {
    generateBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await generateEstimate(job.id);
    });
  }

  const downloadBtn = card.querySelector('.btn-download');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      downloadEstimate(job);
    });
  }

  // Drag events
  card.addEventListener('dragstart', handleDragStart);
  card.addEventListener('dragend', handleDragEnd);

  // Card click - but not when clicking dropdown or estimate buttons
  card.addEventListener('click', (e) => {
    if (!e.target.closest('.card-stage-dropdown') && !e.target.closest('.estimate-section')) {
      openEditJobModal(job);
    }
  });

  return card;
}

// Update job counts
function updateCounts(boardElement, stages) {
  stages.forEach(stage => {
    const column = boardElement.querySelector(`.kanban-column[data-stage="${stage}"]`);
    if (column) {
      let count;

      // For milestone board, count grouped stages
      if (currentBoard === 'milestone') {
        count = jobs.filter(j => getMilestoneStage(j) === stage).length;
      } else {
        count = jobs.filter(j => j.stage === stage).length;
      }

      const countEl = column.querySelector('.count');
      countEl.textContent = `${count} job${count !== 1 ? 's' : ''}`;
    }
  });
}

// Drag and Drop
let draggedCard = null;

function handleDragStart(e) {
  draggedCard = this;
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/html', this.innerHTML);
}

function handleDragEnd(e) {
  this.classList.remove('dragging');
  draggedCard = null;
}

function setupDropZone(columnBody) {
  columnBody.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    columnBody.classList.add('drag-over');
  });

  columnBody.addEventListener('dragleave', () => {
    columnBody.classList.remove('drag-over');
  });

  columnBody.addEventListener('drop', async (e) => {
    e.preventDefault();
    columnBody.classList.remove('drag-over');

    if (draggedCard) {
      const jobId = parseInt(draggedCard.dataset.jobId);
      const newStage = columnBody.dataset.stage;
      const job = jobs.find(j => j.id === jobId);

      if (job && job.stage !== newStage) {
        // Update locally first (optimistic update)
        job.stage = newStage;
        // Auto-update completion percentage based on stage
        job.completion_percentage = getStagePercentage(newStage);
        renderJobs();

        // Update on server
        try {
          await updateJob(jobId, job);
        } catch (error) {
          // Revert on error
          console.error('Failed to update job:', error);
          await loadJobs(); // Reload from server
        }
      }
    }
  });
}

// Modal functions
function openAddJobModal() {
  editingJobId = null;
  document.getElementById('modal-title').textContent = 'New Job';
  document.getElementById('delete-job-btn').style.display = 'none';
  document.getElementById('estimate-actions-btn').style.display = 'none';
  jobForm.reset();
  document.getElementById('quote-section').style.display = 'none';
  updateProfitDisplay();
  modal.classList.add('show');
}

function openQuoteModal() {
  editingJobId = null;
  document.getElementById('modal-title').textContent = 'New Quote';
  document.getElementById('delete-job-btn').style.display = 'none';
  document.getElementById('estimate-actions-btn').style.display = 'none';
  jobForm.reset();
  document.getElementById('stage').value = 'Quote/Estimate';
  document.getElementById('quote-section').style.display = 'block';

  // Clear and add one blank line item
  if (window.estimateHandler) {
    window.estimateHandler.clearLineItems();
    // Re-initialize material cost listener
    window.estimateHandler.initMaterialCostListener();
  }

  // Show estimate actions section (but job needs to be saved first)
  const estimateActionsSection = document.getElementById('estimate-actions-section');
  if (estimateActionsSection) {
    estimateActionsSection.style.display = 'block';
    // Hide the print/email buttons until estimate is generated
    document.getElementById('estimate-pdf-actions').style.display = 'none';
  }

  modal.classList.add('show');
}

function openEditJobModal(job) {
  editingJobId = job.id;
  document.getElementById('modal-title').textContent = 'Edit Job';
  document.getElementById('delete-job-btn').style.display = 'block';

  document.getElementById('job-id').value = job.id;
  document.getElementById('job-name').value = job.job_name || '';
  document.getElementById('customer-id').value = job.customer_id || '';

  // Set customer selector
  if (job.customer_id) {
    document.getElementById('customer-select').value = job.customer_id;
  }

  document.getElementById('job-address').value = job.job_address || '';
  document.getElementById('job-email').value = job.job_email || '';
  document.getElementById('job-color').value = job.job_color || '';
  document.getElementById('job-identifier').value = job.job_identifier || '';
  document.getElementById('stage').value = job.stage;
  document.getElementById('items-needed').value = job.items_needed || '';
  document.getElementById('finish-work').value = job.finish_work || '';
  document.getElementById('install-date').value = job.install_date || '';
  document.getElementById('completion-date').value = job.completion_date || '';

  // Completion percentage
  const completionPercentage = job.completion_percentage || 0;
  document.getElementById('completion-percentage').value = completionPercentage;
  document.getElementById('completion-percentage-value').textContent = completionPercentage + '%';

  // Show quote section always (for line items)
  document.getElementById('quote-section').style.display = 'block';

  // Set quoted price in input field
  const quotedPriceInput = document.getElementById('quoted-price-input');
  if (quotedPriceInput) {
    quotedPriceInput.value = job.quoted_price || '';
  }

  // Set material cost if exists
  const materialCostInput = document.getElementById('material-cost-input');
  if (materialCostInput) {
    materialCostInput.value = job.material_cost || '';
  }

  // Store quoted price for profit calculation
  const quotedPriceHidden = document.getElementById('quoted-price');
  if (quotedPriceHidden) {
    quotedPriceHidden.value = job.quoted_price || 0;
  }

  // Store material cost in hidden field for backwards compatibility
  const materialCostHidden = document.getElementById('material-cost');
  if (materialCostHidden) {
    materialCostHidden.value = job.material_cost || 0;
  }

  // Update profit display with job data
  updateProfitDisplay();

  // Load line items for this job
  if (window.estimateHandler) {
    window.estimateHandler.loadLineItems(job.id).then(() => {
      // After line items load, re-initialize material cost listener and update profit display
      window.estimateHandler.initMaterialCostListener();
    });
  }

  // Show estimate actions button (for generating/printing/emailing estimates)
  const estimateActionsBtn = document.getElementById('estimate-actions-btn');
  if (estimateActionsBtn) {
    estimateActionsBtn.style.display = 'inline-block';
  }

  // Update inline estimate actions
  if (window.inlineEstimateActions) {
    window.inlineEstimateActions.updateInlineEstimateActions(job);
  }

  // Show/hide finish work field based on stage
  const finishWorkGroup = document.getElementById('finish-work-group');
  if (job.stage === 'Installed - Finish Work' || job.stage === 'In Progress - Installed - Finish Work') {
    finishWorkGroup.style.display = 'block';
  } else {
    finishWorkGroup.style.display = 'none';
  }

  // Show and populate job pricing display if job has quoted_price or material_cost
  const pricingDisplay = document.getElementById('job-pricing-display');
  const displayQuotedPrice = document.getElementById('display-quoted-price');
  const displayMaterialCost = document.getElementById('display-material-cost');

  if (job.quoted_price || job.material_cost) {
    pricingDisplay.style.display = 'block';
    const quotedPrice = job.quoted_price ? parseFloat(job.quoted_price) : 0;
    const materialCost = job.material_cost ? parseFloat(job.material_cost) : 0;
    displayQuotedPrice.textContent = '$' + quotedPrice.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    displayMaterialCost.textContent = '$' + materialCost.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  } else {
    pricingDisplay.style.display = 'none';
  }

  modal.classList.add('show');
}

function closeModal() {
  modal.classList.remove('show');
  editingJobId = null;
  jobForm.reset();
}

// API calls
async function createJob(jobData) {
  const response = await fetch('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(jobData)
  });

  if (!response.ok) throw new Error('Failed to create job');
  return response.json();
}

async function updateJob(jobId, jobData) {
  const response = await fetch(`/api/jobs/${jobId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(jobData)
  });

  if (!response.ok) throw new Error('Failed to update job');
  return response.json();
}

async function deleteJob(jobId) {
  const response = await fetch(`/api/jobs/${jobId}`, {
    method: 'DELETE'
  });

  if (!response.ok) throw new Error('Failed to delete job');
  return response.json();
}

// Form submit
jobForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  // Get customer info
  const customerSelect = document.getElementById('customer-select');
  const customerId = customerSelect.value;

  if (!customerId) {
    showToast('Please select a customer', 'error');
    return;
  }

  // Get customer name for backwards compatibility
  const customerName = customerSelect.options[customerSelect.selectedIndex].text;

  // Calculate quoted price from line items
  const lineItems = window.estimateHandler ? window.estimateHandler.getLineItems() : [];
  const quotedPrice = window.estimateHandler ? window.estimateHandler.updateEstimateTotal() : 0;

  // Get material cost
  const materialCostInput = document.getElementById('material-cost-input');
  const materialCost = materialCostInput ? parseFloat(materialCostInput.value) || null : null;

  const jobData = {
    customer_id: parseInt(customerId),
    job_name: customerName,
    job_address: document.getElementById('job-address').value,
    job_email: document.getElementById('job-email').value,
    job_color: document.getElementById('job-color').value,
    job_identifier: document.getElementById('job-identifier').value,
    stage: document.getElementById('stage').value,
    items_needed: document.getElementById('items-needed').value,
    finish_work: document.getElementById('finish-work').value,
    install_date: document.getElementById('install-date').value,
    completion_date: document.getElementById('completion-date').value,
    material_cost: materialCost,
    quoted_price: quotedPrice,
    completion_percentage: parseInt(document.getElementById('completion-percentage').value) || 0
  };

  try {
    let jobId;

    if (editingJobId) {
      await updateJob(editingJobId, jobData);
      jobId = editingJobId;
      showToast('Job updated successfully');
    } else {
      const newJob = await createJob(jobData);
      jobId = newJob.id;
      showToast('Job created successfully');
    }

    // Save line items
    if (lineItems.length > 0 && jobId) {
      await fetch(`/api/jobs/${jobId}/estimate-items/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: lineItems })
      });
    }

    closeModal();
  } catch (error) {
    console.error('Form submission error:', error);
    showToast('Failed to save job');
  }
});

// Delete job
deleteJobBtn.addEventListener('click', async () => {
  if (!editingJobId) return;

  if (confirm('Are you sure you want to delete this job?')) {
    try {
      await deleteJob(editingJobId);
      showToast('Job deleted successfully');
      closeModal();
    } catch (error) {
      console.error('Delete error:', error);
      showToast('Failed to delete job');
    }
  }
});

// Profit margin calculation
function updateProfitDisplay() {
  const materialCost = parseFloat(document.getElementById('material-cost').value) || 0;
  const quotedPrice = parseFloat(document.getElementById('quoted-price').value) || 0;
  const profit = quotedPrice - materialCost;
  const profitPercent = quotedPrice > 0 ? (profit / quotedPrice) * 100 : 0;

  const profitDisplay = document.getElementById('profit-display');
  const profitValue = document.getElementById('profit-value');
  const profitPercentEl = document.getElementById('profit-percent');
  const profitQuoted = document.getElementById('profit-quoted');
  const profitCost = document.getElementById('profit-cost');

  // Update profit display values
  profitValue.textContent = '$' + profit.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  profitPercentEl.textContent = '(' + profitPercent.toFixed(1) + '%)';

  // Update quoted price and material cost display in profit section
  if (profitQuoted) {
    profitQuoted.textContent = '$' + quotedPrice.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  }
  if (profitCost) {
    profitCost.textContent = '$' + materialCost.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  }

  if (profit < 0) {
    profitDisplay.classList.add('negative');
  } else {
    profitDisplay.classList.remove('negative');
  }
}

// Event listeners
function setupEventListeners() {
  newQuoteBtn.addEventListener('click', openQuoteModal);

  // Quote field listeners for profit calculation
  document.getElementById('material-cost').addEventListener('input', updateProfitDisplay);
  document.getElementById('quoted-price').addEventListener('input', updateProfitDisplay);

  // Quoted price input listener (updates hidden field and profit display)
  const quotedPriceInput = document.getElementById('quoted-price-input');
  if (quotedPriceInput) {
    quotedPriceInput.addEventListener('input', function() {
      // Update hidden field
      document.getElementById('quoted-price').value = this.value || 0;
      // Update profit display
      updateProfitDisplay();
    });
  }

  // Material cost input listener (updates hidden field and profit display)
  const materialCostInput = document.getElementById('material-cost-input');
  if (materialCostInput) {
    materialCostInput.addEventListener('input', function() {
      // Update hidden field
      document.getElementById('material-cost').value = this.value || 0;
      // Update profit display
      updateProfitDisplay();
    });
  }

  // Completion percentage slider listener
  document.getElementById('completion-percentage').addEventListener('input', (e) => {
    document.getElementById('completion-percentage-value').textContent = e.target.value + '%';
  });

  // Stage change listener to show/hide finish work field and quote section
  document.getElementById('stage').addEventListener('change', (e) => {
    const finishWorkGroup = document.getElementById('finish-work-group');
    const quoteSection = document.getElementById('quote-section');

    if (e.target.value === 'Installed - Finish Work') {
      finishWorkGroup.style.display = 'block';
    } else {
      finishWorkGroup.style.display = 'none';
    }

    // Show quote section for Quote/Estimate stage
    if (e.target.value === 'Quote/Estimate') {
      quoteSection.style.display = 'block';
    }
  });

  // Close modal
  document.querySelectorAll('.close-modal, .cancel-btn').forEach(btn => {
    btn.addEventListener('click', closeModal);
  });

  // Close modal on outside click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });
}

// Socket.IO listeners for real-time updates
function setupSocketListeners() {
  socket.on('job-created', (job) => {
    jobs.push(job); // Add new job at end to maintain ASC order (oldest first)
    renderJobs();
    showToast(`New job added: ${job.job_name}`);
  });

  socket.on('job-updated', (data) => {
    const { job, movedBy } = data;
    const index = jobs.findIndex(j => j.id === job.id);
    if (index !== -1) {
      jobs[index] = job;
      renderJobs();
      showToast(`${movedBy} moved "${job.job_name}" to ${job.stage}`);
    }
  });

  socket.on('job-deleted', (data) => {
    jobs = jobs.filter(j => j.id !== data.jobId);
    renderJobs();
    showToast('Job deleted');
  });

  socket.on('connect', () => {
    console.log('Connected to server');
  });

  socket.on('disconnect', () => {
    console.log('Disconnected from server');
    showToast('Connection lost. Reconnecting...');
  });

  socket.on('reconnect', () => {
    console.log('Reconnected to server');
    showToast('Reconnected!');
    loadJobs(); // Reload data after reconnection
  });
}

// Toast notification
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');

  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// ========== ADMIN PANEL FUNCTIONS ==========

function setupAdminPanel() {
  const adminBtn = document.getElementById('admin-btn');
  const adminModal = document.getElementById('admin-modal');
  const editUserModal = document.getElementById('edit-user-modal');
  const closeAdminModal = document.getElementById('close-admin-modal');
  const closeEditUserModal = document.getElementById('close-edit-user-modal');
  const cancelEditUser = document.getElementById('cancel-edit-user');
  const addUserForm = document.getElementById('add-user-form');
  const editUserForm = document.getElementById('edit-user-form');
  const deleteUserBtn = document.getElementById('delete-user-btn');

  // Open admin panel
  adminBtn.addEventListener('click', () => {
    adminModal.style.display = 'flex';
    loadUsers();
  });

  // Close admin panel
  closeAdminModal.addEventListener('click', () => {
    adminModal.style.display = 'none';
  });

  // Close edit user modal
  closeEditUserModal.addEventListener('click', () => {
    editUserModal.style.display = 'none';
  });

  cancelEditUser.addEventListener('click', () => {
    editUserModal.style.display = 'none';
  });

  // Add user form submission
  addUserForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('new-username').value;
    const password = document.getElementById('new-password').value;
    const fullName = document.getElementById('new-fullname').value;
    const role = document.getElementById('new-role').value;

    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, full_name: fullName, role })
      });

      if (response.ok) {
        showToast('User added successfully');
        addUserForm.reset();
        loadUsers();
      } else {
        const error = await response.json();
        showToast(error.error || 'Failed to add user');
      }
    } catch (error) {
      console.error('Error adding user:', error);
      showToast('Failed to add user');
    }
  });

  // Edit user form submission
  editUserForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const userId = document.getElementById('edit-user-id').value;
    const fullName = document.getElementById('edit-fullname').value;
    const role = document.getElementById('edit-role').value;
    const password = document.getElementById('edit-password').value;

    const updateData = { full_name: fullName, role };
    if (password) {
      updateData.password = password;
    }

    try {
      const response = await fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      });

      if (response.ok) {
        showToast('User updated successfully');
        editUserModal.style.display = 'none';
        loadUsers();
      } else {
        const error = await response.json();
        showToast(error.error || 'Failed to update user');
      }
    } catch (error) {
      console.error('Error updating user:', error);
      showToast('Failed to update user');
    }
  });

  // Delete user
  deleteUserBtn.addEventListener('click', async () => {
    const userId = document.getElementById('edit-user-id').value;
    const username = document.getElementById('edit-username').value;

    if (!confirm(`Are you sure you want to delete user "${username}"?`)) {
      return;
    }

    try {
      const response = await fetch(`/api/users/${userId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        showToast('User deleted successfully');
        editUserModal.style.display = 'none';
        loadUsers();
      } else {
        const error = await response.json();
        showToast(error.error || 'Failed to delete user');
      }
    } catch (error) {
      console.error('Error deleting user:', error);
      showToast('Failed to delete user');
    }
  });
}

async function loadUsers() {
  try {
    const response = await fetch('/api/users');
    if (!response.ok) {
      throw new Error('Failed to load users');
    }

    const users = await response.json();
    const usersList = document.getElementById('users-list');
    usersList.innerHTML = '';

    users.forEach(user => {
      const row = document.createElement('tr');

      const roleLabel = user.role === 'admin' ? 'Administrator' :
                        user.role === 'job-floor' ? 'Job Floor' : 'Employee';

      row.innerHTML = `
        <td>${user.username}</td>
        <td>${user.full_name}</td>
        <td>${roleLabel}</td>
        <td>
          <button class="btn btn-small btn-primary edit-user-btn" data-user-id="${user.id}">Edit</button>
        </td>
      `;

      usersList.appendChild(row);
    });

    // Add event listeners to edit buttons
    document.querySelectorAll('.edit-user-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const userId = e.target.dataset.userId;
        openEditUserModal(users.find(u => u.id == userId));
      });
    });
  } catch (error) {
    console.error('Error loading users:', error);
    showToast('Failed to load users');
  }
}

function openEditUserModal(user) {
  const editUserModal = document.getElementById('edit-user-modal');
  document.getElementById('edit-user-id').value = user.id;
  document.getElementById('edit-username').value = user.username;
  document.getElementById('edit-fullname').value = user.full_name;
  document.getElementById('edit-role').value = user.role;
  document.getElementById('edit-password').value = '';

  editUserModal.style.display = 'flex';
}

// Initialize app
init();

// ========== MOBILE/TABLET REFRESH FIX (ALL DEVICES) ==========
let lastRefresh = 0;
const REFRESH_COOLDOWN = 2000;

function refreshIfNeeded() {
  const now = Date.now();
  if (currentUser && (now - lastRefresh) > REFRESH_COOLDOWN) {
    lastRefresh = now;
    console.log("Refreshing data...");
    loadJobs();
    if (!socket.connected) {
      socket.connect();
    }
  }
}

// Generate estimate PDF
async function generateEstimate(jobId) {
  try {
    showToast('Generating estimate...', 'info');

    const response = await fetch(`/api/jobs/${jobId}/generate-estimate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error('Failed to generate estimate');
    }

    const data = await response.json();

    showToast(`Estimate ${data.estimateNumber} generated successfully!`, 'success');

    // Reload jobs to show updated estimate info
    await loadJobs();

    // Automatically download the PDF
    window.open(data.pdfUrl, '_blank');

  } catch (error) {
    console.error('Error generating estimate:', error);
    showToast('Failed to generate estimate', 'error');
  }
}

// Download existing estimate PDF
function downloadEstimate(job) {
  if (job.estimate_pdf_path) {
    window.open(`/estimates/${job.estimate_pdf_path}`, '_blank');
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshIfNeeded();
});

window.addEventListener("pageshow", (event) => {
  if (event.persisted) refreshIfNeeded();
});

window.addEventListener("focus", () => refreshIfNeeded());

window.addEventListener("online", () => {
  if (currentUser) {
    showToast("Back online - refreshing...");
    refreshIfNeeded();
  }
});

let lastInteraction = Date.now();
document.addEventListener("touchstart", () => {
  const now = Date.now();
  if ((now - lastInteraction) > 30000) refreshIfNeeded();
  lastInteraction = now;
}, { passive: true });

setInterval(() => {
  if (currentUser && !socket.connected) socket.connect();
}, 10000);

// ========== KIOSK MODE ==========
const urlParams = new URLSearchParams(window.location.search);
const isKioskMode = window.KIOSK_MODE || urlParams.get("kiosk") === "1";

if (isKioskMode) {
  document.addEventListener("DOMContentLoaded", () => {
    // Add kiosk class to body for CSS styling
    document.body.classList.add("kiosk-mode");
    
    // Hide header buttons (new quote, admin, logout)
    const newQuoteBtn = document.getElementById("new-quote-btn");
    const adminBtn = document.getElementById("admin-btn");
    const logoutBtn = document.getElementById("logout-btn");
    if (newQuoteBtn) newQuoteBtn.style.display = "none";
    if (adminBtn) adminBtn.style.display = "none";
    if (logoutBtn) logoutBtn.style.display = "none";
    
    // Hide tabs except Whiteboard and Production
    document.querySelectorAll(".board-tab").forEach(tab => {
      const board = tab.dataset.board;
      if (board !== "whiteboard") {
        tab.style.display = "none";
      }
    });
    
    // Click whiteboard tab to make it default
    setTimeout(() => {
      const whiteboardTab = document.querySelector(".board-tab[data-board=\"whiteboard\"]");
      if (whiteboardTab) whiteboardTab.click();
    }, 500);
    
    // Disable all interactions
    document.body.style.pointerEvents = "none";
    // But allow tab switching
    document.querySelector(".board-switcher").style.pointerEvents = "auto";
    
    // Auto-refresh every 30 seconds
    setInterval(() => {
      if (typeof loadJobs === "function") {
        loadJobs();
      }
    }, 30000);
  });
}
