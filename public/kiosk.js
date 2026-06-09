// Socket.IO connection for real-time updates
const socket = io();

// State
let jobs = [];

// Production stages for kiosk (same as main app)
const productionStages = [
  'In Progress - Ready to Cut',
  'In Progress - Cut',
  'In Progress - Paint & Sand',
  'In Progress - Assemble',
  'In Progress - Ready to Install',
  'In Progress - Installed',
  'In Progress - Installed - Finish Work'
];

// Helper function to get actual color value from paint name or hex
function getPaintColor(colorInput) {
  if (!colorInput) return null;
  
  // If it starts with # or rgb, it's already a valid CSS color
  if (colorInput.startsWith('#') || colorInput.startsWith('rgb')) {
    return colorInput;
  }
  
  // Strip SW color codes like "SW 7048 - " or "SW7048 - "
  let cleanedInput = colorInput.trim();
  cleanedInput = cleanedInput.replace(/^SW\s*\d+\s*-?\s*/i, '');
  
  // Look up paint color name (case-insensitive)
  const lookup = cleanedInput.toLowerCase().trim();
  return paintColors[lookup] || colorInput; // Return original if not found
}

// Helper function to determine text color based on background
function getTextColorForBackground(bgColor) {
  if (!bgColor) return '#181715';
  
  const temp = document.createElement('div');
  temp.style.backgroundColor = bgColor;
  temp.style.display = 'none';
  document.body.appendChild(temp);
  const computed = window.getComputedStyle(temp).backgroundColor;
  document.body.removeChild(temp);
  
  const rgb = computed.match(/\d+/g);
  if (!rgb || rgb.length < 3) return '#181715';
  
  const r = parseInt(rgb[0]);
  const g = parseInt(rgb[1]);
  const b = parseInt(rgb[2]);
  
  const rsRGB = r / 255;
  const gsRGB = g / 255;
  const bsRGB = b / 255;
  
  const rLinear = rsRGB <= 0.03928 ? rsRGB / 12.92 : Math.pow((rsRGB + 0.055) / 1.055, 2.4);
  const gLinear = gsRGB <= 0.03928 ? gsRGB / 12.92 : Math.pow((gsRGB + 0.055) / 1.055, 2.4);
  const bLinear = bsRGB <= 0.03928 ? bsRGB / 12.92 : Math.pow((bsRGB + 0.055) / 1.055, 2.4);
  
  const luminance = 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;
  
  return luminance > 0.179 ? '#181715' : '#F8F6F3';
}

// Update time display
function updateTime() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit',
    hour12: true 
  });
  const dateStr = now.toLocaleDateString('en-US', { 
    weekday: 'long', 
    month: 'long', 
    day: 'numeric',
    year: 'numeric'
  });
  document.getElementById('kiosk-time').innerHTML = `${dateStr} - ${timeStr}`;
}

// Load jobs from API
async function loadJobs() {
  try {
    const response = await fetch('/api/kiosk/jobs');
    jobs = await response.json();
    renderProductionBoard();
  } catch (error) {
    console.error('Failed to load jobs:', error);
  }
}

// Create production board columns
function createProductionBoard() {
  const productionBoard = document.getElementById('production-board');
  productionBoard.innerHTML = '';
  
  productionStages.forEach(stage => {
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
    
    productionBoard.appendChild(column);
  });
}

// Render production board with jobs
function renderProductionBoard() {
  const productionBoard = document.getElementById('production-board');
  
  // Clear all columns
  productionBoard.querySelectorAll('.column-body').forEach(col => {
    col.innerHTML = '';
  });
  
  // Add jobs to their respective columns
  jobs.forEach(job => {
    // Skip completed jobs
    if (job.stage === 'Completed') {
      return;
    }
    
    // Only show jobs in production stages
    if (productionStages.includes(job.stage)) {
      const columnBody = productionBoard.querySelector(`.column-body[data-stage="${job.stage}"]`);
      if (columnBody) {
        const card = createJobCard(job);
        columnBody.appendChild(card);
      }
    }
  });
  
  // Update counts
  updateCounts();
}

// Create a job card (read-only for kiosk)
function createJobCard(job) {
  const card = document.createElement('div');
  card.className = 'job-card kiosk-card';
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
  
  // Items needed
  let itemsNeededHtml = '';
  if (job.items_needed) {
    itemsNeededHtml = `<div class="items-needed"><strong>Waiting:</strong> ${job.items_needed}</div>`;
  }
  
  // Install date
  let installDateHtml = '';
  if (job.install_date) {
    const date = new Date(job.install_date).toLocaleDateString();
    const alertIcon = isPastDue ? '<span class="alert-icon">⚠️</span> ' : '';
    installDateHtml = `<div class="install-date ${isPastDue ? 'past-due-date' : ''}"><strong>Install:</strong> ${alertIcon}${date}</div>`;
  }
  
  // Get actual paint color hex and calculate text color for badge
  const actualColor = job.job_color ? getPaintColor(job.job_color) : null;
  const textColor = actualColor ? getTextColorForBackground(actualColor) : '#181715';
  
  // Color badge
  let colorBadgeHtml = '';
  if (job.job_color && actualColor) {
    colorBadgeHtml = `
      <div class="color-badge" style="background-color: ${actualColor}; color: ${textColor};">
        ${job.job_color}
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
  
  // Job identifier badge
  const jobIdentifierHtml = job.job_identifier ? ` <span class="job-identifier-badge">${job.job_identifier}</span>` : '';

  card.innerHTML = `
    <div class="job-header">
      <div class="job-name">${job.job_name || 'Unnamed Job'}${jobIdentifierHtml}</div>
    </div>
    <div class="job-address">${job.job_address || ''}</div>
    ${colorBadgeHtml}
    ${itemsNeededHtml}
    ${installDateHtml}
    ${completionHtml}
  `;
  
  return card;
}

// Update column counts
function updateCounts() {
  const productionBoard = document.getElementById('production-board');
  productionStages.forEach(stage => {
    const column = productionBoard.querySelector(`.kanban-column[data-stage="${stage}"]`);
    if (column) {
      const count = column.querySelectorAll('.job-card').length;
      const countEl = column.querySelector('.count');
      countEl.textContent = `${count} job${count !== 1 ? 's' : ''}`;
    }
  });
}

// Socket.IO listeners for real-time updates
socket.on('job-created', (job) => {
  jobs.push(job);
  renderProductionBoard();
});

socket.on('job-updated', (data) => {
  const job = data.job || data; // Server sends {job, movedBy}
  const index = jobs.findIndex(j => j.id === job.id);
  if (index !== -1) {
    jobs[index] = job;
  } else {
    jobs.push(job);
  }
  renderProductionBoard();
});

socket.on('job-deleted', (data) => {
  const jobId = data.jobId || data; // Server sends {jobId}
  jobs = jobs.filter(j => j.id !== jobId);
  renderProductionBoard();
});

socket.on('refresh-board', () => {
  loadJobs();
});
// Initialize
document.addEventListener('DOMContentLoaded', () => {
  createProductionBoard();
  loadJobs();
  updateTime();
  setInterval(updateTime, 1000);
  
  // Auto-refresh board every 60 seconds
  setInterval(() => {
    console.log('Auto-refreshing board...');
    loadJobs();
  }, 60000); // 60 seconds
});
