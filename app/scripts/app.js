// Global state
let jobs = [];
let customers = [];
let services = [];
let currentUser = null;
let currentBoard = 'production';
let socket = null;

// Init
async function init() {
  try {
    const auth = await API.checkAuth();
    currentUser = auth.user || auth;
    updateUserDisplay();
    connectSocket();
    await loadData();
    renderBoard();
  } catch {
    showLogin();
  }
}

function connectSocket() {
  socket = io(API.baseUrl);
  socket.on('job-created', job => { jobs.push(job); renderBoard(); toast('Job created: ' + job.job_name, 'success'); });
  socket.on('job-updated', data => {
    const idx = jobs.findIndex(j => j.id === data.job.id);
    if (idx >= 0) jobs[idx] = data.job;
    renderBoard();
  });
  socket.on('job-deleted', data => {
    jobs = jobs.filter(j => j.id !== data.jobId);
    renderBoard();
  });
  socket.on('estimate-approved', data => {
    toast('ESTIMATE APPROVED: ' + data.estimateNumber + ' — ' + data.jobName, 'success');
    loadData().then(() => renderBoard());
  });
}

async function loadData() {
  [jobs, customers, services] = await Promise.all([
    API.getJobs(),
    API.getCustomers(),
    API.getServices()
  ]);
}

function updateUserDisplay() {
  const el = document.getElementById('currentUser');
  if (currentUser && el) {
    const name = currentUser.full_name || currentUser.username || 'User';
    el.querySelector('.user-avatar').textContent = name.charAt(0).toUpperCase();
    el.querySelector('span').textContent = name;
  }
}

// View Switching
function switchView(view, btn) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');

  if (view === 'dashboard') loadDashboard();
  if (view === 'customers') renderCustomers();
  if (view === 'billing') loadBillingView();
  if (view === 'timeclock') loadTimeClock();
  if (view === 'doors') loadInvoicing();
  if (view === 'settings') loadSettings();
}

