// Socket.IO connection
const socket = io();

// State
let currentUser = null;
let jobs = [];
let editingJobId = null;
let currentBoard = 'kanban'; // kanban, whiteboard, production, milestone

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

// Kanban board excludes "Completed" stage
const kanbanStages = [
  'Quote/Estimate',
  'In Progress - Ready to Cut',
  'In Progress - Cut',
  'In Progress - Paint & Sand',
  'In Progress - Assemble',
  'In Progress - Ready to Install',
  'In Progress - Installed',
  'In Progress - Installed - Finish Work'
];

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
  if (job.stage.startsWith('Ready to Install') || job.stage.startsWith('Installed')) return 'Installed';
  if (job.stage === 'Completed') return 'Completed';
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
const addJobBtn = document.getElementById('add-job-btn');
const newQuoteBtn = document.getElementById('new-quote-btn');
const logoutBtn = document.getElementById('logout-btn');
const modal = document.getElementById('job-modal');
const jobForm = document.getElementById('job-form');
const deleteJobBtn = document.getElementById('delete-job-btn');
const toast = document.getElementById('toast');

// Board elements
const kanbanBoard = document.getElementById('kanban-board');
const productionBoard = document.getElementById('production-board');
const milestoneBoard = document.getElementById('milestone-board');
const whiteboardBody = document.getElementById('whiteboard-body');
const invoicedBody = document.getElementById('invoiced-body');

