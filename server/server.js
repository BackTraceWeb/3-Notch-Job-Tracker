const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const crypto = require('crypto');
const activeTokens = new Map();
const fs = require('fs');
const { generateEstimate } = require('./estimateGenerator');
const OAuthClient = require('intuit-oauth');
// Load credentials from AWS Secrets Manager, fallback to env file
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
async function loadSecrets() {
  try {
    const sm = new SecretsManagerClient({ region: 'us-east-1' });
    const resp = await sm.send(new GetSecretValueCommand({ SecretId: 'QBAPI' }));
    const secrets = JSON.parse(resp.SecretString);
    for (const [k, v] of Object.entries(secrets)) { process.env[k] = v; }
    console.log('[secrets] Loaded from AWS Secrets Manager');
  } catch (e) {
    console.log('[secrets] Secrets Manager failed, falling back to env file:', e.message);
    const fs_env = require('fs');
    const envFile = require('path').join('/home/ubuntu', '.credentials', 'secrets.env');
    if (fs_env.existsSync(envFile)) {
      fs_env.readFileSync(envFile, 'utf8').split(String.fromCharCode(10)).forEach(line => {
        const [key, ...val] = line.split('=');
        if (key && val.length && !key.startsWith('#')) process.env[key.trim()] = val.join('=').trim();
      });
    }
  }
}

let qbClient;
async function initApp() {
  await loadSecrets();
  
  // QuickBooks OAuth
  qbClient = new OAuthClient({
    clientId: process.env.QB_CLIENT_ID || '',
    clientSecret: process.env.QB_CLIENT_SECRET || '',
  environment: 'production',
  redirectUri: 'https://jobtracker.3notchcabinets.com/api/qb/callback',
  logging: false
});

let qbTokens = null;
let qbRealmId = null;
const QB_TOKEN_FILE = path.join(__dirname, '..', 'qb-tokens.json');

function loadQBTokens() {
  try {
    const data = JSON.parse(fs.readFileSync(QB_TOKEN_FILE, 'utf8'));
    qbTokens = data.tokens;
    qbRealmId = data.realmId;
    if (qbTokens) qbClient.setToken(qbTokens);
  } catch {}
}

function saveQBTokens() {
  fs.writeFileSync(QB_TOKEN_FILE, JSON.stringify({ tokens: qbClient.getToken(), realmId: qbRealmId }, null, 2));
  qbTokens = qbClient.getToken();
}

async function ensureQBToken() {
  if (!qbTokens) throw new Error('QuickBooks not connected');
  if (qbClient.isAccessTokenValid()) return;
  const resp = await qbClient.refresh();
  saveQBTokens();
}


// Graph API email helper with retry
const GRAPH_TENANT = process.env.GRAPH_TENANT || '96196770-10b7-438e-a363-d1d292618b7e';
const GRAPH_CLIENT = process.env.GRAPH_CLIENT_ID || 'd0b8ec4d-4eb1-4d42-94da-316c6eca8608';
const GRAPH_SECRET = process.env.GRAPH_CLIENT_SECRET || '';
const GRAPH_SENDER = process.env.GRAPH_SENDER || 'sales@3notchcabinets.com';

async function getGraphToken() {
  const https = require('https');
  const querystring = require('querystring');
  const data = querystring.stringify({
    client_id: GRAPH_CLIENT,
    client_secret: GRAPH_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'login.microsoftonline.com',
      path: '/' + GRAPH_TENANT + '/oauth2/v2.0/token',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': data.length }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body).access_token); }
        catch { reject(new Error('Graph token failed')); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function sendGraphEmail(to, subject, htmlContent, retries) {
  retries = retries || 3;
  const https = require('https');
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const token = await getGraphToken();
      const mail = {
        message: {
          subject: subject,
          body: { contentType: 'HTML', content: htmlContent },
          toRecipients: [{ emailAddress: { address: to } }],
          bccRecipients: [{ emailAddress: { address: "braines@3notchcabinets.com" } }],
          from: { emailAddress: { address: GRAPH_SENDER, name: '3 Notch Cabinet Co' } }
        }
      };
      const mailData = JSON.stringify(mail);
      const result = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'graph.microsoft.com',
          path: '/v1.0/users/' + GRAPH_SENDER + '/sendMail',
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(mailData) }
        }, res => {
          let body = '';
          res.on('data', d => body += d);
          res.on('end', () => {
            if (res.statusCode === 202) resolve(true);
            else reject(new Error('Graph ' + res.statusCode + ': ' + body));
          });
        });
        req.on('error', reject);
        req.write(mailData);
        req.end();
      });
      console.log('Email sent to ' + to + ' (attempt ' + attempt + ')');
      return result;
    } catch (e) {
      console.error('Email attempt ' + attempt + '/' + retries + ' failed: ' + e.message);
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 2000 * attempt));
      } else {
        throw e;
      }
    }
  }
}


async function qbRequest(method, endpoint, body) {
  await ensureQBToken();
  const baseUrl = qbClient.environment === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
  const url = baseUrl + '/v3/company/' + qbRealmId + endpoint;
  const opts = {
    url,
    method,
    headers: {
      'Authorization': 'Bearer ' + qbClient.getToken().access_token,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const https = require('https');
  const http_mod = require('http');
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const reqOpts = { hostname: u.hostname, path: u.pathname + u.search, method, headers: opts.headers };
    const req = https.request(reqOpts, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data, statusCode: res.statusCode }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

loadQBTokens();

// Auto-sync QB data every 5 minutes
async function qbAutoSync() {
  if (!qbTokens || !qbRealmId) return;
  try {
    await ensureQBToken();

    // Pull invoices and update job payment status
    const invResult = await qbRequest('GET', '/query?query=SELECT * FROM Invoice ORDER BY TxnDate DESC MAXRESULTS 500&minorversion=73');
    const invoices = invResult.QueryResponse ? invResult.QueryResponse.Invoice || [] : [];

    // Store for API access
    global.cachedQBInvoices = invoices;
    global.cachedQBLastSync = new Date().toISOString();

    // Sync payment status to jobs
    const allJobs = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM jobs', (err, rows) => err ? reject(err) : resolve(rows || []));
    });
    const allCustomers = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM customers', (err, rows) => err ? reject(err) : resolve(rows || []));
    });

    for (const inv of invoices) {
      if (inv.Balance > 0) continue; // Only sync paid invoices
      const custName = inv.CustomerRef ? inv.CustomerRef.name : '';
      const memo = inv.CustomerMemo ? inv.CustomerMemo.value || '' : '';

      for (const job of allJobs) {
        const cust = allCustomers.find(c => c.id === job.customer_id);
        if (!cust || cust.name.toLowerCase() !== custName.toLowerCase()) continue;

        const matchesMemo = memo.toLowerCase().includes(job.job_name.toLowerCase()) ||
          (job.estimate_number && memo.includes(job.estimate_number));
        const matchesAmt = job.first_invoice_amount === inv.TotalAmt ||
          job.second_invoice_amount === inv.TotalAmt ||
          job.quoted_price === inv.TotalAmt;

        if (matchesMemo || matchesAmt) {
          if (job.first_invoice_amount === inv.TotalAmt && job.first_invoice_sent && !job.first_invoice_paid) {
            db.run('UPDATE jobs SET first_invoice_paid = ? WHERE id = ?', [new Date().toISOString().split('T')[0], job.id]);
          } else if (job.second_invoice_amount === inv.TotalAmt && job.second_invoice_sent && !job.second_invoice_paid) {
            db.run('UPDATE jobs SET second_invoice_paid = ? WHERE id = ?', [new Date().toISOString().split('T')[0], job.id]);
          }
          break;
        }
      }
    }

    
    // Check for paid deposit invoices → move jobs to Ready to Cut
    try {
      const pendingJobs = await new Promise((resolve, reject) => {
        db.all("SELECT id, job_name, estimate_number, first_invoice_amount FROM jobs WHERE estimate_approved = 1 AND stage = 'Quote/Estimate' AND first_invoice_amount > 0", [], (err, rows) => err ? reject(err) : resolve(rows || []));
      });

      for (const pj of pendingJobs) {
        // Find the deposit invoice in QB by memo matching
        const memo = '50% Deposit';
        const estNum = (pj.estimate_number || '').replace('EST-', '');
        const paidInvoices = invoices.filter(inv =>
          inv.Balance === 0 &&
          inv.CustomerMemo &&
          inv.CustomerMemo.value &&
          inv.CustomerMemo.value.includes(memo) &&
          inv.CustomerMemo.value.includes(pj.estimate_number || estNum)
        );

        if (paidInvoices.length > 0) {
          db.run("UPDATE jobs SET stage = 'Ready to Cut', first_invoice_paid = ? WHERE id = ?",
            [new Date().toISOString().split('T')[0], pj.id]);
          io.emit('job-updated', { id: pj.id, stage: 'Ready to Cut' });
          console.log('Deposit paid — job "' + pj.job_name + '" moved to Ready to Cut');
        }
      }
    } catch (e) {
      console.error('Payment watcher error:', e.message);
    }

    console.log('QB sync: ' + invoices.length + ' invoices synced');
  } catch (e) {
    console.error('QB auto-sync error:', e.message);
  }
}

// Run sync on startup and every 5 minutes
setTimeout(qbAutoSync, 10000);
setInterval(qbAutoSync, 60 * 1000);


const app = express();
app.set("trust proxy", 1);
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
// CORS for desktop app
app.use((req, res, next) => {
  const origin = req.headers.origin;
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cache control middleware - prevent browser caching of dynamic files
app.use((req, res, next) => {
  // For HTML, JS, CSS, and JSON files - always check server for updates
  if (req.url.match(/\.(html|js|css|json)$/)) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  // For images and fonts - allow short-term caching (1 hour)
  else if (req.url.match(/\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/)) {
    res.setHeader('Cache-Control', 'public, max-age=3600');
  }
  next();
});

app.use(express.static(path.join(__dirname, '../public')));
app.use('/app', express.static(path.join(__dirname, '../app')));
app.use('/estimates', express.static(path.join(__dirname, '../estimates')));
app.use(session({
  store: new SQLiteStore({
    db: 'sessions.db',
    dir: path.join(__dirname, '..')
  }),
  secret: 'cabinet-tracker-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days in milliseconds
  }
}));

// Database setup
const db = new sqlite3.Database('./cabinet-jobs.db', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Contractor portal database connection
const contractorDb = new sqlite3.Database('../contractors.db', (err) => {
  if (err) {
    console.error('Error opening contractor database:', err);
  } else {
    console.log('Connected to contractor database');
  }
});

// Initialize database tables
function initializeDatabase() {
  // Users table
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT DEFAULT 'employee',
    phone TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Error creating users table:', err);
      return;
    }

    // Create default admin user if no users exist (run after table is created)
    db.get('SELECT COUNT(*) as count FROM users', [], (err, row) => {
      if (err) {
        console.error('Error checking users:', err);
        return;
      }
      if (row.count === 0) {
        const defaultPassword = bcrypt.hashSync('admin123', 10);
        db.run('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)',
          ['admin', defaultPassword, 'Administrator', 'admin'],
          (err) => {
            if (err) {
              console.error('Error creating default admin:', err);
            } else {
              console.log('Default admin user created: username=admin, password=admin123');
            }
          }
        );
      }
    });
  });

  // Jobs table
  db.run(`CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_name TEXT NOT NULL,
    job_address TEXT,
    job_color TEXT,
    stage TEXT DEFAULT 'Quote/Estimate',
    items_needed TEXT,
    finish_work TEXT,
    install_date DATE,
    completion_date DATE,
    first_invoice_sent DATE,
    first_invoice_paid DATE,
    second_invoice_sent DATE,
    second_invoice_paid DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER,
    FOREIGN KEY (created_by) REFERENCES users(id)
  )`);

  // Add invoice columns if they don't exist (for existing databases)
  db.run(`ALTER TABLE jobs ADD COLUMN first_invoice_sent DATE`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding first_invoice_sent column:', err);
    }
  });

  db.run(`ALTER TABLE jobs ADD COLUMN first_invoice_paid DATE`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding first_invoice_paid column:', err);
    }
  });

  db.run(`ALTER TABLE jobs ADD COLUMN second_invoice_sent DATE`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding second_invoice_sent column:', err);
    }
  });

  db.run(`ALTER TABLE jobs ADD COLUMN second_invoice_paid DATE`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding second_invoice_paid column:', err);
    }
  });

  db.run(`ALTER TABLE jobs ADD COLUMN finish_work TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding finish_work column:', err);
    }
  });

  // Add email column
  db.run(`ALTER TABLE jobs ADD COLUMN job_email TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding job_email column:', err);
    }
  });

  // Add invoice amount columns
  db.run(`ALTER TABLE jobs ADD COLUMN first_invoice_amount REAL`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding first_invoice_amount column:', err);
    }
  });

  db.run(`ALTER TABLE jobs ADD COLUMN second_invoice_amount REAL`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding second_invoice_amount column:', err);
    }
  });

  // Add single invoice mode column
  db.run(`ALTER TABLE jobs ADD COLUMN single_invoice_mode INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding single_invoice_mode column:', err);
    }
  });

  // Add quote/estimate columns
  db.run(`ALTER TABLE jobs ADD COLUMN material_cost REAL`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding material_cost column:', err);
    }
  });

  db.run(`ALTER TABLE jobs ADD COLUMN quoted_price REAL`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding quoted_price column:', err);
    }
  });

  // Add estimate tracking columns
  db.run(`ALTER TABLE jobs ADD COLUMN estimate_number TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding estimate_number column:', err);
    }
  });

  db.run(`ALTER TABLE jobs ADD COLUMN estimate_date DATE`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding estimate_date column:', err);
    }
  });

  db.run(`ALTER TABLE jobs ADD COLUMN estimate_pdf_path TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding estimate_pdf_path column:', err);
    }
  });

  // Add completion percentage column
  db.run(`ALTER TABLE jobs ADD COLUMN completion_percentage INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding completion_percentage column:', err);
    }
  });

  // Add job identifier column
  db.run(`ALTER TABLE jobs ADD COLUMN job_identifier TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding job_identifier column:', err);
    }
  });

  // Add customer_id column
  db.run(`ALTER TABLE jobs ADD COLUMN customer_id INTEGER`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding customer_id column:', err);
    }
  });

  // Add is_door_order column to jobs
  db.run(`ALTER TABLE jobs ADD COLUMN is_door_order INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding is_door_order column:', err);
    }
  });

  // Door accounts table - one per contractor
  db.run(`CREATE TABLE IF NOT EXISTS door_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT UNIQUE NOT NULL,
    customer_email TEXT,
    customer_id INTEGER,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  )`);

  // Door charges - individual line items on an account
  db.run(`CREATE TABLE IF NOT EXISTS door_charges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    source TEXT DEFAULT 'portal',
    source_order_id INTEGER,
    description TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    unit_cost REAL DEFAULT 0,
    line_total REAL DEFAULT 0,
    order_date DATE,
    billing_period TEXT,
    invoice_status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES door_accounts(id)
  )`);

  // Door monthly invoices - end-of-month tally per contractor
  db.run(`CREATE TABLE IF NOT EXISTS door_monthly_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    billing_period TEXT NOT NULL,
    subtotal REAL DEFAULT 0,
    adjustment REAL DEFAULT 0,
    adjustment_notes TEXT,
    total REAL DEFAULT 0,
    due_date DATE,
    status TEXT DEFAULT 'draft',
    paid_at DATETIME,
    notes TEXT,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES door_accounts(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
  )`);

  // Add customer_name column to contractor orders table
  contractorDb.run(`ALTER TABLE orders ADD COLUMN customer_name TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding customer_name to orders:', err);
    }
  });

  // Activity log table
  db.run(`CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    from_stage TEXT,
    to_stage TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES jobs(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
}

// Add approval columns
db.run('ALTER TABLE jobs ADD COLUMN approval_token TEXT', () => {});
db.run('ALTER TABLE jobs ADD COLUMN estimate_approved INTEGER DEFAULT 0', () => {});
db.run('ALTER TABLE jobs ADD COLUMN estimate_approved_date TEXT', () => {});

// Middleware to check if user is logged in
function requireAuth(req, res, next) {
  // Allow localhost requests without auth (for internal scripts like Mozaik sync)
  const clientIp = req.ip || req.connection.remoteAddress;
  const isLocalhost = clientIp === '127.0.0.1' ||
                      clientIp === '::1' ||
                      clientIp === '::ffff:127.0.0.1' ||
                      clientIp === 'localhost';

  // Check Bearer token (desktop app)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const tokenData = activeTokens.get(authHeader.split(' ')[1]);
    if (tokenData) {
      req.tokenUser = tokenData;
      if (!req.session) req.session = {};
      req.session.userId = tokenData.userId;
      req.session.username = tokenData.username;
      req.session.fullName = tokenData.fullName;
      return next();
    }
  }
  if (req.session && req.session.userId || isLocalhost) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

// API Routes

// Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (bcrypt.compareSync(password, user.password_hash)) {
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.fullName = user.full_name;
      const token = crypto.randomBytes(32).toString('hex');
      activeTokens.set(token, { userId: user.id, username: user.username, fullName: user.full_name, phone: user.phone || '', role: user.role });
      res.json({ success: true, token, user: { id: user.id, username: user.username, fullName: user.full_name, phone: user.phone || '', role: user.role } });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  });
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Check auth status
app.get('/api/auth/check', (req, res) => {
  if (req.session.userId) {
    db.get('SELECT id, username, full_name, phone, role FROM users WHERE id = ?', [req.session.userId], (err, user) => {
      if (err || !user) {
        return res.json({ authenticated: false });
      }
      res.json({ authenticated: true, user: { id: user.id, username: user.username, fullName: user.full_name, phone: user.phone || '', role: user.role } });
    });
  } else {
    res.json({ authenticated: false });
  }
});

