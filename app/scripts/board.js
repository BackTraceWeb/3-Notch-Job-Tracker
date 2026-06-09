// Stage definitions
const STAGES = {
  production: ['Ready to Cut', 'Cutting', 'Edge Banding', 'Assembly', 'Finishing', 'Ready for Install', 'Installed - Finish Work'],
  quotes: ['Quote/Estimate'],
  milestone: ['Quote/Estimate', 'In Progress', 'Installed - Finish Work', 'Completed']
};

const COMPLETION = {
  'Quote/Estimate': 0, 'Ready to Cut': 10, 'Cutting': 25, 'Edge Banding': 40,
  'Assembly': 55, 'Finishing': 70, 'Ready for Install': 85, 'Installed - Finish Work': 95, 'Completed': 100
};

const MILESTONE_MAP = {
  'Ready to Cut': 'In Progress', 'Cutting': 'In Progress', 'Edge Banding': 'In Progress',
  'Assembly': 'In Progress', 'Finishing': 'In Progress', 'Ready for Install': 'In Progress'
};

function renderBoard() {
  const board = document.getElementById('kanbanBoard');
  let stages;
  if (currentBoard === 'milestone') stages = STAGES.milestone;
  else if (currentBoard === 'quotes') stages = STAGES.quotes;
  else stages = STAGES.production;

  board.innerHTML = stages.map(stage => {
    let stageJobs;
    if (currentBoard === 'milestone') {
      stageJobs = jobs.filter(j => {
        if (stage === 'In Progress') return MILESTONE_MAP[j.stage];
        return j.stage === stage;
      });
    } else if (currentBoard === 'quotes') {
      stageJobs = jobs.filter(j => j.stage === 'Quote/Estimate');
    } else {
      stageJobs = jobs.filter(j => j.stage === stage);
    }

    const cards = stageJobs.map(j => renderJobCard(j)).join('');
    return `
      <div class="kanban-column" data-stage="${stage}">
        <div class="column-header">
          <span>${stage}</span>
          <span class="count">${stageJobs.length}</span>
        </div>
        <div class="column-cards" data-stage="${stage}"
          ondragover="event.preventDefault();this.classList.add('drag-over')"
          ondragleave="this.classList.remove('drag-over')"
          ondrop="handleDrop(event,'${stage}');this.classList.remove('drag-over')">
          ${cards}
        </div>
      </div>`;
  }).join('');
}

function renderJobCard(job) {
  const pct = COMPLETION[job.stage] || 0;
  const customer = customers.find(c => c.id === job.customer_id);
  const custName = customer ? customer.name : '';
  const colorDot = job.job_color ? resolveColor(job.job_color) : '';
  const dotHtml = colorDot ? '<span class="job-color-dot" style="background:' + colorDot + '"></span>' : '';
  const price = job.quoted_price ? '$' + job.quoted_price.toLocaleString('en-US', {minimumFractionDigits: 2}) : '';
  const installDate = job.install_date ? new Date(job.install_date + 'T12:00:00').toLocaleDateString('en-US', {month:'short', day:'numeric'}) : '';
  const doorBadge = job.is_door_order ? '<span style="background:#78350f;color:#fbbf24;padding:1px 6px;border-radius:3px;font-size:8px;font-weight:700;margin-left:4px;">DOOR</span>' : '';
  const inv1 = job.first_invoice_sent ? (job.first_invoice_paid ? '<span style="color:var(--green);font-size:9px;">INV1 PAID</span>' : '<span style="color:var(--yellow);font-size:9px;">INV1 SENT</span>') : '';
  const inv2 = job.second_invoice_sent ? (job.second_invoice_paid ? '<span style="color:var(--green);font-size:9px;">INV2 PAID</span>' : '<span style="color:var(--yellow);font-size:9px;">INV2 SENT</span>') : '';

  return `
    <div class="job-card" draggable="true" data-id="${job.id}"
      ondragstart="handleDragStart(event,${job.id})"
      ondblclick="openEditJobModal(${job.id})">
      <div class="job-name">${dotHtml}${job.job_name}${doorBadge}</div>
      ${custName ? '<div class="job-customer">' + custName + '</div>' : ''}
      ${job.job_address ? '<div style="font-size:10px;color:var(--muted);margin-top:2px;">' + job.job_address + '</div>' : ''}
      <div class="job-meta">
        <span>${price}</span>
        <span>${installDate || pct + '%'}</span>
      </div>
      ${job.job_color ? '<div style="font-size:10px;color:var(--brand-dim);margin-top:2px;">Color: ' + job.job_color + '</div>' : ''}
      ${job.items_needed ? '<div style="font-size:10px;color:var(--muted);margin-top:2px;">' + job.items_needed.substring(0,50) + '</div>' : ''}
      ${inv1 || inv2 ? '<div style="margin-top:3px;display:flex;gap:6px;">' + inv1 + inv2 + '</div>' : ''}
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
    </div>`;
}

function resolveColor(colorStr) {
  if (!colorStr) return '';
  if (colorStr.startsWith('#')) return colorStr;
  if (colorStr.startsWith('rgb')) return colorStr;
  const lower = colorStr.toLowerCase().trim();
  if (typeof paintColors !== 'undefined' && paintColors[lower]) return paintColors[lower];
  const basic = { white:'#ffffff', black:'#000000', red:'#ff0000', blue:'#0000ff', green:'#008000', yellow:'#ffff00', gray:'#808080', grey:'#808080', brown:'#8b4513', tan:'#d2b48c', beige:'#f5f5dc', cream:'#fffdd0', ivory:'#fffff0', navy:'#000080', espresso:'#3c1414', walnut:'#5b3a29', cherry:'#de3163', maple:'#c9a050', oak:'#c2a366', birch:'#f2e6c9' };
  return basic[lower] || '';
}

// Drag and Drop
let dragJobId = null;

function handleDragStart(e, jobId) {
  dragJobId = jobId;
  e.dataTransfer.effectAllowed = 'move';
  e.target.classList.add('dragging');
  setTimeout(() => e.target.classList.remove('dragging'), 0);
}

async function handleDrop(e, targetStage) {
  e.preventDefault();
  if (!dragJobId) return;

  const job = jobs.find(j => j.id === dragJobId);
  if (!job || job.stage === targetStage) { dragJobId = null; return; }

  try {
    const updated = await API.updateJob(dragJobId, { stage: targetStage });
    const idx = jobs.findIndex(j => j.id === dragJobId);
    if (idx >= 0) jobs[idx] = { ...jobs[idx], ...updated, stage: targetStage };
    renderBoard();
    toast(job.job_name + ' → ' + targetStage, 'success');
  } catch (e) {
    toast('Move failed: ' + e.message, 'error');
  }
  dragJobId = null;
}