// Initialize
async function init() {
  await checkAuth();
  if (currentUser) {
    setupBoardSwitcher();
    createKanbanBoard();
    createProductionBoard();
    createMilestoneBoard();
    await loadJobs();
    setupEventListeners();
    setupSocketListeners();

    // Hide invoiced and completed tabs for job-floor role
    if (currentUser.role === 'job-floor') {
      const invoicedTab = document.querySelector('.invoiced-tab');
      if (invoicedTab) {
        invoicedTab.style.display = 'none';
      }
      const completedTab = document.querySelector('.completed-tab');
      if (completedTab) {
        completedTab.style.display = 'none';
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
  document.getElementById('kanban-view').style.display = 'none';
  document.getElementById('whiteboard-view').style.display = 'none';
  document.getElementById('production-view').style.display = 'none';
  document.getElementById('milestone-view').style.display = 'none';
  document.getElementById('completed-view').style.display = 'none';
  document.getElementById('invoiced-view').style.display = 'none';

  // Show selected board
  document.getElementById(`${boardType}-view`).style.display = 'block';

  // Render appropriate view
  if (boardType === 'whiteboard') {
    renderWhiteboardView();
  } else if (boardType === 'completed') {
    renderCompletedView();
  } else if (boardType === 'invoiced') {
    renderInvoicedView();
  } else {
    renderJobs();
  }
}

// Create Kanban Board Structure
function createKanbanBoard() {
  kanbanBoard.innerHTML = '';
  createBoardColumns(kanbanBoard, kanbanStages);
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
  if (currentBoard === 'whiteboard') {
    renderWhiteboardView();
    return;
  }

  let boardElement, stages;

  switch(currentBoard) {
    case 'production':
      boardElement = productionBoard;
      stages = productionStages;
      break;
    case 'milestone':
      boardElement = milestoneBoard;
      stages = milestoneStages;
      break;
    default:
      boardElement = kanbanBoard;
      stages = allStages;
  }

  // Clear all columns in current board
  boardElement.querySelectorAll('.column-body').forEach(col => {
    col.innerHTML = '';
  });

  // Add jobs to their respective columns
  jobs.forEach(job => {
    // Skip completed jobs on Kanban, Production, and Milestone boards
    // They become historical data and only show in Whiteboard/Invoiced views
    if (job.stage === 'Completed' && ['kanban', 'production', 'milestone'].includes(currentBoard)) {
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

// Render Whiteboard View
function renderWhiteboardView() {
  whiteboardBody.innerHTML = '';

  jobs.forEach(job => {
    // Skip completed jobs - they show in Completed Jobs tab
    if (job.stage === 'Completed') return;

    const row = document.createElement('tr');
    row.dataset.jobId = job.id;

    const installDate = job.install_date || '';
    const completionDate = job.completion_date ? new Date(job.completion_date).toLocaleDateString() : '-';

    // Check if past install date
    let isPastDue = false;
    if (job.install_date && job.stage !== 'Completed') {
      const installDateObj = new Date(job.install_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      installDateObj.setHours(0, 0, 0, 0);
      isPastDue = installDateObj < today;
    }

    if (isPastDue) {
      row.classList.add('past-due-row');
    }

    // Generate stage dropdown options
    const stageOptions = allStages.map(stage =>
      `<option value="${stage}" ${stage === job.stage ? 'selected' : ''}>${stage}</option>`
    ).join('');

    // Check if job is in "In Progress" stage to highlight items needed
    const isInProgress = job.stage && job.stage.startsWith('In Progress');
    const itemsClass = isInProgress ? 'whiteboard-items-input in-progress-highlight' : 'whiteboard-items-input';
    const itemsPlaceholder = isInProgress ? 'What are we waiting on?' : 'Items needed...';

    // Get actual paint color hex and calculate text color for badge
    const actualColor = job.job_color ? getPaintColor(job.job_color) : null;
    const textColor = actualColor ? getTextColorForBackground(actualColor) : '#181715';

    row.innerHTML = `
      <td class="whiteboard-name" data-job-id="${job.id}">${job.job_name}</td>
      <td>${job.job_address || '-'}</td>
      <td>${job.job_color ? `<span class="whiteboard-color-badge" style="background-color: ${actualColor}; color: ${textColor};">${job.job_color}</span>` : '-'}</td>
      <td class="whiteboard-stage-cell">
        <select class="whiteboard-stage-select" data-job-id="${job.id}">
          ${stageOptions}
        </select>
      </td>
      <td class="whiteboard-items-cell ${isInProgress ? 'in-progress-cell' : ''}">
        <input type="text" class="${itemsClass}" data-job-id="${job.id}" value="${job.items_needed || ''}" placeholder="${itemsPlaceholder}">
      </td>
      <td class="whiteboard-date-cell ${isPastDue ? 'past-due-cell' : ''}">
        ${isPastDue ? '<span class="alert-icon">⚠️</span>' : ''}
        <input type="date" class="whiteboard-date-input ${isPastDue ? 'past-due-input' : ''}" data-job-id="${job.id}" data-field="install_date" value="${installDate}">
      </td>
    `;

    whiteboardBody.appendChild(row);

    // Add event listeners for inline editing
    const stageSelect = row.querySelector('.whiteboard-stage-select');
    const itemsInput = row.querySelector('.whiteboard-items-input');
    const installDateInput = row.querySelector('.whiteboard-date-input');

    // Stage dropdown handler
    stageSelect.addEventListener('click', (e) => e.stopPropagation());
    stageSelect.addEventListener('change', async (e) => {
      e.stopPropagation();
      const newStage = e.target.value;
      if (newStage !== job.stage) {
        job.stage = newStage;

        // Auto-populate completion date if stage is "Completed"
        if (newStage === 'Completed' && !job.completion_date) {
          const today = new Date().toISOString().split('T')[0];
          job.completion_date = today;
        }

        try {
          await updateJob(job.id, job);
          renderWhiteboardView(); // Re-render to show updated completion date
        } catch (error) {
          console.error('Failed to update job:', error);
          await loadJobs();
        }
      }
    });

    // Items needed input handler
    itemsInput.addEventListener('click', (e) => e.stopPropagation());
    itemsInput.addEventListener('blur', async (e) => {
      const newValue = e.target.value;
      if (newValue !== job.items_needed) {
        job.items_needed = newValue;
        try {
          await updateJob(job.id, job);
        } catch (error) {
          console.error('Failed to update job:', error);
          await loadJobs();
        }
      }
    });

    // Install date input handler
    installDateInput.addEventListener('click', (e) => e.stopPropagation());
    installDateInput.addEventListener('change', async (e) => {
      e.stopPropagation();
      const newDate = e.target.value;
      if (newDate !== job.install_date) {
        job.install_date = newDate;
        try {
          await updateJob(job.id, job);
        } catch (error) {
          console.error('Failed to update job:', error);
          await loadJobs();
        }
      }
    });

    // Name cell click - open modal
    const nameCell = row.querySelector('.whiteboard-name');
    nameCell.style.cursor = 'pointer';
    nameCell.addEventListener('click', () => openEditJobModal(job));
  });
}

// Render Invoiced View
function renderInvoicedView() {
  invoicedBody.innerHTML = '';

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

    // Format amounts as currency
    const formatAmount = (amt) => amt ? `$${parseFloat(amt).toFixed(2)}` : '';

    row.innerHTML = `
      <td class="whiteboard-name" data-job-id="${job.id}">${job.job_name}</td>
      <td>${job.job_address || '-'}</td>
      <td class="whiteboard-email">${job.job_email || '-'}</td>
      <td class="whiteboard-stage-cell">
        <select class="whiteboard-stage-select" data-job-id="${job.id}">
          ${stageOptionsHTML}
        </select>
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

    invoicedBody.appendChild(row);

    // Add event listeners
    const stageSelect = row.querySelector('.whiteboard-stage-select');
    const invoiceTypeSelect = row.querySelector('.invoice-type-select');
    const invoiceInputs = row.querySelectorAll('.whiteboard-invoice-input');
    const amountInputs = row.querySelectorAll('.invoice-amount-input');

    // Stage dropdown handler
    stageSelect.addEventListener('click', (e) => e.stopPropagation());
    stageSelect.addEventListener('change', async (e) => {
      e.stopPropagation();
      const newStage = e.target.value;
      if (newStage !== job.stage) {
        job.stage = newStage;

        // Auto-populate completion date if stage is "Completed"
        if (newStage === 'Completed' && !job.completion_date) {
          const today = new Date().toISOString().split('T')[0];
          job.completion_date = today;
        }

        try {
          await updateJob(job.id, job);
          renderInvoicedView(); // Re-render
        } catch (error) {
          console.error('Failed to update job:', error);
          await loadJobs();
        }
      }
    });

    // Invoice type toggle handler
    invoiceTypeSelect.addEventListener('click', (e) => e.stopPropagation());
    invoiceTypeSelect.addEventListener('change', async (e) => {
      e.stopPropagation();
      const isSingle = e.target.value === 'single';
      job.single_invoice_mode = isSingle ? 1 : 0;

      // Clear 1st invoice (deposit) fields if switching to single (uses complete invoice only)
      if (isSingle) {
        job.first_invoice_amount = null;
        job.first_invoice_sent = null;
        job.first_invoice_paid = null;
      }

      try {
        await updateJob(job.id, job);
        renderInvoicedView(); // Re-render to update disabled state
      } catch (error) {
        console.error('Failed to update job:', error);
        await loadJobs();
      }
    });

    // Invoice date input handlers
    invoiceInputs.forEach(input => {
      input.addEventListener('click', (e) => e.stopPropagation());
      input.addEventListener('change', async (e) => {
        e.stopPropagation();
        const field = e.target.dataset.field;
        const newDate = e.target.value;
        if (newDate !== job[field]) {
          job[field] = newDate;
          try {
            await updateJob(job.id, job);
          } catch (error) {
            console.error('Failed to update job:', error);
            await loadJobs();
          }
        }
      });
    });

    // Invoice amount input handlers
    amountInputs.forEach(input => {
      input.addEventListener('click', (e) => e.stopPropagation());
      input.addEventListener('change', async (e) => {
        e.stopPropagation();
        const field = e.target.dataset.field;
        const newAmount = e.target.value ? parseFloat(e.target.value) : null;
        if (newAmount !== job[field]) {
          job[field] = newAmount;
          try {
            await updateJob(job.id, job);
          } catch (error) {
            console.error('Failed to update job:', error);
            await loadJobs();
          }
        }
      });
    });

    // Mark Paid button handlers
    const markPaidBtns = row.querySelectorAll('.mark-paid-btn');
    markPaidBtns.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const invoice = e.target.dataset.invoice;
        const paidField = invoice === 'first' ? 'first_invoice_paid' : 'second_invoice_paid';

        // Toggle: if already paid, clear the date; otherwise set to today
        if (job[paidField]) {
          job[paidField] = null;
        } else {
          const today = new Date().toISOString().split('T')[0];
          job[paidField] = today;
        }

        try {
          await updateJob(job.id, job);
          renderInvoicedView();
        } catch (error) {
          console.error('Failed to update job:', error);
          await loadJobs();
        }
      });
    });

    // Name cell click - open modal
    const nameCell = row.querySelector('.whiteboard-name');
    nameCell.style.cursor = 'pointer';
    nameCell.addEventListener('click', () => openEditJobModal(job));
  });
}

// Render Completed Jobs View
function renderCompletedView() {
  const completedBody = document.getElementById('completed-body');
  completedBody.innerHTML = '';

  // Filter only completed jobs
  const completedJobs = jobs.filter(job => job.stage === 'Completed');

  // Sort by completion date (most recent first)
  completedJobs.sort((a, b) => {
    const dateA = a.completion_date ? new Date(a.completion_date) : new Date(0);
    const dateB = b.completion_date ? new Date(b.completion_date) : new Date(0);
    return dateB - dateA;
  });

  // Calculate sales totals
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday
  startOfWeek.setHours(0, 0, 0, 0);

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  let salesWeek = 0, salesMonth = 0, salesYear = 0, salesTotal = 0;
  let countWeek = 0, countMonth = 0, countYear = 0, countTotal = 0;
  let totalInvoiced = 0, totalPaid = 0;

  completedJobs.forEach(job => {
    const row = document.createElement('tr');
    row.dataset.jobId = job.id;

    const installDate = job.install_date ? new Date(job.install_date).toLocaleDateString() : '-';
    const completionDate = job.completion_date ? new Date(job.completion_date).toLocaleDateString() : '-';

    // Calculate job total (both invoices)
    const firstAmt = parseFloat(job.first_invoice_amount) || 0;
    const secondAmt = parseFloat(job.second_invoice_amount) || 0;
    const jobTotal = firstAmt + secondAmt;

    // Track invoiced vs paid
    totalInvoiced += jobTotal;
    if (job.first_invoice_paid) totalPaid += firstAmt;
    if (job.second_invoice_paid) totalPaid += secondAmt;

    // Track sales by date
    if (job.completion_date) {
      const compDate = new Date(job.completion_date);

      salesTotal += jobTotal;
      countTotal++;

      if (compDate >= startOfYear) {
        salesYear += jobTotal;
        countYear++;
      }
      if (compDate >= startOfMonth) {
        salesMonth += jobTotal;
        countMonth++;
      }
      if (compDate >= startOfWeek) {
        salesWeek += jobTotal;
        countWeek++;
      }
    } else {
      // No completion date, still count in total
      salesTotal += jobTotal;
      countTotal++;
    }

    // Get actual paint color hex and calculate text color for badge
    const actualColor = job.job_color ? getPaintColor(job.job_color) : null;
    const textColor = actualColor ? getTextColorForBackground(actualColor) : '#181715';

    row.innerHTML = `
      <td class="whiteboard-name" data-job-id="${job.id}">${job.job_name}</td>
      <td>${job.job_address || '-'}</td>
      <td>${job.job_color ? `<span class="whiteboard-color-badge" style="background-color: ${actualColor}; color: ${textColor};">${job.job_color}</span>` : '-'}</td>
      <td class="sales-total-cell">${jobTotal > 0 ? '$' + jobTotal.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '-'}</td>
      <td class="whiteboard-date">${installDate}</td>
      <td class="whiteboard-date">${completionDate}</td>
    `;

    completedBody.appendChild(row);

    // Click to view/edit
    const nameCell = row.querySelector('.whiteboard-name');
    nameCell.style.cursor = 'pointer';
    nameCell.addEventListener('click', () => openEditJobModal(job));
  });

  // Update sales summary
  const formatCurrency = (amt) => '$' + amt.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const formatCurrencyShort = (amt) => {
    if (amt >= 1000000) return '$' + (amt / 1000000).toFixed(1) + 'M';
    if (amt >= 1000) return '$' + (amt / 1000).toFixed(1) + 'K';
    return '$' + amt.toFixed(0);
  };

  document.getElementById('sales-week').textContent = formatCurrency(salesWeek);
  document.getElementById('sales-week-count').textContent = `${countWeek} job${countWeek !== 1 ? 's' : ''}`;

  document.getElementById('sales-month').textContent = formatCurrency(salesMonth);
  document.getElementById('sales-month-count').textContent = `${countMonth} job${countMonth !== 1 ? 's' : ''}`;

  document.getElementById('sales-year').textContent = formatCurrency(salesYear);
  document.getElementById('sales-year-count').textContent = `${countYear} job${countYear !== 1 ? 's' : ''}`;

  document.getElementById('sales-total').textContent = formatCurrency(salesTotal);
  document.getElementById('sales-total-count').textContent = `${countTotal} job${countTotal !== 1 ? 's' : ''}`;

  // Update pie chart legend
  const totalUnpaid = totalInvoiced - totalPaid;
  document.getElementById('legend-invoiced').textContent = formatCurrency(totalInvoiced);
  document.getElementById('legend-paid').textContent = formatCurrency(totalPaid);
  document.getElementById('legend-unpaid').textContent = formatCurrency(totalUnpaid);
  document.getElementById('chart-total').textContent = formatCurrencyShort(totalInvoiced);

  // Draw pie chart
  drawSalesPieChart(totalInvoiced, totalPaid);
}

// Draw sales pie chart
function drawSalesPieChart(invoiced, paid) {
  const canvas = document.getElementById('sales-pie-chart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const radius = Math.min(centerX, centerY) - 10;
  const innerRadius = radius * 0.6; // Donut hole

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // If no data, draw empty state
  if (invoiced === 0) {
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.arc(centerX, centerY, innerRadius, 0, 2 * Math.PI, true);
    ctx.fillStyle = '#3a3a38';
    ctx.fill();
    return;
  }

  const unpaid = invoiced - paid;
  const paidAngle = (paid / invoiced) * 2 * Math.PI;
  const unpaidAngle = (unpaid / invoiced) * 2 * Math.PI;

  // Draw paid slice (green)
  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  ctx.arc(centerX, centerY, radius, -Math.PI / 2, -Math.PI / 2 + paidAngle);
  ctx.closePath();
  ctx.fillStyle = '#4caf50';
  ctx.fill();

  // Draw unpaid/invoiced slice (amber/orange)
  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  ctx.arc(centerX, centerY, radius, -Math.PI / 2 + paidAngle, -Math.PI / 2 + paidAngle + unpaidAngle);
  ctx.closePath();
  ctx.fillStyle = '#ff9800';
  ctx.fill();

  // Draw inner circle (donut hole)
  ctx.beginPath();
  ctx.arc(centerX, centerY, innerRadius, 0, 2 * Math.PI);
  ctx.fillStyle = '#242422';
  ctx.fill();
}

// Create job card element
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

  card.innerHTML = `
    <div class="job-card-header">
      <div>
        <div class="job-name">${job.job_name}</div>
        ${job.job_address ? `<div class="job-address">${job.job_address}</div>` : ''}
      </div>
      ${job.job_color ? `<div class="job-color-badge" style="background-color: ${actualColor}; color: ${textColor};">${job.job_color}</div>` : ''}
    </div>
    ${itemsNeededHtml}
    ${installDateHtml}
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

  // Drag events
  card.addEventListener('dragstart', handleDragStart);
  card.addEventListener('dragend', handleDragEnd);

  // Card click - but not when clicking dropdown
  card.addEventListener('click', (e) => {
    if (!e.target.closest('.card-stage-dropdown')) {
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
  jobForm.reset();
  document.getElementById('quote-section').style.display = 'none';
  updateProfitDisplay();
  modal.classList.add('show');
}

function openQuoteModal() {
  editingJobId = null;
  document.getElementById('modal-title').textContent = 'New Quote';
  document.getElementById('delete-job-btn').style.display = 'none';
  jobForm.reset();
  document.getElementById('stage').value = 'Quote/Estimate';
  document.getElementById('quote-section').style.display = 'block';
  updateProfitDisplay();
  modal.classList.add('show');
}

function openEditJobModal(job) {
  editingJobId = job.id;
  document.getElementById('modal-title').textContent = 'Edit Job';
  document.getElementById('delete-job-btn').style.display = 'block';

  document.getElementById('job-id').value = job.id;
  document.getElementById('job-name').value = job.job_name;
  document.getElementById('job-address').value = job.job_address || '';
  document.getElementById('job-email').value = job.job_email || '';
  document.getElementById('job-color').value = job.job_color || '';
  document.getElementById('stage').value = job.stage;
  document.getElementById('items-needed').value = job.items_needed || '';
  document.getElementById('finish-work').value = job.finish_work || '';
  document.getElementById('install-date').value = job.install_date || '';
  document.getElementById('completion-date').value = job.completion_date || '';

  // Quote fields
  document.getElementById('material-cost').value = job.material_cost || '';
  document.getElementById('quoted-price').value = job.quoted_price || '';

  // Show quote section if has quote data or is Quote/Estimate stage
  const quoteSection = document.getElementById('quote-section');
  if (job.stage === 'Quote/Estimate' || job.material_cost || job.quoted_price) {
    quoteSection.style.display = 'block';
  } else {
    quoteSection.style.display = 'none';
  }
  updateProfitDisplay();

  // Show/hide finish work field based on stage
  const finishWorkGroup = document.getElementById('finish-work-group');
  if (job.stage === 'Installed - Finish Work') {
    finishWorkGroup.style.display = 'block';
  } else {
    finishWorkGroup.style.display = 'none';
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

  const jobData = {
    job_name: document.getElementById('job-name').value,
    job_address: document.getElementById('job-address').value,
    job_email: document.getElementById('job-email').value,
    job_color: document.getElementById('job-color').value,
    stage: document.getElementById('stage').value,
    items_needed: document.getElementById('items-needed').value,
    finish_work: document.getElementById('finish-work').value,
    install_date: document.getElementById('install-date').value,
    completion_date: document.getElementById('completion-date').value,
    material_cost: parseFloat(document.getElementById('material-cost').value) || null,
    quoted_price: parseFloat(document.getElementById('quoted-price').value) || null
  };

  try {
    if (editingJobId) {
      await updateJob(editingJobId, jobData);
      showToast('Job updated successfully');
    } else {
      await createJob(jobData);
      showToast('Job created successfully');
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

  profitValue.textContent = '$' + profit.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  profitPercentEl.textContent = '(' + profitPercent.toFixed(1) + '%)';

  if (profit < 0) {
    profitDisplay.classList.add('negative');
  } else {
    profitDisplay.classList.remove('negative');
  }
}

// Event listeners
function setupEventListeners() {
  addJobBtn.addEventListener('click', openAddJobModal);
  newQuoteBtn.addEventListener('click', openQuoteModal);

  // Quote field listeners for profit calculation
  document.getElementById('material-cost').addEventListener('input', updateProfitDisplay);
  document.getElementById('quoted-price').addEventListener('input', updateProfitDisplay);

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
    
    // Hide header buttons (add job, admin, logout)
    const addJobBtn = document.getElementById("add-job-btn");
    const adminBtn = document.getElementById("admin-btn");
    const logoutBtn = document.getElementById("logout-btn");
    if (addJobBtn) addJobBtn.style.display = "none";
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