// Get all jobs
app.get('/api/jobs', requireAuth, (req, res) => {
  db.all(`SELECT j.*, u.full_name as created_by_name, c.name as customer_name
          FROM jobs j
          LEFT JOIN users u ON j.created_by = u.id
          LEFT JOIN customers c ON j.customer_id = c.id
          ORDER BY j.created_at ASC`, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

// Create new job
app.post('/api/jobs', requireAuth, (req, res) => {
  const { customer_id, job_name, job_address, job_email, job_color, job_identifier, stage, items_needed, finish_work, install_date, completion_date,
          first_invoice_sent, first_invoice_paid, second_invoice_sent, second_invoice_paid,
          first_invoice_amount, second_invoice_amount, single_invoice_mode,
          material_cost, quoted_price, is_door_order, mozaik_cabinet_data,
          estimate_number, estimate_date, sanding_type } = req.body;

  // Use null for system/automated job creation (like Mozaik sync)
  const userId = req.session.userId || null;

  db.run(`INSERT INTO jobs (customer_id, job_name, job_address, job_email, job_color, job_identifier, stage, items_needed, finish_work, install_date, completion_date,
                             first_invoice_sent, first_invoice_paid, second_invoice_sent, second_invoice_paid,
                             first_invoice_amount, second_invoice_amount, single_invoice_mode,
                             material_cost, quoted_price, is_door_order, mozaik_cabinet_data, estimate_number, estimate_date, sanding_type, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [customer_id, job_name, job_address, job_email, job_color, job_identifier, stage || 'Quote/Estimate', items_needed, finish_work, install_date, completion_date,
     first_invoice_sent, first_invoice_paid, second_invoice_sent, second_invoice_paid,
     first_invoice_amount, second_invoice_amount, single_invoice_mode ? 1 : 0,
     material_cost, quoted_price, is_door_order ? 1 : 0, mozaik_cabinet_data ? (typeof mozaik_cabinet_data === 'object' ? JSON.stringify(mozaik_cabinet_data) : mozaik_cabinet_data) : null, estimate_number || null, estimate_date || null, sanding_type || null, userId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      const jobId = this.lastID;

      // Log activity (only if there's a user)
      if (userId) {
        db.run('INSERT INTO activity_log (job_id, user_id, action) VALUES (?, ?, ?)',
          [jobId, userId, 'created job'], (err) => {
            if (err) console.error('Failed to log activity:', err);
          });
      }

      // Get the newly created job
      db.get('SELECT * FROM jobs WHERE id = ?', [jobId], (err, job) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }

        // Broadcast to all connected clients
        io.emit('job-created', job);
        res.json(job);
      });
    }
  );
});

// Update job
app.put('/api/jobs/:id', requireAuth, (req, res) => {
  const jobId = req.params.id;

  // Get current job data to merge with updates
  db.get('SELECT * FROM jobs WHERE id = ?', [jobId], (err, oldJob) => {
    if (err || !oldJob) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Merge updates with existing job data (partial updates supported)
    const updates = { ...oldJob, ...req.body };

    const { job_name, job_address, job_email, job_color, job_identifier, stage, items_needed, finish_work, install_date, completion_date, customer_id, estimate_number, estimate_date, sanding_type,
            first_invoice_sent, first_invoice_paid, second_invoice_sent, second_invoice_paid,
            first_invoice_amount, second_invoice_amount, single_invoice_mode,
            material_cost, quoted_price, completion_percentage, is_door_order, mozaik_cabinet_data } = updates;

    db.run(`UPDATE jobs
            SET job_name = ?, job_address = ?, job_email = ?, job_color = ?, job_identifier = ?, stage = ?, items_needed = ?, finish_work = ?, customer_id = ?, estimate_number = ?, estimate_date = ?, sanding_type = ?,
                install_date = ?, completion_date = ?, first_invoice_sent = ?, first_invoice_paid = ?,
                second_invoice_sent = ?, second_invoice_paid = ?, first_invoice_amount = ?, second_invoice_amount = ?,
                single_invoice_mode = ?, material_cost = ?, quoted_price = ?, completion_percentage = ?,
                is_door_order = ?, mozaik_cabinet_data = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
      [job_name, job_address, job_email, job_color, job_identifier, stage, items_needed, finish_work, customer_id, estimate_number, estimate_date, sanding_type, install_date, completion_date,
       first_invoice_sent, first_invoice_paid, second_invoice_sent, second_invoice_paid,
       first_invoice_amount, second_invoice_amount, single_invoice_mode ? 1 : 0,
       material_cost, quoted_price, completion_percentage || 0, is_door_order ? 1 : 0, typeof mozaik_cabinet_data === 'object' ? JSON.stringify(mozaik_cabinet_data) : (mozaik_cabinet_data || null), jobId],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }

        // Log activity if stage changed (only if there's a user)
        const userId = req.session.userId || null;
        if (userId) {
          if (oldJob.stage !== stage) {
            db.run('INSERT INTO activity_log (job_id, user_id, action, from_stage, to_stage) VALUES (?, ?, ?, ?, ?)',
              [jobId, userId, 'moved job', oldJob.stage, stage], (err) => {
                if (err) console.error('Failed to log activity:', err);
              });
          } else {
            db.run('INSERT INTO activity_log (job_id, user_id, action) VALUES (?, ?, ?)',
              [jobId, userId, 'updated job'], (err) => {
                if (err) console.error('Failed to log activity:', err);
              });
          }
        }

        // Get updated job
        db.get('SELECT * FROM jobs WHERE id = ?', [jobId], (err, job) => {
          if (err) {
            return res.status(500).json({ error: 'Database error' });
          }

          // Broadcast to all connected clients
          io.emit('job-updated', { job, movedBy: req.session.fullName });
          res.json(job);
        });
      }
    );
  });
});

// Delete job
app.delete('/api/jobs/:id', requireAuth, (req, res) => {
  const jobId = req.params.id;

  db.run('DELETE FROM jobs WHERE id = ?', [jobId], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    // Log activity (only if there's a user)
    const userId = req.session.userId || null;
    if (userId) {
      db.run('INSERT INTO activity_log (job_id, user_id, action) VALUES (?, ?, ?)',
        [jobId, userId, 'deleted job'], (err) => {
          if (err) console.error('Failed to log activity:', err);
        });
    }

    // Broadcast to all connected clients
    io.emit('job-deleted', { jobId });
    res.json({ success: true });
  });
});

// Delete contractor order
app.delete('/api/contractor-orders/:id', requireAuth, (req, res) => {
  const orderId = req.params.id;

  contractorDb.run('DELETE FROM orders WHERE id = ?', [orderId], function(err) {
    if (err) {
      console.error('Error deleting contractor order:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json({ success: true, message: 'Order deleted successfully' });
  });
});

// Generate estimate PDF
app.post('/api/jobs/:id/generate-estimate', requireAuth, (req, res) => {
  const jobId = req.params.id;

  // Get job data
  db.get('SELECT * FROM jobs WHERE id = ?', [jobId], async (err, job) => {
    if (err || !job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Get line items for this job
    db.all('SELECT * FROM estimate_items WHERE job_id = ? ORDER BY line_order ASC', [jobId], async (err, lineItems) => {
      if (err) {
        console.error('Error fetching line items:', err);
        lineItems = [];
      }

      // If no saved line items, try to build from mozaik_cabinet_data
      if ((!lineItems || lineItems.length === 0) && job.mozaik_cabinet_data) {
        try {
          const cabData = typeof job.mozaik_cabinet_data === 'string'
            ? JSON.parse(job.mozaik_cabinet_data)
            : job.mozaik_cabinet_data;

          if (cabData && cabData.rooms && cabData.rooms.length > 0) {
            lineItems = [];
            const isDetailed = cabData.rooms.some(r =>
              r.counts && (r.counts.base > 1 || r.counts.wall > 1 || r.counts.tall > 1));

            cabData.rooms.forEach(room => {
              const roomLabel = cabData.rooms.length > 1 ? ` (${room.name})` : '';

              if (isDetailed) {
                // Detailed format: use counts
                if (room.counts && room.counts.base > 0) {
                  lineItems.push({ description: `${room.counts.base} Base Cabinets${roomLabel}`, quantity: 1, rate: 0, amount: 0 });
                }
                if (room.counts && room.counts.wall > 0) {
                  lineItems.push({ description: `${room.counts.wall} Wall Cabinets${roomLabel}`, quantity: 1, rate: 0, amount: 0 });
                }
                if (room.counts && room.counts.tall > 0) {
                  lineItems.push({ description: `${room.counts.tall} Tall Cabinets${roomLabel}`, quantity: 1, rate: 0, amount: 0 });
                }
                if (room.doors && room.doors.base_tall > 0) {
                  lineItems.push({ description: `${room.doors.base_tall} Base/Tall Doors${roomLabel}`, quantity: 1, rate: 0, amount: 0 });
                }
                if (room.doors && room.doors.wall > 0) {
                  lineItems.push({ description: `${room.doors.wall} Wall Doors${roomLabel}`, quantity: 1, rate: 0, amount: 0 });
                }
                if (room.doors && room.doors.drawer_fronts > 0) {
                  lineItems.push({ description: `${room.doors.drawer_fronts} Drawer Fronts${roomLabel}`, quantity: 1, rate: 0, amount: 0 });
                }
              } else {
                // Simple format: use cabinets array with amounts
                if (room.cabinets && room.cabinets.length > 0) {
                  room.cabinets.forEach(cab => {
                    const desc = cab.qty > 1 ? `${cab.qty} ${cab.type}${roomLabel}` : `${cab.type}${roomLabel}`;
                    lineItems.push({ description: desc, quantity: 1, rate: cab.amount || 0, amount: cab.amount || 0 });
                  });
                }
              }
              if (room.crown_molding_ft > 0) {
                lineItems.push({ description: `Crown Molding - ${room.crown_molding_ft} LF${roomLabel}`, quantity: 1, rate: 0, amount: 0 });
              }
            });

            if (cabData.finish) {
              lineItems.push({ description: `Cabinet Finish: ${cabData.finish}`, quantity: 1, rate: 0, amount: 0 });
            }
          }
        } catch (parseErr) {
          console.error('Error parsing mozaik_cabinet_data:', parseErr);
        }
      }

      try {
        // Create estimates directory if it doesn't exist
        const estimatesDir = path.join(__dirname, '../estimates');
        if (!fs.existsSync(estimatesDir)) {
          fs.mkdirSync(estimatesDir, { recursive: true });
        }

        // Generate estimate number if not exists
        let estimateNumber = job.estimate_number;
        if (!estimateNumber) {
          // Get latest estimate number
          db.get('SELECT estimate_number FROM jobs WHERE estimate_number IS NOT NULL ORDER BY id DESC LIMIT 1',
            (err, row) => {
              if (row && row.estimate_number) {
                const lastNum = parseInt(row.estimate_number.replace('EST-', ''));
                estimateNumber = `EST-${String(lastNum + 1).padStart(4, '0')}`;
              } else {
                estimateNumber = 'EST-1001';
              }

              generatePDF();
            });
        } else {
          generatePDF();
        }

        async function generatePDF() {
          const estimateDate = new Date().toISOString().split('T')[0];
          const pdfFileName = `estimate-${estimateNumber}-${Date.now()}.pdf`;
          const pdfPath = path.join(estimatesDir, pdfFileName);

          // Get user info for the PDF
          const userId = req.session.userId;
          const user = await new Promise((resolve) => {
            db.get('SELECT full_name, email, phone FROM users WHERE id = ?', [userId], (err, row) => {
              if (err || !row) {
                resolve({ full_name: '3 Notch Cabinet Co', email: '', phone: '(334) 981-0002' });
              } else {
                resolve(row);
              }
            });
          });

          // Generate PDF with line items and user info
          await generateEstimate(job, lineItems, user, estimateNumber, pdfPath);

          // Update job with estimate info
          db.run(`UPDATE jobs SET estimate_number = ?, estimate_date = ?, estimate_pdf_path = ?, updated_at = CURRENT_TIMESTAMP
                  WHERE id = ?`,
            [estimateNumber, estimateDate, pdfFileName, jobId],
            (err) => {
              if (err) {
                return res.status(500).json({ error: 'Failed to update job' });
              }

              // Log activity (only if there's a user)
              const userId = req.session.userId || null;
              if (userId) {
                db.run('INSERT INTO activity_log (job_id, user_id, action) VALUES (?, ?, ?)',
                  [jobId, userId, 'generated estimate'], (err) => {
                    if (err) console.error('Failed to log activity:', err);
                  });
              }

              // Return PDF info
              res.json({
                success: true,
                estimateNumber,
                estimateDate,
                pdfUrl: `/estimates/${pdfFileName}`
              });
            });
        }
      } catch (error) {
        console.error('Error generating estimate:', error);
        res.status(500).json({ error: 'Failed to generate estimate PDF' });
      }
    });
  });
});

// Download estimate PDF
app.get('/estimates/:filename', requireAuth, (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, '../estimates', filename);

  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).json({ error: 'Estimate not found' });
  }
});

