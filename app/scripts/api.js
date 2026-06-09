const API = {
  baseUrl: localStorage.getItem('serverUrl') || 'https://jobtracker.3notchcabinets.com',
  token: localStorage.getItem('authToken') || '',

  setServer(url) { this.baseUrl = url; localStorage.setItem('serverUrl', url); },
  setToken(t) { this.token = t; localStorage.setItem('authToken', t); },

  async request(method, path, body) {
    const hdrs = { 'Content-Type': 'application/json' };
    if (this.token) hdrs['Authorization'] = 'Bearer ' + this.token;
    const opts = { method, headers: hdrs };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(this.baseUrl + path, opts);
    if (r.status === 401) { this.token = ''; localStorage.removeItem('authToken'); showLogin(); throw new Error('Unauthorized'); }
    if (!r.ok) throw new Error('API error: ' + r.status);
    const text = await r.text();
    return text ? JSON.parse(text) : {};
  },

  get(path) { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body); },
  put(path, body) { return this.request('PUT', path, body); },
  del(path) { return this.request('DELETE', path); },

  // Auth
  login(username, password) { return this.post('/api/login', { username, password }); },
  logout() { return this.post('/api/logout'); },
  checkAuth() { return this.get('/api/auth/check'); },

  // Jobs
  getJobs() { return this.get('/api/jobs'); },
  createJob(job) { return this.post('/api/jobs', job); },
  updateJob(id, data) { return this.put('/api/jobs/' + id, data); },
  deleteJob(id) { return this.del('/api/jobs/' + id); },
  getJobActivity(id) { return this.get('/api/jobs/' + id + '/activity'); },

  // Customers
  getCustomers() { return this.get('/api/customers'); },
  createCustomer(c) { return this.post('/api/customers', c); },
  updateCustomer(id, c) { return this.put('/api/customers/' + id, c); },
  deleteCustomer(id) { return this.del('/api/customers/' + id); },

  // Services & Estimates
  getServices() { return this.get('/api/services'); },
  getEstimateItems(jobId) { return this.get('/api/jobs/' + jobId + '/estimate-items'); },
  saveEstimateItems(jobId, items) { return this.post('/api/jobs/' + jobId + '/estimate-items/bulk', { items }); },
  generateEstimate(jobId) { return this.post('/api/jobs/' + jobId + '/generate-estimate'); },

  // Door Accounts & Invoicing
  getDoorAccounts() { return this.get('/api/door-accounts'); },
  createDoorAccount(a) { return this.post('/api/door-accounts', a); },
  updateDoorAccount(id, a) { return this.put('/api/door-accounts/' + id, a); },
  getCharges(accountId, period) { return this.get('/api/door-accounts/' + accountId + '/charges' + (period ? '?period=' + period : '')); },
  addCharge(accountId, c) { return this.post('/api/door-accounts/' + accountId + '/charges', c); },
  updateCharge(id, c) { return this.put('/api/door-charges/' + id, c); },
  deleteCharge(id) { return this.del('/api/door-charges/' + id); },
  getInvoices(period) { return this.get('/api/door-invoices' + (period ? '?period=' + period : '')); },
  generateMonthly(period) { return this.post('/api/door-invoices/generate-monthly', { billing_period: period }); },
  updateInvoice(id, data) { return this.put('/api/door-invoices/' + id, data); },
  markInvoiced(id) { return this.post('/api/door-invoices/' + id + '/mark-invoiced'); },
  markPaid(id) { return this.post('/api/door-invoices/' + id + '/mark-paid'); },

  // Dashboard
  getDashboard() { return this.get('/api/dashboard'); },

  // Users
  getUsers() { return this.get('/api/users'); },
  createUser(u) { return this.post('/api/users', u); },
  updateUser(id, u) { return this.put('/api/users/' + id, u); },
  deleteUser(id) { return this.del('/api/users/' + id); },
};