function switchBoard(board, btn) {
  currentBoard = board;
  document.querySelectorAll('.board-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderBoard();
}

// Login
function showLogin() {
  document.getElementById('jobModal').classList.add('active');
  document.getElementById('jobModalTitle').textContent = 'Login';
  document.getElementById('jobModalBody').innerHTML = `
    <div class="form-group"><label>Username</label><input type="text" id="loginUser" autofocus></div>
    <div class="form-group"><label>Password</label><input type="password" id="loginPass" onkeydown="if(event.key==='Enter')doLogin()"></div>
    <div id="loginError" style="color:var(--red);font-size:12px;margin-bottom:8px;display:none;"></div>
    <div class="form-actions"><button class="btn-primary" onclick="doLogin()">Login</button></div>`;
}

async function doLogin() {
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  try {
    const r = await API.login(username, password);
    if (r.token) API.setToken(r.token);
    currentUser = r.user || r;
    updateUserDisplay();
    closeJobModal();
    connectSocket();
    await loadData();
    renderBoard();
  } catch {
    document.getElementById('loginError').style.display = 'block';
    document.getElementById('loginError').textContent = 'Invalid credentials';
  }
}

// Job Modal
function openNewJobModal() {
  openEstimateModal();
}

function openEditJobModal(jobId) {
  const job = jobs.find(j => j.id === jobId);
  if (!job) return;
  document.getElementById('jobModalTitle').textContent = 'Edit Job';
  document.getElementById('jobModalBody').innerHTML = buildJobForm(job);
  document.getElementById('jobModal').classList.add('active');
}

function buildJobForm(job) {
  const j = job || {};
  const custOpts = customers.map(c => '<option value="'+c.id+'"'+(j.customer_id==c.id?' selected':'')+'>'+c.name+'</option>').join('');
  const stages = ['Quote/Estimate','Ready to Cut','Cutting','Edge Banding','Assembly','Finishing','Ready for Install','Installed - Finish Work','Completed'];
  const stageOpts = stages.map(s => '<option'+(j.stage===s?' selected':'')+'>'+s+'</option>').join('');

  return `
    <input type="hidden" id="jId" value="${j.id||''}">
    <div class="form-row">
      <div class="form-group"><label>Job Name *</label><input type="text" id="jName" value="${(j.job_name||'').replace(/"/g,'&quot;')}"></div>
      <div class="form-group"><label>Customer</label><select id="jCustomer"><option value="">— Select —</option>${custOpts}</select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Address</label><input type="text" id="jAddress" value="${(j.job_address||'').replace(/"/g,'&quot;')}"></div>
      <div class="form-group"><label>Email</label><input type="text" id="jEmail" value="${(j.job_email||'').replace(/"/g,'&quot;')}"></div>
    </div>
    <div class="form-row3">
      <div class="form-group"><label>Stage</label><select id="jStage">${stageOpts}</select></div>
      <div class="form-group"><label>Color</label><input type="text" id="jColor" value="${(j.job_color||'').replace(/"/g,'&quot;')}"></div>
      <div class="form-group"><label>Quoted Price</label><input type="number" id="jPrice" step="0.01" value="${j.quoted_price||''}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Install Date</label><input type="date" id="jInstall" value="${j.install_date||''}"></div>
      <div class="form-group"><label>Items Needed</label><input type="text" id="jItems" value="${(j.items_needed||'').replace(/"/g,'&quot;')}"></div>
    </div>
    <div class="form-group"><label>Finish Work</label><textarea id="jFinish" rows="2">${j.finish_work||''}</textarea></div>
    <div class="form-group"><label><input type="checkbox" id="jDoor" ${j.is_door_order?'checked':''}> Door Order</label></div>
    <div class="form-actions">
      <button class="btn-primary" onclick="saveJob()">Save</button>
      <button class="btn-secondary" onclick="closeJobModal()">Cancel</button>
      ${j.id ? '<button class="btn-danger" onclick="deleteJob('+j.id+')">Delete</button>' : ''}
    </div>`;
}

async function saveJob() {
  const id = document.getElementById('jId').value;
  const data = {
    job_name: document.getElementById('jName').value.trim(),
    customer_id: document.getElementById('jCustomer').value || null,
    job_address: document.getElementById('jAddress').value.trim(),
    job_email: document.getElementById('jEmail').value.trim(),
    stage: document.getElementById('jStage').value,
    job_color: document.getElementById('jColor').value.trim(),
    quoted_price: parseFloat(document.getElementById('jPrice').value) || null,
    install_date: document.getElementById('jInstall').value || null,
    items_needed: document.getElementById('jItems').value.trim(),
    finish_work: document.getElementById('jFinish').value.trim(),
    is_door_order: document.getElementById('jDoor').checked ? 1 : 0
  };
  if (!data.job_name) { toast('Job name required', 'error'); return; }
  try {
    if (id) {
      const updated = await API.updateJob(id, data);
      const idx = jobs.findIndex(j => j.id == id);
      if (idx >= 0) jobs[idx] = { ...jobs[idx], ...updated };
    } else {
      const created = await API.createJob(data);
      jobs.push(created);
    }
    renderBoard();
    closeJobModal();
    toast(id ? 'Job updated' : 'Job created', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteJob(id) {
  if (!confirm('Delete this job?')) return;
  try {
    await API.deleteJob(id);
    jobs = jobs.filter(j => j.id !== id);
    renderBoard();
    closeJobModal();
    toast('Job deleted', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

function closeJobModal() { document.getElementById('jobModal').classList.remove('active'); }
function closeCustomerModal() { document.getElementById('customerModal').classList.remove('active'); }

// Settings
async function loadSettings() {
  document.getElementById('serverUrl').value = API.baseUrl;
  try {
    const users = await API.getUsers();
    document.getElementById('usersList').innerHTML = users.map(u =>
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);"><span>' + u.full_name + ' (' + u.username + ') — ' + u.role + '</span></div>'
    ).join('');
  } catch {}
}

function updateServerUrl(url) { API.setServer(url); toast('Server updated', 'success'); }

function openUserModal() {
  document.getElementById('customerModalTitle').textContent = 'New User';
  document.getElementById('customerModalBody').innerHTML = `
    <div class="form-group"><label>Full Name *</label><input type="text" id="newUserName"></div>
    <div class="form-group"><label>Username *</label><input type="text" id="newUserUsername"></div>
    <div class="form-group"><label>Password *</label><input type="password" id="newUserPass"></div>
    <div class="form-group"><label>Role</label><select id="newUserRole"><option value="employee">Employee</option><option value="admin">Admin</option><option value="job-floor">Job Floor</option></select></div>
    <div class="form-actions"><button class="btn-primary" onclick="saveNewUser()">Save User</button><button class="btn-secondary" onclick="closeCustomerModal()">Cancel</button></div>`;
  document.getElementById('customerModal').classList.add('active');
}

async function saveNewUser() {
  const full_name = document.getElementById('newUserName').value.trim();
  const username = document.getElementById('newUserUsername').value.trim();
  const password = document.getElementById('newUserPass').value;
  const role = document.getElementById('newUserRole').value;
  if (!full_name || !username || !password) { toast('All fields required', 'error'); return; }
  try {
    await API.createUser({ full_name, username, password, role });
    toast('User created: ' + full_name, 'success');
    closeCustomerModal();
    loadSettings();
  } catch (e) { toast('Failed: ' + e.message, 'error'); }
}

// Toast
function toast(msg, type) {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = 'toast toast-' + (type || 'success');
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeJobModal(); closeCustomerModal(); }
  if (e.key === 'n' && e.ctrlKey) { e.preventDefault(); openNewJobModal(); }
});

// Start
init();