// Get activity log for a job
app.get('/api/jobs/:id/activity', requireAuth, (req, res) => {
  const jobId = req.params.id;

  db.all(`SELECT a.*, u.full_name as user_name
          FROM activity_log a
          JOIN users u ON a.user_id = u.id
          WHERE a.job_id = ?
          ORDER BY a.timestamp DESC`, [jobId], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

// Get dashboard data (orders + jobs + invoicing)
app.get('/api/dashboard', requireAuth, (req, res) => {
  // Get all jobs with invoice and completion data
  db.all(`SELECT
    j.*,
    u.full_name as created_by_name
    FROM jobs j
    LEFT JOIN users u ON j.created_by = u.id
    ORDER BY j.created_at DESC`, [], (err, jobs) => {

    if (err) {
      return res.status(500).json({ error: 'Failed to fetch jobs' });
    }

    // Get all orders from contractor portal
    contractorDb.all(`SELECT
      o.id as order_id,
      o.contractor_id,
      o.door_style,
      o.wood_type,
      o.finish_type,
      o.width,
      o.height,
      o.thickness,
      o.quantity,
      o.cost,
      o.status as order_status,
      o.needed_by,
      o.created_at as order_created_at,
      c.company_name,
      c.contact_name,
      c.email as contractor_email
      FROM orders o
      LEFT JOIN contractors c ON o.contractor_id = c.id
      ORDER BY o.created_at DESC`, [], (err, orders) => {

      if (err) {
        console.error('Error fetching orders:', err);
        // Continue without orders if contractor DB fails
        return res.json({ jobs, orders: [] });
      }

      // Return combined data
      res.json({ jobs, orders });
    });
  });
});

// Get all users (admin only)
app.get('/api/users', requireAuth, (req, res) => {
  db.get('SELECT role FROM users WHERE id = ?', [req.session.userId], (err, user) => {
    if (err || !user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    db.all('SELECT id, username, full_name, role, created_at FROM users', [], (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.json(rows);
    });
  });
});

// Create new user (admin only)
app.post('/api/users', requireAuth, (req, res) => {
  const { username, password, full_name, role } = req.body;

  db.get('SELECT role FROM users WHERE id = ?', [req.session.userId], (err, user) => {
    if (err || !user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const password_hash = bcrypt.hashSync(password, 10);

    db.run('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)',
      [username, password_hash, full_name, role || 'employee'],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Username already exists' });
          }
          return res.status(500).json({ error: 'Database error' });
        }

        res.json({ id: this.lastID, username, full_name, role });
      }
    );
  });
});

// Update user (admin only)
app.put('/api/users/:id', requireAuth, (req, res) => {
  const userId = req.params.id;
  const { full_name, role, password } = req.body;

  db.get('SELECT role FROM users WHERE id = ?', [req.session.userId], (err, user) => {
    if (err || !user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // If password is provided, update it along with other fields
    if (password && password.trim() !== '') {
      const password_hash = bcrypt.hashSync(password, 10);
      db.run('UPDATE users SET full_name = ?, role = ?, password_hash = ? WHERE id = ?',
        [full_name, role, password_hash, userId],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Database error' });
          }
          res.json({ success: true, id: userId, full_name, role });
        }
      );
    } else {
      // Update without changing password
      db.run('UPDATE users SET full_name = ?, role = ? WHERE id = ?',
        [full_name, role, userId],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Database error' });
          }
          res.json({ success: true, id: userId, full_name, role });
        }
      );
    }
  });
});

// Delete user (admin only)
app.delete('/api/users/:id', requireAuth, (req, res) => {
  const userId = req.params.id;

  db.get('SELECT role FROM users WHERE id = ?', [req.session.userId], (err, user) => {
    if (err || !user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Prevent admin from deleting themselves
    if (parseInt(userId) === req.session.userId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    db.run('DELETE FROM users WHERE id = ?', [userId], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.json({ success: true });
    });
  });
});

// ==================== CUSTOMERS API ====================

// Get all customers
app.get('/api/customers', requireAuth, (req, res) => {
  db.all(`SELECT * FROM customers ORDER BY name ASC`, [], (err, rows) => {
    if (err) {
      console.error('Error fetching customers:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

// Create new customer
app.post('/api/customers', requireAuth, (req, res) => {
  const { name, email, phone, address, is_contractor, contractor_id, notes } = req.body;

  // Check for existing customer with same name (case-insensitive)
  db.get('SELECT * FROM customers WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))', [name], (err, existing) => {
    if (err) {
      console.error('Error checking for duplicate customer:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (existing) {
      // Return existing customer instead of creating duplicate
      return res.json(existing);
    }

    db.run(`INSERT INTO customers (name, email, phone, address, is_contractor, contractor_id, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, email, phone, address, is_contractor ? 1 : 0, contractor_id, notes],
      function(err) {
        if (err) {
          console.error('Error creating customer:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        db.get('SELECT * FROM customers WHERE id = ?', [this.lastID], (err, customer) => {
          if (err) {
            return res.status(500).json({ error: 'Database error' });
          }
          res.json(customer);
        });
      }
    );
  });
});

// Get single customer
app.get('/api/customers/:id', requireAuth, (req, res) => {
  const customerId = req.params.id;

  db.get('SELECT * FROM customers WHERE id = ?', [customerId], (err, customer) => {
    if (err) {
      console.error('Error fetching customer:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json(customer);
  });
});

// Update customer
app.put('/api/customers/:id', requireAuth, (req, res) => {
  const customerId = req.params.id;
  const { name, email, phone, address, notes, is_contractor } = req.body;

  db.run(`UPDATE customers
          SET name = ?, email = ?, phone = ?, address = ?, notes = ?, is_contractor = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
    [name, email, phone, address, notes, is_contractor ? 1 : 0, customerId],
    function(err) {
      if (err) {
        console.error('Error updating customer:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Customer not found' });
      }

      // Also update job_name for all linked jobs
      db.run('UPDATE jobs SET job_name = ? WHERE customer_id = ?', [name, customerId], (err) => {
        if (err) console.error('Error updating job names:', err);
      });

      db.get('SELECT * FROM customers WHERE id = ?', [customerId], (err, customer) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(customer);
      });
    }
  );
});

// Delete customer
app.delete('/api/customers/:id', requireAuth, (req, res) => {
  const customerId = req.params.id;

  // First, unlink any jobs from this customer
  db.run('UPDATE jobs SET customer_id = NULL WHERE customer_id = ?', [customerId], (err) => {
    if (err) {
      console.error('Error unlinking jobs:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    // Then delete the customer
    db.run('DELETE FROM customers WHERE id = ?', [customerId], function(err) {
      if (err) {
        console.error('Error deleting customer:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Customer not found' });
      }

      res.json({ success: true, message: 'Customer deleted successfully' });
    });
  });
});

// ==================== SERVICES API ====================

// Get all services
app.get('/api/services', requireAuth, (req, res) => {
  db.all(`SELECT * FROM services ORDER BY category, name ASC`, [], (err, rows) => {
    if (err) {
      console.error('Error fetching services:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

// ==================== ESTIMATE ITEMS API ====================

// Get estimate items for a job
app.get('/api/jobs/:jobId/estimate-items', requireAuth, (req, res) => {
  const jobId = req.params.jobId;

  db.all(`SELECT ei.*, s.name as service_name, s.category as service_category
          FROM estimate_items ei
          LEFT JOIN services s ON ei.service_id = s.id
          WHERE ei.job_id = ?
          ORDER BY ei.line_order ASC`, [jobId], (err, rows) => {
    if (err) {
      console.error('Error fetching estimate items:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

// Bulk save estimate items for a job
app.post('/api/jobs/:jobId/estimate-items/bulk', requireAuth, (req, res) => {
  const jobId = req.params.jobId;
  const { items } = req.body;

  db.run('DELETE FROM estimate_items WHERE job_id = ?', [jobId], (err) => {
    if (err) {
      console.error('Error deleting old estimate items:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!items || items.length === 0) {
      return res.json({ success: true, items: [] });
    }

    const stmt = db.prepare(`INSERT INTO estimate_items (job_id, service_id, description, quantity, rate, amount, line_order)
                             VALUES (?, ?, ?, ?, ?, ?, ?)`);

    items.forEach((item, index) => {
      stmt.run(jobId, item.service_id, item.description, item.quantity || 1, item.rate, item.amount, index);
    });

    stmt.finalize((err) => {
      if (err) {
        console.error('Error inserting estimate items:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      db.all(`SELECT * FROM estimate_items WHERE job_id = ? ORDER BY line_order ASC`, [jobId], (err, rows) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        res.json({ success: true, items: rows });
      });
    });
  });
});

// ===== DOOR ACCOUNTS & INVOICING API =====

// Get all door accounts with month balance (accepts ?period=2026-02)
app.get('/api/door-accounts', requireAuth, (req, res) => {
  const currentPeriod = req.query.period || new Date().toISOString().slice(0, 7);
  db.all(`SELECT da.*,
    COALESCE((SELECT SUM(line_total) FROM door_charges WHERE account_id = da.id AND billing_period = ?), 0) as current_month_total,
    COALESCE((SELECT COUNT(*) FROM door_charges WHERE account_id = da.id AND billing_period = ? AND invoice_status = 'pending'), 0) as pending_charges
    FROM door_accounts da ORDER BY da.customer_name`, [currentPeriod, currentPeriod], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});

// Create new door account
app.post('/api/door-accounts', requireAuth, (req, res) => {
  const { customer_name, customer_email, customer_id, notes } = req.body;
  if (!customer_name) return res.status(400).json({ error: 'customer_name required' });

  db.run(`INSERT INTO door_accounts (customer_name, customer_email, customer_id, notes) VALUES (?, ?, ?, ?)`,
    [customer_name.trim(), customer_email || null, customer_id || null, notes || null], function(err) {
      if (err) {
        if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Account already exists for this name' });
        return res.status(500).json({ error: 'Database error' });
      }
      db.get('SELECT * FROM door_accounts WHERE id = ?', [this.lastID], (err, account) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(account);
      });
    });
});

// Update door account
app.put('/api/door-accounts/:id', requireAuth, (req, res) => {
  const { customer_name, customer_email, customer_id, notes } = req.body;
  db.run(`UPDATE door_accounts SET customer_name = COALESCE(?, customer_name), customer_email = ?, customer_id = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [customer_name, customer_email || null, customer_id || null, notes || null, req.params.id], function(err) {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (this.changes === 0) return res.status(404).json({ error: 'Account not found' });
      db.get('SELECT * FROM door_accounts WHERE id = ?', [req.params.id], (err, account) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(account);
      });
    });
});

// Merge two door accounts (move charges from source to target, delete source)
app.post('/api/door-accounts/merge', requireAuth, (req, res) => {
  const { source_id, target_id } = req.body;
  if (!source_id || !target_id || source_id === target_id) return res.status(400).json({ error: 'Invalid source/target' });

  db.run('UPDATE door_charges SET account_id = ? WHERE account_id = ?', [target_id, source_id], (err) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    db.run('UPDATE door_monthly_invoices SET account_id = ? WHERE account_id = ?', [target_id, source_id], (err) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      db.run('DELETE FROM door_accounts WHERE id = ?', [source_id], (err) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ success: true, message: 'Accounts merged' });
      });
    });
  });
});

// Get charges for a door account (optionally filtered by billing period)
app.get('/api/door-accounts/:id/charges', requireAuth, (req, res) => {
  const period = req.query.period;
  if (period) {
    db.all('SELECT * FROM door_charges WHERE account_id = ? AND billing_period = ? ORDER BY order_date DESC', [req.params.id, period], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json(rows);
    });
  } else {
    db.all('SELECT * FROM door_charges WHERE account_id = ? ORDER BY order_date DESC', [req.params.id], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json(rows);
    });
  }
});

// Add a manual charge to a door account
app.post('/api/door-accounts/:id/charges', requireAuth, (req, res) => {
  const { description, quantity, unit_cost, order_date, source, source_order_id } = req.body;
  const line_total = (quantity || 1) * (unit_cost || 0);
  const billing_period = (order_date || new Date().toISOString().slice(0, 10)).slice(0, 7);

  db.run(`INSERT INTO door_charges (account_id, source, source_order_id, description, quantity, unit_cost, line_total, order_date, billing_period)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.params.id, source || 'manual', source_order_id || null, description, quantity || 1, unit_cost || 0, line_total, order_date || new Date().toISOString().slice(0, 10), billing_period],
    function(err) {
      if (err) return res.status(500).json({ error: 'Database error' });
      db.get('SELECT * FROM door_charges WHERE id = ?', [this.lastID], (err, charge) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(charge);
      });
    });
});

// Update a door charge (syncs price back to linked job if applicable)
app.put('/api/door-charges/:id', requireAuth, (req, res) => {
  const { description, quantity, unit_cost, invoice_status, order_date } = req.body;
  const line_total = (quantity || 1) * (unit_cost || 0);
  db.run(`UPDATE door_charges SET description = COALESCE(?, description), quantity = COALESCE(?, quantity),
          unit_cost = COALESCE(?, unit_cost), line_total = ?, invoice_status = COALESCE(?, invoice_status),
          order_date = COALESCE(?, order_date) WHERE id = ?`,
    [description, quantity, unit_cost, line_total, invoice_status, order_date, req.params.id], function(err) {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (this.changes === 0) return res.status(404).json({ error: 'Charge not found' });
      db.get('SELECT * FROM door_charges WHERE id = ?', [req.params.id], (err, charge) => {
        if (err) return res.status(500).json({ error: 'Database error' });

        // Sync price back to linked job if this charge came from a job
        if (charge.source_order_id) {
          db.run('UPDATE jobs SET quoted_price = ? WHERE id = ?',
            [charge.line_total, charge.source_order_id], (syncErr) => {
              if (syncErr) console.error('Failed to sync charge to job:', syncErr);
              else console.log(`Synced charge #${charge.id} ($${charge.line_total}) -> job #${charge.source_order_id}`);
            });
        }

        res.json(charge);
      });
    });
});

// Delete a door charge
app.delete('/api/door-charges/:id', requireAuth, (req, res) => {
  db.run('DELETE FROM door_charges WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (this.changes === 0) return res.status(404).json({ error: 'Charge not found' });
    res.json({ success: true });
  });
});

// Get jobs linked to a door account (via door_charges.source_order_id)
app.get('/api/door-accounts/:id/jobs', requireAuth, (req, res) => {
  db.all(`SELECT DISTINCT j.id, j.job_name, j.stage, j.quoted_price, j.material_cost, j.created_at,
          dc.id as charge_id, dc.description as charge_description, dc.line_total as charge_total
          FROM jobs j
          JOIN door_charges dc ON dc.source_order_id = j.id
          WHERE dc.account_id = ?
          ORDER BY j.created_at DESC`,
    [req.params.id], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json(rows);
    });
});

// Get monthly invoices (optionally filtered by billing period)
app.get('/api/door-invoices', requireAuth, (req, res) => {
  const period = req.query.period;
  const status = req.query.status;
  let query = `SELECT di.*, da.customer_name FROM door_monthly_invoices di
               JOIN door_accounts da ON di.account_id = da.id`;
  const params = [];
  const conditions = [];

  if (period) { conditions.push('di.billing_period = ?'); params.push(period); }
  if (status) { conditions.push('di.status = ?'); params.push(status); }
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY di.billing_period DESC, da.customer_name';

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});

// Generate month-end tallies for a billing period
app.post('/api/door-invoices/generate-monthly', requireAuth, (req, res) => {
  const { billing_period } = req.body; // e.g. '2026-02'
  if (!billing_period) return res.status(400).json({ error: 'billing_period required' });

  // Calculate due date (10th of next month)
  const [year, month] = billing_period.split('-').map(Number);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const due_date = `${nextYear}-${String(nextMonth).padStart(2, '0')}-10`;

  // Get all accounts with pending charges for this period
  db.all(`SELECT dc.account_id, SUM(dc.line_total) as subtotal
          FROM door_charges dc
          WHERE dc.billing_period = ? AND dc.invoice_status = 'pending'
          GROUP BY dc.account_id
          HAVING subtotal > 0`, [billing_period], (err, accounts) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!accounts.length) return res.json({ message: 'No pending charges for this period', invoices: [] });

    const userId = req.session.userId || null;
    const invoices = [];
    let remaining = accounts.length;

    accounts.forEach(acct => {
      // Check if invoice already exists for this account+period
      db.get('SELECT id FROM door_monthly_invoices WHERE account_id = ? AND billing_period = ?', [acct.account_id, billing_period], (err, existing) => {
        if (existing) {
          // Update existing draft
          db.run('UPDATE door_monthly_invoices SET subtotal = ?, total = subtotal + COALESCE(adjustment, 0), due_date = ? WHERE id = ?',
            [acct.subtotal, due_date, existing.id], () => {
              invoices.push({ id: existing.id, account_id: acct.account_id, updated: true });
              if (--remaining === 0) res.json({ invoices });
            });
        } else {
          db.run(`INSERT INTO door_monthly_invoices (account_id, billing_period, subtotal, total, due_date, status, created_by)
                  VALUES (?, ?, ?, ?, ?, 'draft', ?)`,
            [acct.account_id, billing_period, acct.subtotal, acct.subtotal, due_date, userId], function(err) {
              if (err) { console.error('Error creating invoice:', err); }
              invoices.push({ id: this.lastID, account_id: acct.account_id, created: true });
              if (--remaining === 0) res.json({ invoices });
            });
        }
      });
    });
  });
});

// Update a monthly invoice (adjust total/notes)
app.put('/api/door-invoices/:id', requireAuth, (req, res) => {
  const { adjustment, adjustment_notes, notes } = req.body;
  db.run(`UPDATE door_monthly_invoices SET adjustment = ?, adjustment_notes = ?, notes = COALESCE(?, notes),
          total = subtotal + COALESCE(?, 0) WHERE id = ?`,
    [adjustment || 0, adjustment_notes || null, notes, adjustment || 0, req.params.id], function(err) {
      if (err) return res.status(500).json({ error: 'Database error' });
      db.get('SELECT di.*, da.customer_name FROM door_monthly_invoices di JOIN door_accounts da ON di.account_id = da.id WHERE di.id = ?',
        [req.params.id], (err, invoice) => {
          if (err) return res.status(500).json({ error: 'Database error' });
          res.json(invoice);
        });
    });
});

// Mark invoice as invoiced (entered into QuickBooks)
app.post('/api/door-invoices/:id/mark-invoiced', requireAuth, (req, res) => {
  db.run(`UPDATE door_monthly_invoices SET status = 'invoiced' WHERE id = ?`, [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: 'Database error' });
    // Also mark all associated charges as invoiced
    db.get('SELECT account_id, billing_period FROM door_monthly_invoices WHERE id = ?', [req.params.id], (err, inv) => {
      if (inv) {
        db.run(`UPDATE door_charges SET invoice_status = 'invoiced' WHERE account_id = ? AND billing_period = ? AND invoice_status = 'pending'`,
          [inv.account_id, inv.billing_period]);
      }
    });
    res.json({ success: true });
  });
});

// Mark invoice as paid
app.post('/api/door-invoices/:id/mark-paid', requireAuth, (req, res) => {
  db.run(`UPDATE door_monthly_invoices SET status = 'paid', paid_at = CURRENT_TIMESTAMP WHERE id = ?`, [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: 'Database error' });
    db.get('SELECT account_id, billing_period FROM door_monthly_invoices WHERE id = ?', [req.params.id], (err, inv) => {
      if (inv) {
        db.run(`UPDATE door_charges SET invoice_status = 'paid' WHERE account_id = ? AND billing_period = ?`,
          [inv.account_id, inv.billing_period]);
      }
    });
    res.json({ success: true });
  });
});

// Get unlinked portal orders (orders in contractors.db not yet linked to a door account)
app.get('/api/door-orders/unlinked', requireAuth, (req, res) => {
  contractorDb.all(`SELECT * FROM orders WHERE id NOT IN (
    SELECT source_order_id FROM door_charges WHERE source = 'portal' AND source_order_id IS NOT NULL
  ) ORDER BY created_at DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error', details: err.message });
    res.json(rows);
  });
});

// Link a portal order to a door account (creates a charge)
app.post('/api/door-orders/:orderId/link', requireAuth, (req, res) => {
  const { account_id } = req.body;
  const orderId = req.params.orderId;

  // Get the portal order details from contractors.db
  contractorDb.get('SELECT * FROM orders WHERE id = ?', [orderId], (err, order) => {
    if (err || !order) return res.status(404).json({ error: 'Order not found' });

    const description = `${order.wood_type} ${order.door_style} - ${order.width}"x${order.height}" ${order.finish_type} (qty ${order.quantity})`;
    const order_date = order.created_at ? order.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10);
    const billing_period = order_date.slice(0, 7);

    db.run(`INSERT INTO door_charges (account_id, source, source_order_id, description, quantity, unit_cost, line_total, order_date, billing_period)
            VALUES (?, 'portal', ?, ?, ?, ?, ?, ?, ?)`,
      [account_id, orderId, description, order.quantity, order.cost / order.quantity, order.cost, order_date, billing_period],
      function(err) {
        if (err) return res.status(500).json({ error: 'Database error' });
        db.get('SELECT * FROM door_charges WHERE id = ?', [this.lastID], (err, charge) => {
          if (err) return res.status(500).json({ error: 'Database error' });
          res.json(charge);
        });
      });
  });
});

// Fuzzy-match a customer name to existing door accounts
app.get('/api/door-accounts/match', requireAuth, (req, res) => {
  const name = (req.query.name || '').trim().toLowerCase();
  if (!name) return res.json([]);

  db.all('SELECT * FROM door_accounts', [], (err, accounts) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    // Simple fuzzy match: check if account name contains the search name or vice versa
    const matches = accounts.filter(a => {
      const acctName = a.customer_name.toLowerCase();
      return acctName.includes(name) || name.includes(acctName);
    });
    res.json(matches);
  });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Kiosk mode route (no authentication required)
app.get("/kiosk", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/kiosk.html"));
});

// Kiosk API endpoint - returns jobs for kiosk display
app.get("/api/kiosk/jobs", (req, res) => {
  db.all("SELECT * FROM jobs WHERE stage NOT IN ('Completed', 'Quote/Estimate', 'Invoiced') ORDER BY id", [], (err, rows) => {
    if (err) {
      console.error('Kiosk API error:', err);
      res.status(500).json({ error: "Database error" });
    } else {
      res.json(rows);
    }
  });
});

// Serve login page for root
app.get('/', (req, res) => {
  if (req.session.userId) {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  } else {
    res.sendFile(path.join(__dirname, '../public/login.html'));
  }
});

// Start server

// ====== QUICKBOOKS ROUTES ======

// QB Connect - initiate OAuth
app.get('/api/qb/connect', (req, res) => {
  const authUri = qbClient.authorizeUri({
    scope: [OAuthClient.scopes.Accounting],
    state: 'cabinet-tracker'
  });
  res.json({ url: authUri });
});

app.get('/api/qb/launch', (req, res) => {
  const authUri = qbClient.authorizeUri({
    scope: [OAuthClient.scopes.Accounting],
    state: 'cabinet-tracker'
  });
  res.redirect(authUri);
});

// QB Callback - handle OAuth redirect
app.get('/api/qb/callback', async (req, res) => {
  try {
    const authResponse = await qbClient.createToken(req.url);
    qbRealmId = req.query.realmId;
    saveQBTokens();
    res.send('<html><body style="font-family:Arial;text-align:center;padding:50px;"><h2 style="color:#4CAF50;">QuickBooks Connected!</h2><p>You can close this window.</p><script>window.close();</script></body></html>');
  } catch (e) {
    console.error('QB OAuth error:', e.message);
    res.status(500).send('QuickBooks connection failed: ' + e.message);
  }
});

// QB Disconnect
app.get('/api/qb/disconnect', (req, res) => {
  qbTokens = null;
  qbRealmId = null;
  try { fs.unlinkSync(QB_TOKEN_FILE); } catch {}
  res.json({ ok: true });
});

// QB Status
app.get('/api/qb/status', requireAuth, (req, res) => {
  res.json({ connected: !!qbTokens, realmId: qbRealmId });
});

// QB cached invoices (from auto-sync, instant response)
app.get('/api/qb/cached', requireAuth, (req, res) => {
  res.json({
    invoices: global.cachedQBInvoices || [],
    lastSync: global.cachedQBLastSync || null
  });
});

// QB force refresh
app.post('/api/qb/sync', requireAuth, async (req, res) => {
  try {
    await qbAutoSync();
    res.json({ ok: true, invoices: (global.cachedQBInvoices || []).length, lastSync: global.cachedQBLastSync });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// QB Get linked invoices for a job
app.get('/api/jobs/:id/qb-invoices', requireAuth, async (req, res) => {
  const job = await new Promise((resolve, reject) => {
    db.get('SELECT j.*, c.name as customer_name FROM jobs j LEFT JOIN customers c ON j.customer_id = c.id WHERE j.id = ?', [req.params.id], (err, row) => err ? reject(err) : resolve(row));
  });
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const invoices = global.cachedQBInvoices || [];
  const linked = invoices.filter(inv => {
    const custName = inv.CustomerRef ? inv.CustomerRef.name : '';
    if (job.customer_name && custName.toLowerCase() !== job.customer_name.toLowerCase()) return false;
    const memo = inv.CustomerMemo ? inv.CustomerMemo.value || '' : '';
    return memo.toLowerCase().includes(job.job_name.toLowerCase()) ||
      (job.estimate_number && memo.includes(job.estimate_number)) ||
      job.first_invoice_amount === inv.TotalAmt ||
      job.second_invoice_amount === inv.TotalAmt ||
      job.quoted_price === inv.TotalAmt;
  });
  res.json(linked);
});

// QB Get all invoices (current + historical)
app.get('/api/qb/invoices', requireAuth, async (req, res) => {
  try {
    const result = await qbRequest('GET', "/query?query=SELECT * FROM Invoice ORDER BY TxnDate DESC MAXRESULTS 500&minorversion=73");
    const invoices = result.QueryResponse ? result.QueryResponse.Invoice || [] : [];
    res.json(invoices);
  } catch (e) {
    console.error('QB invoices error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// QB Get single invoice
app.get('/api/qb/invoices/:id', requireAuth, async (req, res) => {
  try {
    const result = await qbRequest('GET', '/invoice/' + req.params.id + '?minorversion=73');
    res.json(result.Invoice || result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// QB Create invoice (progressive invoicing)
app.post('/api/qb/invoices', requireAuth, async (req, res) => {
  try {
    const result = await qbRequest('POST', '/invoice?minorversion=73', req.body);
    res.json(result.Invoice || result);
  } catch (e) {
    console.error('QB create invoice error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// QB Get all customers
app.get('/api/qb/customers', requireAuth, async (req, res) => {
  try {
    const result = await qbRequest('GET', "/query?query=SELECT * FROM Customer ORDER BY DisplayName MAXRESULTS 500&minorversion=73");
    const customers = result.QueryResponse ? result.QueryResponse.Customer || [] : [];
    res.json(customers);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// QB Create customer
app.post('/api/qb/customers', requireAuth, async (req, res) => {
  try {
    const result = await qbRequest('POST', '/customer?minorversion=73', req.body);
    res.json(result.Customer || result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// QB Get items/services
app.get('/api/qb/items', requireAuth, async (req, res) => {
  try {
    const result = await qbRequest('GET', "/query?query=SELECT * FROM Item ORDER BY Name MAXRESULTS 500&minorversion=73");
    const items = result.QueryResponse ? result.QueryResponse.Item || [] : [];
    res.json(items);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// QB Create invoice from door monthly tally
app.post('/api/door-invoices/:id/send-qb', requireAuth, async (req, res) => {
  try {
    // Get the door invoice
    const invoice = await new Promise((resolve, reject) => {
      db.get('SELECT di.*, da.customer_name, da.customer_email FROM door_monthly_invoices di JOIN door_accounts da ON di.account_id = da.id WHERE di.id = ?', [req.params.id], (err, row) => err ? reject(err) : resolve(row));
    });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    // Get charges for this period
    const charges = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM door_charges WHERE account_id = ? AND billing_period = ?', [invoice.account_id, invoice.billing_period], (err, rows) => err ? reject(err) : resolve(rows || []));
    });

    // Find or create QB customer
    await ensureQBToken();
    const custSearch = await qbRequest('GET', "/query?query=SELECT * FROM Customer WHERE DisplayName = '" + invoice.customer_name.replace(/'/g, "\\'") + "'&minorversion=73");
    let custRef;
    const found = custSearch.QueryResponse ? (custSearch.QueryResponse.Customer || []) : [];
    if (found.length > 0) {
      custRef = { value: found[0].Id, name: found[0].DisplayName };
    } else {
      const newCust = await qbRequest('POST', '/customer?minorversion=73', {
        DisplayName: invoice.customer_name,
        PrimaryEmailAddr: invoice.customer_email ? { Address: invoice.customer_email } : undefined
      });
      custRef = { value: newCust.Id, name: newCust.DisplayName };
    }

    // Build QB invoice lines from door charges
    const lines = charges.map(c => ({
      Amount: c.line_total || 0,
      DetailType: 'SalesItemLineDetail',
      Description: c.description + (c.order_date ? ' (' + c.order_date + ')' : ''),
      SalesItemLineDetail: {
        ItemRef: { value: '1', name: 'Services' },
        UnitPrice: c.unit_cost || 0,
        Qty: c.quantity || 1
      }
    }));

    // Create invoice in QB
    const periodDate = invoice.billing_period + '-01';
    const dueDate = invoice.due_date || new Date(new Date(periodDate).getTime() + 10 * 86400000).toISOString().split('T')[0];
    const qbInvoice = await qbRequest('POST', '/invoice?minorversion=73', {
      CustomerRef: custRef,
      TxnDate: new Date().toISOString().split('T')[0],
      DueDate: dueDate,
      Line: lines,
      CustomerMemo: { value: 'Door order charges — ' + new Date(periodDate).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) + ' (Net 10)' }
    });

    if (qbInvoice.Id) {
      // Mark charges as invoiced
      db.run('UPDATE door_charges SET invoice_status = ? WHERE account_id = ? AND billing_period = ? AND invoice_status = ?', ['invoiced', invoice.account_id, invoice.billing_period, 'pending']);
      db.run('UPDATE door_monthly_invoices SET status = ? WHERE id = ?', ['sent', invoice.id]);

      // Send via QB email
      try {
        await qbRequest('POST', '/invoice/' + qbInvoice.Id + '/send?minorversion=73');
      } catch {}

      res.json({ ok: true, qbInvoiceId: qbInvoice.Id, docNumber: qbInvoice.DocNumber });
    } else {
      res.status(500).json({ error: 'QB invoice creation failed', details: qbInvoice });
    }
  } catch (e) {
    console.error('Door QB invoice error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// QB Send invoice reminder
app.post('/api/qb/invoices/:id/remind', requireAuth, async (req, res) => {
  try {
    const email = req.body.email ? '?sendTo=' + req.body.email : '';
    const result = await qbRequest('POST', '/invoice/' + req.params.id + '/send' + email + '&minorversion=73');
    res.json({ ok: true, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// QB Send invoice email
app.post('/api/qb/invoices/:id/send', requireAuth, async (req, res) => {
  try {
    const email = req.body.email ? '?sendTo=' + req.body.email : '';
    const result = await qbRequest('POST', '/invoice/' + req.params.id + '/send' + email + '&minorversion=73');
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// QB Create estimate
app.post('/api/qb/estimates', requireAuth, async (req, res) => {
  try {
    const result = await qbRequest('POST', '/estimate?minorversion=73', req.body);
    res.json(result.Estimate || result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// QB Send estimate email
app.post('/api/qb/estimates/:id/send', requireAuth, async (req, res) => {
  try {
    // First get the estimate to check BillEmail
    const est = await qbRequest('GET', '/estimate/' + req.params.id + '?minorversion=73');
    const estimate = est.Estimate || est;

    // Determine email address
    let email = req.body.email || '';
    if (!email && estimate.BillEmail) email = estimate.BillEmail.Address;
    if (!email && estimate.CustomerRef) {
      // Look up customer email
      const custResult = await qbRequest('GET', '/customer/' + estimate.CustomerRef.value + '?minorversion=73');
      const cust = custResult.Customer || custResult;
      if (cust.PrimaryEmailAddr) email = cust.PrimaryEmailAddr.Address;
    }

    if (!email) {
      return res.status(400).json({ error: 'No email address found for customer' });
    }

    // Update estimate with BillEmail if missing
    if (!estimate.BillEmail || !estimate.BillEmail.Address) {
      await qbRequest('POST', '/estimate?minorversion=73', {
        Id: estimate.Id,
        SyncToken: estimate.SyncToken,
        sparse: true,
        BillEmail: { Address: email }
      });
    }

    // Now send
    const sendResult = await qbRequest('POST', '/estimate/' + req.params.id + '/send?sendTo=' + encodeURIComponent(email) + '&minorversion=73');
    res.json({ ok: true, email, result: sendResult });
  } catch (e) {
    console.error('QB estimate send error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// QB Send estimate via direct email (bypasses broken QB send API)
app.post('/api/qb/estimates/:id/send-email-direct', requireAuth, async (req, res) => {
  try {
    const est = await qbRequest('GET', '/estimate/' + req.params.id + '?minorversion=73');
    const estimate = est.Estimate || est;
    if (!estimate.Id) return res.status(404).json({ error: 'Estimate not found' });

    // Get customer email
    let email = req.body.email || '';
    if (!email && estimate.BillEmail) email = estimate.BillEmail.Address;
    if (!email && estimate.CustomerRef) {
      const custResult = await qbRequest('GET', '/customer/' + estimate.CustomerRef.value + '?minorversion=73');
      const cust = custResult.Customer || custResult;
      if (cust.PrimaryEmailAddr) email = cust.PrimaryEmailAddr.Address;
    }
    if (!email) return res.status(400).json({ error: 'No email found' });

    const custName = estimate.CustomerRef ? estimate.CustomerRef.name : 'Customer';
    const docNum = estimate.DocNumber || estimate.Id;
    const total = estimate.TotalAmt || 0;
    const lines = (estimate.Line || []).filter(l => l.DetailType === 'SalesItemLineDetail');
    const memo = estimate.CustomerMemo ? estimate.CustomerMemo.value : '';
    const expDate = estimate.ExpirationDate || '';

    let lineRows = lines.map((l, i) => {
      const d = l.SalesItemLineDetail || {};
      return '<tr style="background:' + (i%2 ? '#f8f7f5' : '#fff') + '"><td style="padding:8px 12px;">' + (l.Description || '-') + '</td><td style="padding:8px 12px;text-align:center;">' + (d.Qty || 1) + '</td><td style="padding:8px 12px;text-align:right;">$' + (d.UnitPrice || 0).toFixed(2) + '</td><td style="padding:8px 12px;text-align:right;font-weight:600;">$' + (l.Amount || 0).toFixed(2) + '</td></tr>';
    }).join('');

    const html = '<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;">' +
      '<div style="background:#191917;padding:20px 24px;border-bottom:3px solid #b8ae97;"><table width="100%"><tr><td><img src="https://www.3notchcabinets.com/logo-transparent.png" height="50"></td><td style="text-align:right;color:#b8ae97;font-size:11px;">3 Notch Cabinet Co<br>1213 Dr MLK Jr Expy, Andalusia, AL 36420<br></td></tr></table></div>' +
      '<div style="padding:24px;background:#fff;">' +
      '<h2 style="color:#b8ae97;margin:0 0 16px;">Estimate #' + docNum + '</h2>' +
      '<table width="100%" style="margin-bottom:20px;"><tr><td style="width:50%;vertical-align:top;"><div style="background:#f5f3ef;border-left:3px solid #b8ae97;padding:10px 14px;font-size:13px;"><strong style="color:#b8ae97;">Prepared For</strong><br>' + custName + '</div></td><td style="width:50%;vertical-align:top;padding-left:10px;"><div style="background:#f5f3ef;border-left:3px solid #b8ae97;padding:10px 14px;font-size:13px;"><strong style="color:#b8ae97;">Details</strong><br>Estimate #' + docNum + '<br>Date: ' + (estimate.TxnDate || '') + (expDate ? '<br>Valid Until: ' + expDate : '') + '</div></td></tr></table>' +
      '<table width="100%" style="border-collapse:collapse;font-size:13px;"><tr><th style="background:#191917;color:#b8ae97;padding:8px 12px;text-align:left;">Description</th><th style="background:#191917;color:#b8ae97;padding:8px 12px;text-align:center;">Qty</th><th style="background:#191917;color:#b8ae97;padding:8px 12px;text-align:right;">Rate</th><th style="background:#191917;color:#b8ae97;padding:8px 12px;text-align:right;">Amount</th></tr>' + lineRows +
      '<tr style="border-top:2px solid #b8ae97;background:#f5f3ef;"><td colspan="3" style="padding:10px 12px;font-weight:700;font-size:15px;">Total</td><td style="padding:10px 12px;text-align:right;font-weight:700;font-size:15px;">$' + total.toFixed(2) + '</td></tr></table>' +
      (memo ? '<div style="margin-top:16px;padding:10px;background:#f5f3ef;border-left:3px solid #b8ae97;font-size:12px;">' + memo + '</div>' : '') +
      '<div style="text-align:center;margin-top:20px;padding-top:16px;border-top:1px solid #ddd;font-size:10px;color:#888;">3 Notch Cabinet Co &bull; 1213 Dr MLK Jr Expy, Andalusia, AL 36420 &bull;  &bull; 3notchcabinets.com</div>' +
      '</div></div>';

    // Send via Microsoft Graph API (same as BackTrace invoicing)
    const https = require('https');
    const querystring = require('querystring');

    // Get Graph token
    const graphToken = await new Promise((resolve, reject) => {
      const data = querystring.stringify({
        client_id: GRAPH_CLIENT,
        client_secret: GRAPH_SECRET,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials'
      });
      const req = https.request({
        hostname: 'login.microsoftonline.com',
        path: '/' + GRAPH_TENANT + '/oauth2/v2.0/token',
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': data.length }
      }, res => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => { try { resolve(JSON.parse(body).access_token); } catch { reject(new Error('Token failed')); } });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });

    // Send email via Graph
    const sender = 'brady@back-trace.com';
    const mail = {
      message: {
        subject: 'Estimate #' + docNum + ' from 3 Notch Cabinet Co — $' + total.toFixed(2),
        body: { contentType: 'HTML', content: html },
        toRecipients: [{ emailAddress: { address: email } }],
        bccRecipients: [{ emailAddress: { address: "braines@3notchcabinets.com" } }],
        from: { emailAddress: { address: sender, name: '3 Notch Cabinet Co' } }
      }
    };

    await new Promise((resolve, reject) => {
      const mailData = JSON.stringify(mail);
      const req = https.request({
        hostname: 'graph.microsoft.com',
        path: '/v1.0/users/' + sender + '/sendMail',
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + graphToken, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(mailData) }
      }, res => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => { res.statusCode === 202 ? resolve(true) : reject(new Error('Graph ' + res.statusCode + ': ' + body)); });
      });
      req.on('error', reject);
      req.write(mailData);
      req.end();
    });

    res.json({ ok: true, email, docNumber: docNum });
  } catch (e) {
    console.error('Estimate email error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// QB Get estimates
app.get('/api/qb/estimates', requireAuth, async (req, res) => {
  try {
    const result = await qbRequest('GET', "/query?query=SELECT * FROM Estimate ORDER BY TxnDate DESC MAXRESULTS 200&minorversion=73");
    const estimates = result.QueryResponse ? result.QueryResponse.Estimate || [] : [];
    res.json(estimates);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// QB Get payments
app.get('/api/qb/payments', requireAuth, async (req, res) => {
  try {
    const result = await qbRequest('GET', "/query?query=SELECT * FROM Payment ORDER BY TxnDate DESC MAXRESULTS 200&minorversion=73");
    const payments = result.QueryResponse ? result.QueryResponse.Payment || [] : [];
    res.json(payments);
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ====== ESTIMATE EMAIL & APPROVAL ======

// Generate approval token
function generateApprovalToken(jobId) {
  return crypto.createHash('sha256').update(jobId + '-' + Date.now() + '-3notch').digest('hex').substring(0, 32);
}

// Send estimate email with approval link
app.post('/api/jobs/:id/send-estimate', requireAuth, async (req, res) => {
  const jobId = req.params.id;
  db.get('SELECT j.*, c.name as customer_name, c.email as customer_email FROM jobs j LEFT JOIN customers c ON j.customer_id = c.id WHERE j.id = ?', [jobId], async (err, job) => {
    if (err || !job) return res.status(404).json({ error: 'Job not found' });

    const email = req.body.email || job.customer_email;
    if (!email) return res.status(400).json({ error: 'No email address' });

    // Generate approval token
    const token = generateApprovalToken(jobId.toString());
    db.run('UPDATE jobs SET approval_token = ? WHERE id = ?', [token, jobId]);

    // Get estimate items
    const items = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM estimate_items WHERE job_id = ? ORDER BY line_order', [jobId], (err, rows) => err ? reject(err) : resolve(rows || []));
    });

    const total = job.quoted_price || items.reduce((s, i) => s + (i.amount || 0), 0);
    const approveUrl = 'https://jobtracker.3notchcabinets.com/estimate/view/' + token;

    let lineRows = items.map((item, i) => {
      return '<tr style="background:' + (i % 2 ? '#f8f7f5' : '#fff') + '"><td style="padding:8px 12px;">' + (item.description || '') + '</td><td style="padding:8px 12px;text-align:center;">' + (item.quantity || 1) + '</td><td style="padding:8px 12px;text-align:right;">$' + (item.rate || 0).toFixed(2) + '</td><td style="padding:8px 12px;text-align:right;font-weight:600;">$' + (item.amount || 0).toFixed(2) + '</td></tr>';
    }).join('');

    if (items.length === 0) {
      lineRows = '<tr><td style="padding:8px 12px;">' + job.job_name + (job.job_color ? ' — ' + job.job_color : '') + '</td><td style="padding:8px 12px;text-align:center;">1</td><td style="padding:8px 12px;text-align:right;">$' + total.toFixed(2) + '</td><td style="padding:8px 12px;text-align:right;font-weight:600;">$' + total.toFixed(2) + '</td></tr>';
    }

    const html = '<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;">' +
      '<div style="background:#191917;padding:20px 24px;border-bottom:3px solid #b8ae97;"><table width="100%"><tr><td><img src="https://www.3notchcabinets.com/logo-transparent.png" height="50"></td><td style="text-align:right;color:#b8ae97;font-size:11px;">3 Notch Cabinet Co<br>1213 Dr MLK Jr Expy, Andalusia, AL 36420<br></td></tr></table></div>' +
      '<div style="padding:24px;background:#fff;">' +
      '<h2 style="color:#b8ae97;margin:0 0 16px;">Estimate ' + (job.estimate_number || '') + '</h2>' +
      '<table width="100%" style="margin-bottom:20px;"><tr><td style="width:50%;vertical-align:top;"><div style="background:#f5f3ef;border-left:3px solid #b8ae97;padding:10px 14px;font-size:13px;"><strong style="color:#b8ae97;">Prepared For</strong><br>' + (job.customer_name || '') + (job.job_address ? '<br>' + job.job_address : '') + '</div></td><td style="width:50%;vertical-align:top;padding-left:10px;"><div style="background:#f5f3ef;border-left:3px solid #b8ae97;padding:10px 14px;font-size:13px;"><strong style="color:#b8ae97;">Details</strong><br>Estimate: ' + (job.estimate_number || '') + '<br>Job: ' + job.job_name + (job.job_color ? '<br>Color: ' + job.job_color : '') + '</div></td></tr></table>' +
      '<table width="100%" style="border-collapse:collapse;font-size:13px;"><tr><th style="background:#191917;color:#b8ae97;padding:8px 12px;text-align:left;">Description</th><th style="background:#191917;color:#b8ae97;padding:8px 12px;text-align:center;">Qty</th><th style="background:#191917;color:#b8ae97;padding:8px 12px;text-align:right;">Rate</th><th style="background:#191917;color:#b8ae97;padding:8px 12px;text-align:right;">Amount</th></tr>' + lineRows +
      '<tr style="border-top:2px solid #b8ae97;background:#f5f3ef;"><td colspan="3" style="padding:10px 12px;font-weight:700;font-size:15px;">Total</td><td style="padding:10px 12px;text-align:right;font-weight:700;font-size:15px;">$' + total.toFixed(2) + '</td></tr></table>' +
      '<div style="text-align:center;margin:24px 0;"><a href="' + approveUrl + '" style="display:inline-block;padding:14px 40px;background:#b8ae97;color:#191917;text-decoration:none;border-radius:6px;font-weight:700;font-size:16px;">View & Approve Estimate</a></div>' +
      '<div style="font-size:12px;color:#888;text-align:center;">Or copy this link: ' + approveUrl + '</div>' +
      '<div style="text-align:center;margin-top:20px;padding-top:16px;border-top:1px solid #ddd;font-size:10px;color:#888;">3 Notch Cabinet Co &bull; 1213 Dr MLK Jr Expy, Andalusia, AL 36420 &bull; </div>' +
      '</div></div>';

    // Send via Graph API with retry
    try {
      const subject = 'Estimate ' + (job.estimate_number || '') + ' from 3 Notch Cabinet Co — $' + total.toFixed(2);
      await sendGraphEmail(email, subject, html);
      res.json({ ok: true, email, token });
    } catch (e) {
      console.error('Estimate email error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });
});

// Public estimate view page (no auth required)
app.get('/estimate/view/:token', (req, res) => {
  db.get('SELECT j.*, c.name as customer_name, c.email as customer_email FROM jobs j LEFT JOIN customers c ON j.customer_id = c.id WHERE j.approval_token = ?', [req.params.token], (err, job) => {
    if (err || !job) return res.status(404).send('<html><body style="font-family:Arial;text-align:center;padding:50px;"><h2>Estimate not found</h2></body></html>');

    db.all('SELECT * FROM estimate_items WHERE job_id = ? ORDER BY line_order', [job.id], (err, items) => {
      items = items || [];
      const total = job.quoted_price || items.reduce((s, i) => s + (i.amount || 0), 0);
      const isApproved = job.estimate_approved === 1;

      let lineRows = items.map((item, i) => {
        return '<tr style="background:' + (i % 2 ? '#f8f7f5' : '#fff') + '"><td style="padding:10px 14px;">' + (item.description || '') + '</td><td style="padding:10px 14px;text-align:center;">' + (item.quantity || 1) + '</td><td style="padding:10px 14px;text-align:right;">$' + (item.rate || 0).toFixed(2) + '</td><td style="padding:10px 14px;text-align:right;font-weight:600;">$' + (item.amount || 0).toFixed(2) + '</td></tr>';
      }).join('');

      if (items.length === 0) {
        lineRows = '<tr><td style="padding:10px 14px;">' + job.job_name + (job.job_color ? ' — ' + job.job_color : '') + '</td><td style="padding:10px 14px;text-align:center;">1</td><td style="padding:10px 14px;text-align:right;">$' + total.toFixed(2) + '</td><td style="padding:10px 14px;text-align:right;font-weight:600;">$' + total.toFixed(2) + '</td></tr>';
      }

      const approveBtn = isApproved
        ? '<div style="text-align:center;margin:24px 0;padding:16px;background:#dcfce7;border-radius:8px;"><span style="font-size:20px;font-weight:700;color:#166534;">&#10003; Estimate Approved</span><br><span style="font-size:12px;color:#166534;">Approved on ' + (job.estimate_approved_date || '') + '</span></div>'
        : '<div style="text-align:center;margin:24px 0;"><form method="POST" action="/estimate/approve/' + req.params.token + '"><button type="submit" style="padding:16px 48px;background:#b8ae97;color:#191917;border:none;border-radius:8px;font-size:18px;font-weight:700;cursor:pointer;">Approve Estimate — $' + total.toFixed(2) + '</button></form><p style="font-size:12px;color:#888;margin-top:8px;">By clicking approve, you agree to the terms of this estimate.</p></div>';

      res.send('<!DOCTYPE html><html><head><title>Estimate ' + (job.estimate_number || '') + ' — 3 Notch Cabinet Co</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f4f3f1;font-family:Arial,sans-serif;">' +
        '<div style="max-width:700px;margin:0 auto;background:#fff;box-shadow:0 2px 20px rgba(0,0,0,0.1);">' +
        '<div style="background:#191917;padding:24px 30px;border-bottom:3px solid #b8ae97;"><table width="100%"><tr><td><img src="https://www.3notchcabinets.com/logo-transparent.png" height="55"></td><td style="text-align:right;color:#b8ae97;font-size:12px;">3 Notch Cabinet Co<br>1213 Dr MLK Jr Expy, Andalusia, AL 36420<br></td></tr></table></div>' +
        '<div style="padding:30px;">' +
        '<h1 style="color:#b8ae97;margin:0 0 20px;font-size:24px;">Estimate ' + (job.estimate_number || '') + '</h1>' +
        '<table width="100%" style="margin-bottom:24px;"><tr><td style="width:50%;vertical-align:top;"><div style="background:#f5f3ef;border-left:3px solid #b8ae97;padding:12px 16px;font-size:14px;"><strong style="color:#b8ae97;">Prepared For</strong><br>' + (job.customer_name || '') + (job.job_address ? '<br>' + job.job_address : '') + '</div></td><td style="width:50%;vertical-align:top;padding-left:12px;"><div style="background:#f5f3ef;border-left:3px solid #b8ae97;padding:12px 16px;font-size:14px;"><strong style="color:#b8ae97;">Details</strong><br>Estimate: ' + (job.estimate_number || '') + '<br>Job: ' + job.job_name + (job.job_color ? '<br>Color: ' + job.job_color : '') + '</div></td></tr></table>' +
        '<table width="100%" style="border-collapse:collapse;font-size:14px;"><tr><th style="background:#191917;color:#b8ae97;padding:10px 14px;text-align:left;">Description</th><th style="background:#191917;color:#b8ae97;padding:10px 14px;text-align:center;">Qty</th><th style="background:#191917;color:#b8ae97;padding:10px 14px;text-align:right;">Rate</th><th style="background:#191917;color:#b8ae97;padding:10px 14px;text-align:right;">Amount</th></tr>' + lineRows +
        '<tr style="border-top:3px solid #b8ae97;background:#f5f3ef;"><td colspan="3" style="padding:12px 14px;font-weight:700;font-size:18px;">Total</td><td style="padding:12px 14px;text-align:right;font-weight:700;font-size:18px;">$' + total.toFixed(2) + '</td></tr></table>' +
        approveBtn +
        '<div style="text-align:center;padding-top:20px;border-top:1px solid #ddd;font-size:10px;color:#888;">3 Notch Cabinet Co &bull; 1213 Dr MLK Jr Expy, Andalusia, AL 36420 &bull;  &bull; 3notchcabinets.com</div>' +
        '</div></div></body></html>');
    });
  });
});

// Approve estimate (public POST, no auth)
app.post('/estimate/approve/:token', async (req, res) => {
  db.get('SELECT j.*, c.name as customer_name, c.email as customer_email FROM jobs j LEFT JOIN customers c ON j.customer_id = c.id WHERE j.approval_token = ?', [req.params.token], async (err, job) => {
    if (err || !job) return res.status(404).send('Estimate not found');

    const approvedDate = new Date().toISOString().split('T')[0];
    // Stay in Quote/Estimate until deposit is paid
    db.run('UPDATE jobs SET estimate_approved = 1, estimate_approved_date = ? WHERE id = ?', [approvedDate, job.id]);

    // Update QB estimate status to Accepted
    let qbEstimate = null;
    if (qbTokens && qbRealmId) {
      try {
        await ensureQBToken();
        const estNum = (job.estimate_number || '').replace('EST-', '');
        const result = await qbRequest('GET', "/query?query=SELECT * FROM Estimate WHERE DocNumber = '" + estNum + "'&minorversion=73");
        const estimates = result.QueryResponse ? result.QueryResponse.Estimate || [] : [];
        if (estimates.length > 0) {
          qbEstimate = estimates[0];
          await qbRequest('POST', '/estimate?minorversion=73', {
            Id: qbEstimate.Id,
            SyncToken: qbEstimate.SyncToken,
            sparse: true,
            TxnStatus: 'Accepted'
          });
          console.log('QB estimate ' + estNum + ' marked as Accepted');
        }
      } catch (e) {
        console.error('QB estimate approve error:', e.message);
      }
    }

    // Auto-create 50% deposit invoice in QB
    let depositInvoice = null;
    if (qbTokens && qbRealmId && qbEstimate) {
      try {
        await ensureQBToken();
        const total = job.quoted_price || (qbEstimate.TotalAmt || 0);
        const depositAmt = Math.round(total * 50) / 100;
        const custRef = qbEstimate.CustomerRef;
        const custEmail = job.customer_email || job.job_email || (qbEstimate.BillEmail ? qbEstimate.BillEmail.Address : '');

        // Get next invoice number
        const invResult = await qbRequest('GET', "/query?query=SELECT DocNumber FROM Invoice ORDER BY MetaData.CreateTime DESC MAXRESULTS 1&minorversion=73");
        const invList = invResult.QueryResponse ? invResult.QueryResponse.Invoice || [] : [];
        let nextNum = '1001';
        if (invList.length > 0) {
          const lastNum = parseInt(invList[0].DocNumber || '0');
          if (!isNaN(lastNum)) nextNum = String(lastNum + 1);
        }

        // Build line items from estimate (at 50%)
        const estLines = (qbEstimate.Line || []).filter(l => l.DetailType === 'SalesItemLineDetail');
        let invoiceLines;
        if (estLines.length > 0) {
          invoiceLines = estLines.map(l => ({
            Amount: Math.round(l.Amount * 50) / 100,
            DetailType: 'SalesItemLineDetail',
            Description: (l.Description || '') + ' — 50% deposit',
            SalesItemLineDetail: {
              ItemRef: l.SalesItemLineDetail.ItemRef,
              UnitPrice: Math.round(l.SalesItemLineDetail.UnitPrice * 50) / 100,
              Qty: l.SalesItemLineDetail.Qty || 1
            }
          }));
        } else {
          invoiceLines = [{
            Amount: depositAmt,
            DetailType: 'SalesItemLineDetail',
            Description: job.job_name + ' — 50% deposit',
            SalesItemLineDetail: {
              ItemRef: { value: '1', name: 'Services' },
              UnitPrice: depositAmt,
              Qty: 1
            }
          }];
        }

        const dueDate = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];
        depositInvoice = await qbRequest('POST', '/invoice?minorversion=73', {
          DocNumber: nextNum,
          CustomerRef: custRef,
          DueDate: dueDate,
          BillEmail: custEmail ? { Address: custEmail } : undefined,
          AllowOnlineCreditCardPayment: true,
          AllowOnlineACHPayment: true,
          Line: invoiceLines,
          CustomerMemo: { value: '50% Deposit — ' + job.job_name + ' (' + (job.estimate_number || '') + ')' }
        });
        depositInvoice = depositInvoice.Invoice || depositInvoice;

        // Track on the local job
        db.run('UPDATE jobs SET first_invoice_sent = ?, first_invoice_amount = ? WHERE id = ?',
          [approvedDate, depositAmt, job.id]);

        console.log('Auto-created 50% deposit invoice #' + (depositInvoice.DocNumber || nextNum) + ' for $' + depositAmt.toFixed(2));

        // Email the invoice to customer via Graph
        if (custEmail && depositInvoice.Id) {
          try {
            const payLink = depositInvoice.InvoiceLink || '';
            const invHtml = '<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;">' +
              '<div style="background:#191917;padding:20px 24px;border-bottom:3px solid #b8ae97;"><table width="100%"><tr><td><img src="https://www.3notchcabinets.com/logo-transparent.png" height="50"></td><td style="text-align:right;color:#b8ae97;font-size:11px;">3 Notch Cabinet Co<br>1213 Dr MLK Jr Expy, Andalusia, AL 36420</td></tr></table></div>' +
              '<div style="padding:24px;background:#fff;">' +
              '<h2 style="color:#b8ae97;margin:0 0 8px;">Invoice #' + (depositInvoice.DocNumber || '') + '</h2>' +
              '<p style="color:#666;font-size:13px;margin:0 0 16px;">Thank you for approving your estimate! Here is your 50% deposit invoice to get started.</p>' +
              '<div style="background:#f5f3ef;border-left:3px solid #b8ae97;padding:12px 16px;margin-bottom:16px;font-size:13px;">' +
              '<strong>Job:</strong> ' + job.job_name + '<br>' +
              '<strong>Estimate:</strong> ' + (job.estimate_number || '') + '<br>' +
              '<strong>Deposit Amount:</strong> $' + depositAmt.toFixed(2) + '<br>' +
              '<strong>Due:</strong> ' + dueDate +
              '</div>' +
              (payLink ? '<div style="text-align:center;margin:24px 0;"><a href="' + payLink + '" style="display:inline-block;padding:14px 40px;background:#b8ae97;color:#191917;text-decoration:none;border-radius:6px;font-weight:700;font-size:16px;">Pay Invoice Online</a></div>' : '') +
              '<div style="text-align:center;margin-top:20px;padding-top:16px;border-top:1px solid #ddd;font-size:10px;color:#888;">3 Notch Cabinet Co &bull; 1213 Dr MLK Jr Expy, Andalusia, AL 36420 &bull; 3notchcabinets.com</div>' +
              '</div></div>';
            const invSubject = 'Invoice #' + (depositInvoice.DocNumber || '') + ' from 3 Notch Cabinet Co — $' + depositAmt.toFixed(2) + ' deposit';
            await sendGraphEmail(custEmail, invSubject, invHtml);
            console.log('Deposit invoice emailed to ' + custEmail);
          } catch (e) {
            console.error('Deposit invoice email error:', e.message);
          }
        }
      } catch (e) {
        console.error('Auto deposit invoice error:', e.message);
      }
    }

    // Notify via socket
    io.emit('estimate-approved', { jobId: job.id, jobName: job.job_name, estimateNumber: job.estimate_number });

    // Send approval notification to sales@3notchcabinets.com
    try {
      const custName = job.customer_name || job.job_name;
      const total = job.quoted_price || 0;
      const depositAmt = Math.round(total * 50) / 100;
      const notifyHtml = '<div style="max-width:500px;margin:0 auto;font-family:Arial,sans-serif;">' +
        '<div style="background:#191917;padding:16px 20px;border-bottom:3px solid #b8ae97;text-align:center;"><span style="color:#b8ae97;font-size:18px;font-weight:700;">3 Notch Cabinet Co</span></div>' +
        '<div style="padding:24px;background:#fff;">' +
        '<div style="text-align:center;margin-bottom:16px;"><span style="font-size:48px;color:#4CAF50;">&#10003;</span></div>' +
        '<h2 style="text-align:center;color:#191917;margin:0 0 12px;">Estimate Approved!</h2>' +
        '<div style="background:#f5f3ef;border-left:3px solid #b8ae97;padding:12px 16px;margin-bottom:16px;">' +
        '<strong>Estimate:</strong> ' + (job.estimate_number || '') + '<br>' +
        '<strong>Customer:</strong> ' + custName + '<br>' +
        '<strong>Job:</strong> ' + job.job_name + '<br>' +
        '<strong>Total:</strong> $' + total.toLocaleString() + '<br>' +
        '<strong>Deposit Invoice:</strong> ' + (depositInvoice ? '#' + depositInvoice.DocNumber + ' — $' + depositAmt.toFixed(2) : 'Not created') + '<br>' +
        '<strong>Approved:</strong> ' + approvedDate +
        '</div>' +
        '<p style="color:#666;font-size:13px;">The customer has been sent a 50% deposit invoice. Job will move to production once deposit is paid.</p>' +
        '</div></div>';
      const subject = 'APPROVED: Estimate ' + (job.estimate_number || '') + ' — ' + custName + ' — $' + total.toLocaleString();
      await sendGraphEmail('sales@3notchcabinets.com', subject, notifyHtml);
      console.log('Approval notification sent to sales@3notchcabinets.com');
    } catch (e) {
      console.error('Approval notification email error:', e.message);
    }

    res.send('<!DOCTYPE html><html><head><title>Estimate Approved</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f4f3f1;font-family:Arial,sans-serif;"><div style="max-width:500px;margin:60px auto;background:#fff;padding:40px;border-radius:12px;text-align:center;box-shadow:0 2px 20px rgba(0,0,0,0.1);"><div style="font-size:60px;color:#b8ae97;">&#10003;</div><h1 style="color:#191917;margin:10px 0;">Estimate Approved!</h1><p style="color:#666;font-size:16px;">Thank you for approving estimate ' + (job.estimate_number || '') + ' for <strong>' + job.job_name + '</strong>.</p><p style="color:#666;">A 50% deposit invoice has been sent to your email. Once payment is received, we\'ll begin production on your project.</p><div style="margin-top:20px;padding-top:20px;border-top:1px solid #ddd;font-size:12px;color:#888;">3 Notch Cabinet Co &bull; 1213 Dr MLK Jr Expy, Andalusia, AL 36420 &bull; 3notchcabinets.com</div></div></body></html>');
  });
});


// Public estimate view page (no auth required)
app.get('/estimate/view/:token', (req, res) => {
  db.get('SELECT j.*, c.name as customer_name, c.email as customer_email FROM jobs j LEFT JOIN customers c ON j.customer_id = c.id WHERE j.approval_token = ?', [req.params.token], (err, job) => {
    if (err || !job) return res.status(404).send('<html><body style="font-family:Arial;text-align:center;padding:50px;"><h2>Estimate not found</h2></body></html>');

    db.all('SELECT * FROM estimate_items WHERE job_id = ? ORDER BY line_order', [job.id], (err, items) => {
      items = items || [];
      const total = job.quoted_price || items.reduce((s, i) => s + (i.amount || 0), 0);
      const isApproved = job.estimate_approved === 1;

      let lineRows = items.map((item, i) => {
        return '<tr style="background:' + (i % 2 ? '#f8f7f5' : '#fff') + '"><td style="padding:10px 14px;">' + (item.description || '') + '</td><td style="padding:10px 14px;text-align:center;">' + (item.quantity || 1) + '</td><td style="padding:10px 14px;text-align:right;">$' + (item.rate || 0).toFixed(2) + '</td><td style="padding:10px 14px;text-align:right;font-weight:600;">$' + (item.amount || 0).toFixed(2) + '</td></tr>';
      }).join('');

      if (items.length === 0) {
        lineRows = '<tr><td style="padding:10px 14px;">' + job.job_name + (job.job_color ? ' — ' + job.job_color : '') + '</td><td style="padding:10px 14px;text-align:center;">1</td><td style="padding:10px 14px;text-align:right;">$' + total.toFixed(2) + '</td><td style="padding:10px 14px;text-align:right;font-weight:600;">$' + total.toFixed(2) + '</td></tr>';
      }

      const approveBtn = isApproved
        ? '<div style="text-align:center;margin:24px 0;padding:16px;background:#dcfce7;border-radius:8px;"><span style="font-size:20px;font-weight:700;color:#166534;">&#10003; Estimate Approved</span><br><span style="font-size:12px;color:#166534;">Approved on ' + (job.estimate_approved_date || '') + '</span></div>'
        : '<div style="text-align:center;margin:24px 0;"><form method="POST" action="/estimate/approve/' + req.params.token + '"><button type="submit" style="padding:16px 48px;background:#b8ae97;color:#191917;border:none;border-radius:8px;font-size:18px;font-weight:700;cursor:pointer;">Approve Estimate — $' + total.toFixed(2) + '</button></form><p style="font-size:12px;color:#888;margin-top:8px;">By clicking approve, you agree to the terms of this estimate.</p></div>';

      res.send('<!DOCTYPE html><html><head><title>Estimate ' + (job.estimate_number || '') + ' — 3 Notch Cabinet Co</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f4f3f1;font-family:Arial,sans-serif;">' +
        '<div style="max-width:700px;margin:0 auto;background:#fff;box-shadow:0 2px 20px rgba(0,0,0,0.1);">' +
        '<div style="background:#191917;padding:24px 30px;border-bottom:3px solid #b8ae97;"><table width="100%"><tr><td><img src="https://www.3notchcabinets.com/logo-transparent.png" height="55"></td><td style="text-align:right;color:#b8ae97;font-size:12px;">3 Notch Cabinet Co<br>1213 Dr MLK Jr Expy, Andalusia, AL 36420<br></td></tr></table></div>' +
        '<div style="padding:30px;">' +
        '<h1 style="color:#b8ae97;margin:0 0 20px;font-size:24px;">Estimate ' + (job.estimate_number || '') + '</h1>' +
        '<table width="100%" style="margin-bottom:24px;"><tr><td style="width:50%;vertical-align:top;"><div style="background:#f5f3ef;border-left:3px solid #b8ae97;padding:12px 16px;font-size:14px;"><strong style="color:#b8ae97;">Prepared For</strong><br>' + (job.customer_name || '') + (job.job_address ? '<br>' + job.job_address : '') + '</div></td><td style="width:50%;vertical-align:top;padding-left:12px;"><div style="background:#f5f3ef;border-left:3px solid #b8ae97;padding:12px 16px;font-size:14px;"><strong style="color:#b8ae97;">Details</strong><br>Estimate: ' + (job.estimate_number || '') + '<br>Job: ' + job.job_name + (job.job_color ? '<br>Color: ' + job.job_color : '') + '</div></td></tr></table>' +
        '<table width="100%" style="border-collapse:collapse;font-size:14px;"><tr><th style="background:#191917;color:#b8ae97;padding:10px 14px;text-align:left;">Description</th><th style="background:#191917;color:#b8ae97;padding:10px 14px;text-align:center;">Qty</th><th style="background:#191917;color:#b8ae97;padding:10px 14px;text-align:right;">Rate</th><th style="background:#191917;color:#b8ae97;padding:10px 14px;text-align:right;">Amount</th></tr>' + lineRows +
        '<tr style="border-top:3px solid #b8ae97;background:#f5f3ef;"><td colspan="3" style="padding:12px 14px;font-weight:700;font-size:18px;">Total</td><td style="padding:12px 14px;text-align:right;font-weight:700;font-size:18px;">$' + total.toFixed(2) + '</td></tr></table>' +
        approveBtn +
        '<div style="text-align:center;padding-top:20px;border-top:1px solid #ddd;font-size:10px;color:#888;">3 Notch Cabinet Co &bull; 1213 Dr MLK Jr Expy, Andalusia, AL 36420 &bull;  &bull; 3notchcabinets.com</div>' +
        '</div></div></body></html>');
    });
  });
});

// Approve estimate (public POST, no auth)
app.post('/estimate/approve/:token', async (req, res) => {
  db.get('SELECT * FROM jobs WHERE approval_token = ?', [req.params.token], async (err, job) => {
    if (err || !job) return res.status(404).send('Estimate not found');

    const approvedDate = new Date().toISOString().split('T')[0];
    db.run('UPDATE jobs SET estimate_approved = 1, estimate_approved_date = ?, stage = ? WHERE id = ?', [approvedDate, 'Ready to Cut', job.id]);

    // Update QB estimate status to Accepted
    if (qbTokens && qbRealmId) {
      try {
        await ensureQBToken();
        // Find the QB estimate by DocNumber
        const estNum = (job.estimate_number || '').replace('EST-', '');
        const result = await qbRequest('GET', "/query?query=SELECT * FROM Estimate WHERE DocNumber = '" + estNum + "'&minorversion=73");
        const estimates = result.QueryResponse ? result.QueryResponse.Estimate || [] : [];
        if (estimates.length > 0) {
          const est = estimates[0];
          await qbRequest('POST', '/estimate?minorversion=73', {
            Id: est.Id,
            SyncToken: est.SyncToken,
            sparse: true,
            TxnStatus: 'Accepted'
          });
          console.log('QB estimate ' + estNum + ' marked as Accepted');
        }
      } catch (e) {
        console.error('QB estimate approve error:', e.message);
      }
    }

    // Notify via socket
    io.emit('estimate-approved', { jobId: job.id, jobName: job.job_name, estimateNumber: job.estimate_number });

    // Send approval notification to sales@3notchcabinets.com
    try {
      const custName = job.customer_name || job.job_name;
      const total = job.quoted_price || 0;
      const notifyHtml = '<div style="max-width:500px;margin:0 auto;font-family:Arial,sans-serif;">' +
        '<div style="background:#191917;padding:16px 20px;border-bottom:3px solid #b8ae97;text-align:center;"><span style="color:#b8ae97;font-size:18px;font-weight:700;">3 Notch Cabinet Co</span></div>' +
        '<div style="padding:24px;background:#fff;">' +
        '<div style="text-align:center;margin-bottom:16px;"><span style="font-size:48px;color:#4CAF50;">&#10003;</span></div>' +
        '<h2 style="text-align:center;color:#191917;margin:0 0 12px;">Estimate Approved!</h2>' +
        '<div style="background:#f5f3ef;border-left:3px solid #b8ae97;padding:12px 16px;margin-bottom:16px;">' +
        '<strong>Estimate:</strong> ' + (job.estimate_number || '') + '<br>' +
        '<strong>Customer:</strong> ' + custName + '<br>' +
        '<strong>Job:</strong> ' + job.job_name + '<br>' +
        '<strong>Amount:</strong> $' + total.toLocaleString() + '<br>' +
        '<strong>Approved:</strong> ' + approvedDate +
        '</div>' +
        '<p style="color:#666;font-size:13px;">The customer has approved this estimate. You can now proceed with scheduling and progressive invoicing.</p>' +
        '</div></div>';
      const subject = 'APPROVED: Estimate ' + (job.estimate_number || '') + ' — ' + custName + ' — $' + total.toLocaleString();
      await sendGraphEmail('sales@3notchcabinets.com', subject, notifyHtml);
      console.log('Approval notification sent to sales@3notchcabinets.com');
    } catch (e) {
      console.error('Approval notification email error:', e.message);
    }

    res.send('<!DOCTYPE html><html><head><title>Estimate Approved</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f4f3f1;font-family:Arial,sans-serif;"><div style="max-width:500px;margin:60px auto;background:#fff;padding:40px;border-radius:12px;text-align:center;box-shadow:0 2px 20px rgba(0,0,0,0.1);"><div style="font-size:60px;color:#b8ae97;">&#10003;</div><h1 style="color:#191917;margin:10px 0;">Estimate Approved!</h1><p style="color:#666;font-size:16px;">Thank you for approving estimate ' + (job.estimate_number || '') + ' for <strong>' + job.job_name + '</strong>.</p><p style="color:#666;">3 Notch Cabinet Co will be in touch to schedule your project.</p><div style="margin-top:20px;padding-top:20px;border-top:1px solid #ddd;font-size:12px;color:#888;">3 Notch Cabinet Co &bull; </div></div></body></html>');
  });
});


// Invoice email via Graph API (fallback for broken QB send)
app.post('/api/qb/invoices/:id/send-email-graph', requireAuth, async (req, res) => {
  try {
    await ensureQBToken();
    const inv = await qbRequest('GET', '/invoice/' + req.params.id + '?minorversion=73');
    const invoice = inv.Invoice || inv;
    if (!invoice || !invoice.Id) return res.status(404).json({ error: 'Invoice not found in QB' });

    const email = req.body.email || (invoice.BillEmail ? invoice.BillEmail.Address : '');
    if (!email) return res.status(400).json({ error: 'No email address' });

    const custName = invoice.CustomerRef ? invoice.CustomerRef.name : 'Customer';
    const total = invoice.TotalAmt || 0;
    const balance = invoice.Balance || 0;
    const dueDate = invoice.DueDate || '';
    const docNum = invoice.DocNumber || invoice.Id;
    const memo = invoice.CustomerMemo ? invoice.CustomerMemo.value : '';
    const payLink = invoice.InvoiceLink || '';

    let lineRows = (invoice.Line || []).filter(l => l.DetailType === 'SalesItemLineDetail').map((l, i) => {
      const d = l.SalesItemLineDetail || {};
      const itemName = d.ItemRef ? d.ItemRef.name : '';
      return '<tr style="background:' + (i % 2 ? '#f8f7f5' : '#fff') + '">' +
        '<td style="padding:8px 12px;">' + (l.Description || itemName) + '</td>' +
        '<td style="padding:8px 12px;text-align:center;">' + (d.Qty || 1) + '</td>' +
        '<td style="padding:8px 12px;text-align:right;">$' + (d.UnitPrice || 0).toFixed(2) + '</td>' +
        '<td style="padding:8px 12px;text-align:right;font-weight:600;">$' + (l.Amount || 0).toFixed(2) + '</td></tr>';
    }).join('');

    const addrParts = [];
    if (invoice.BillAddr) {
      if (invoice.BillAddr.Line1) addrParts.push(invoice.BillAddr.Line1);
      if (invoice.BillAddr.City) addrParts.push(invoice.BillAddr.City);
      if (invoice.BillAddr.CountrySubDivisionCode) addrParts.push(invoice.BillAddr.CountrySubDivisionCode);
    }

    const html = '<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;">' +
      '<div style="background:#191917;padding:20px 24px;border-bottom:3px solid #b8ae97;">' +
      '<table width="100%"><tr>' +
      '<td><img src="https://www.3notchcabinets.com/logo-transparent.png" height="50"></td>' +
      '<td style="text-align:right;color:#b8ae97;font-size:11px;">3 Notch Cabinet Co<br>1213 Dr MLK Jr Expy, Andalusia, AL 36420</td>' +
      '</tr></table></div>' +
      '<div style="padding:24px;background:#fff;">' +
      '<h2 style="color:#b8ae97;margin:0 0 16px;">Invoice #' + docNum + '</h2>' +
      '<table width="100%" style="margin-bottom:20px;"><tr>' +
      '<td style="width:50%;vertical-align:top;">' +
      '<div style="background:#f5f3ef;border-left:3px solid #b8ae97;padding:10px 14px;font-size:13px;">' +
      '<strong style="color:#b8ae97;">Bill To</strong><br>' + custName +
      (addrParts.length > 0 ? '<br>' + addrParts.join(', ') : '') +
      '</div></td>' +
      '<td style="width:50%;vertical-align:top;padding-left:10px;">' +
      '<div style="background:#f5f3ef;border-left:3px solid #b8ae97;padding:10px 14px;font-size:13px;">' +
      '<strong style="color:#b8ae97;">Details</strong><br>' +
      'Invoice #: ' + docNum + '<br>' +
      'Date: ' + (invoice.TxnDate || '') + '<br>' +
      'Due: ' + dueDate +
      '</div></td></tr></table>' +
      '<table width="100%" style="border-collapse:collapse;font-size:13px;">' +
      '<tr><th style="background:#191917;color:#b8ae97;padding:8px 12px;text-align:left;">Description</th>' +
      '<th style="background:#191917;color:#b8ae97;padding:8px 12px;text-align:center;">Qty</th>' +
      '<th style="background:#191917;color:#b8ae97;padding:8px 12px;text-align:right;">Rate</th>' +
      '<th style="background:#191917;color:#b8ae97;padding:8px 12px;text-align:right;">Amount</th></tr>' +
      lineRows +
      '<tr style="border-top:2px solid #b8ae97;background:#f5f3ef;">' +
      '<td colspan="3" style="padding:10px 12px;font-weight:700;font-size:15px;">Balance Due</td>' +
      '<td style="padding:10px 12px;text-align:right;font-weight:700;font-size:15px;">$' + balance.toFixed(2) + '</td></tr></table>' +
      (memo ? '<div style="background:#f5f3ef;border-left:3px solid #b8ae97;padding:8px 14px;margin:16px 0;font-size:12px;">' + memo + '</div>' : '') +
      (payLink ? '<div style="text-align:center;margin:24px 0;"><a href="' + payLink + '" style="display:inline-block;padding:14px 40px;background:#b8ae97;color:#191917;text-decoration:none;border-radius:6px;font-weight:700;font-size:16px;">Pay Invoice Online</a></div>' : '') +
      '<div style="text-align:center;margin-top:20px;padding-top:16px;border-top:1px solid #ddd;font-size:10px;color:#888;">3 Notch Cabinet Co &bull; 1213 Dr MLK Jr Expy, Andalusia, AL 36420 &bull; 3notchcabinets.com</div>' +
      '</div></div>';

    const https = require('https');
    const querystring = require('querystring');
    const graphData = querystring.stringify({
      client_id: GRAPH_CLIENT,
      client_secret: GRAPH_SECRET,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials'
    });
    const graphToken = await new Promise((resolve, reject) => {
      const tokenReq = https.request({
        hostname: 'login.microsoftonline.com',
        path: '/' + GRAPH_TENANT + '/oauth2/v2.0/token',
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': graphData.length }
      }, tokenRes => {
        let body = '';
        tokenRes.on('data', d => body += d);
        tokenRes.on('end', () => { try { resolve(JSON.parse(body).access_token); } catch { reject(new Error('Token failed')); } });
      });
      tokenReq.on('error', reject);
      tokenReq.write(graphData);
      tokenReq.end();
    });

    const mail = {
      message: {
        subject: 'Invoice #' + docNum + ' from 3 Notch Cabinet Co — $' + balance.toFixed(2),
        body: { contentType: 'HTML', content: html },
        toRecipients: [{ emailAddress: { address: email } }],
        bccRecipients: [{ emailAddress: { address: "braines@3notchcabinets.com" } }],
        from: { emailAddress: { address: 'sales@3notchcabinets.com', name: '3 Notch Cabinet Co' } }
      }
    };
    const mailData = JSON.stringify(mail);
    await new Promise((resolve, reject) => {
      const mailReq = https.request({
        hostname: 'graph.microsoft.com',
        path: '/v1.0/users/sales@3notchcabinets.com/sendMail',
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + graphToken, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(mailData) }
      }, mailRes => {
        let body = '';
        mailRes.on('data', d => body += d);
        mailRes.on('end', () => { mailRes.statusCode === 202 ? resolve(true) : reject(new Error('Graph ' + mailRes.statusCode + ': ' + body)); });
      });
      mailReq.on('error', reject);
      mailReq.write(mailData);
      mailReq.end();
    });

    console.log('Invoice #' + docNum + ' email sent to ' + email + ' via Graph API');
    res.json({ ok: true, email });
  } catch (e) {
    console.error('Invoice email error:', e.message);
    res.status(500).json({ error: e.message });
  }
});



// QB generic operation (void, delete)
app.post('/api/qb/operation', requireAuth, async (req, res) => {
  try {
    const { entity, operation, body } = req.body;
    const result = await qbRequest('POST', '/' + entity + '?operation=' + operation + '&minorversion=73', body);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// QB Dashboard summary - financial overview
app.get('/api/qb/dashboard', requireAuth, async (req, res) => {
  try {
    await ensureQBToken();

    // Parallel fetch: invoices, estimates, payments, accounts, P&L report
    const [invResult, estResult, payResult, acctResult, plResult] = await Promise.all([
      qbRequest('GET', '/query?query=SELECT * FROM Invoice ORDER BY TxnDate DESC MAXRESULTS 500&minorversion=73').catch(() => ({})),
      qbRequest('GET', '/query?query=SELECT * FROM Estimate ORDER BY TxnDate DESC MAXRESULTS 200&minorversion=73').catch(() => ({})),
      qbRequest('GET', '/query?query=SELECT * FROM Payment ORDER BY TxnDate DESC MAXRESULTS 200&minorversion=73').catch(() => ({})),
      qbRequest('GET', '/query?query=SELECT * FROM Account WHERE AccountType IN (\'Bank\', \'Credit Card\') AND Active = true&minorversion=73').catch(() => ({})),
      qbRequest('GET', '/reports/ProfitAndLoss?start_date=' + new Date().getFullYear() + '-01-01&end_date=' + new Date().toISOString().split('T')[0] + '&minorversion=73').catch(() => ({}))
    ]);

    const invoices = invResult.QueryResponse ? invResult.QueryResponse.Invoice || [] : [];
    const estimates = estResult.QueryResponse ? estResult.QueryResponse.Estimate || [] : [];
    const payments = payResult.QueryResponse ? payResult.QueryResponse.Payment || [] : [];
    const accounts = acctResult.QueryResponse ? acctResult.QueryResponse.Account || [] : [];

    // Invoice stats
    const today = new Date().toISOString().split('T')[0];
    const totalInvoiced = invoices.reduce((s, i) => s + (i.TotalAmt || 0), 0);
    const totalOutstanding = invoices.reduce((s, i) => s + (i.Balance || 0), 0);
    const collected = totalInvoiced - totalOutstanding;
    const openInvoices = invoices.filter(i => i.Balance > 0);
    const overdueInvoices = openInvoices.filter(i => i.DueDate && i.DueDate < today);
    const overdueAmount = overdueInvoices.reduce((s, i) => s + (i.Balance || 0), 0);

    // Invoice aging buckets
    const now = new Date();
    let current = 0, days30 = 0, days60 = 0, days90 = 0, over90 = 0;
    for (const inv of openInvoices) {
      const due = inv.DueDate ? new Date(inv.DueDate) : now;
      const daysOld = Math.floor((now - due) / 86400000);
      const bal = inv.Balance || 0;
      if (daysOld <= 0) current += bal;
      else if (daysOld <= 30) days30 += bal;
      else if (daysOld <= 60) days60 += bal;
      else if (daysOld <= 90) days90 += bal;
      else over90 += bal;
    }

    // Estimate stats
    const pendingEstimates = estimates.filter(e => e.TxnStatus === 'Pending');
    const acceptedEstimates = estimates.filter(e => e.TxnStatus === 'Accepted');
    const pendingValue = pendingEstimates.reduce((s, e) => s + (e.TotalAmt || 0), 0);
    const acceptedValue = acceptedEstimates.reduce((s, e) => s + (e.TotalAmt || 0), 0);

    // Recent payments (last 30 days)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0];
    const recentPayments = payments.filter(p => p.TxnDate >= thirtyDaysAgo);
    const recentPaymentTotal = recentPayments.reduce((s, p) => s + (p.TotalAmt || 0), 0);

    // Bank accounts
    const bankAccounts = accounts.map(a => ({
      name: a.Name,
      type: a.AccountType,
      subtype: a.AccountSubType,
      balance: a.CurrentBalance || 0
    }));
    const totalBankBalance = bankAccounts.filter(a => a.type === 'Bank').reduce((s, a) => s + a.balance, 0);
    const totalCreditBalance = bankAccounts.filter(a => a.type === 'Credit Card').reduce((s, a) => s + a.balance, 0);

    // P&L summary
    let plSummary = { income: 0, expenses: 0, netIncome: 0 };
    if (plResult && plResult.Rows) {
      try {
        for (const row of plResult.Rows.Row || []) {
          if (row.Summary && row.group === 'Income') {
            const val = row.Summary.ColData ? parseFloat(row.Summary.ColData[1].value || 0) : 0;
            plSummary.income = val;
          }
          if (row.Summary && row.group === 'Expenses') {
            const val = row.Summary.ColData ? parseFloat(row.Summary.ColData[1].value || 0) : 0;
            plSummary.expenses = val;
          }
          if (row.Summary && row.group === 'NetIncome') {
            const val = row.Summary.ColData ? parseFloat(row.Summary.ColData[1].value || 0) : 0;
            plSummary.netIncome = val;
          }
        }
      } catch (e) { console.error('P&L parse error:', e.message); }
    }

    // This month's revenue
    const monthStart = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01';
    const thisMonthInvoiced = invoices.filter(i => i.TxnDate >= monthStart).reduce((s, i) => s + (i.TotalAmt || 0), 0);
    const thisMonthCollected = payments.filter(p => p.TxnDate >= monthStart).reduce((s, p) => s + (p.TotalAmt || 0), 0);

    res.json({
      invoices: {
        total: invoices.length,
        totalInvoiced,
        collected,
        outstanding: totalOutstanding,
        openCount: openInvoices.length,
        overdueCount: overdueInvoices.length,
        overdueAmount,
        paidCount: invoices.filter(i => i.Balance === 0).length
      },
      aging: { current, days30, days60, days90, over90 },
      estimates: {
        total: estimates.length,
        pending: pendingEstimates.length,
        pendingValue,
        accepted: acceptedEstimates.length,
        acceptedValue
      },
      payments: {
        last30Days: recentPayments.length,
        last30DaysTotal: recentPaymentTotal
      },
      bank: {
        accounts: bankAccounts,
        totalBank: totalBankBalance,
        totalCredit: totalCreditBalance
      },
      profitLoss: plSummary,
      thisMonth: {
        invoiced: thisMonthInvoiced,
        collected: thisMonthCollected
      },
      recentPayments: recentPayments.slice(0, 10).map(p => ({
        date: p.TxnDate,
        amount: p.TotalAmt,
        customer: p.CustomerRef ? p.CustomerRef.name : ''
      }))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// Temp: full bank account query
app.get('/api/qb/bank-accounts', requireAuth, async (req, res) => {
  try {
    const result = await qbRequest('GET', "/query?query=SELECT * FROM Account WHERE AccountType = 'Bank' AND Active = true&minorversion=73");
    res.json(result.QueryResponse ? result.QueryResponse.Account || [] : []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// Manual bank balance
app.get('/api/settings/bank-balance', requireAuth, (req, res) => {
  db.get("SELECT value, updated_at FROM app_settings WHERE key = 'bank_balance'", [], (err, row) => {
    res.json({ balance: parseFloat(row ? row.value : 0), updated: row ? row.updated_at : null });
  });
});

app.post('/api/settings/bank-balance', requireAuth, (req, res) => {
  const { balance } = req.body;
  db.run("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('bank_balance', ?, datetime('now'))",
    [String(balance || 0)], (err) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({ ok: true, balance });
    });
});

const PORT = process.env.PORT || 3001;
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

initApp().catch(e => { console.error('Failed to start:', e); process.exit(1); });