const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const fs = require('fs');
const { generateEstimate } = require('./estimateGenerator');

const app = express();
app.set("trust proxy", 1);
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
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

// Middleware to check if user is logged in
function requireAuth(req, res, next) {
  // Allow localhost requests without auth (for internal scripts like Mozaik sync)
  const clientIp = req.ip || req.connection.remoteAddress;
  const isLocalhost = clientIp === '127.0.0.1' ||
                      clientIp === '::1' ||
                      clientIp === '::ffff:127.0.0.1' ||
                      clientIp === 'localhost';

  if (req.session.userId || isLocalhost) {
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
      res.json({ success: true, user: { id: user.id, username: user.username, fullName: user.full_name, role: user.role } });
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
    db.get('SELECT id, username, full_name, role FROM users WHERE id = ?', [req.session.userId], (err, user) => {
      if (err || !user) {
        return res.json({ authenticated: false });
      }
      res.json({ authenticated: true, user: { id: user.id, username: user.username, fullName: user.full_name, role: user.role } });
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
          material_cost, quoted_price } = req.body;

  // Use null for system/automated job creation (like Mozaik sync)
  const userId = req.session.userId || null;

  db.run(`INSERT INTO jobs (customer_id, job_name, job_address, job_email, job_color, job_identifier, stage, items_needed, finish_work, install_date, completion_date,
                             first_invoice_sent, first_invoice_paid, second_invoice_sent, second_invoice_paid,
                             first_invoice_amount, second_invoice_amount, single_invoice_mode,
                             material_cost, quoted_price, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [customer_id, job_name, job_address, job_email, job_color, job_identifier, stage || 'Quote/Estimate', items_needed, finish_work, install_date, completion_date,
     first_invoice_sent, first_invoice_paid, second_invoice_sent, second_invoice_paid,
     first_invoice_amount, second_invoice_amount, single_invoice_mode ? 1 : 0,
     material_cost, quoted_price, userId],
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

    const { job_name, job_address, job_email, job_color, job_identifier, stage, items_needed, finish_work, install_date, completion_date,
            first_invoice_sent, first_invoice_paid, second_invoice_sent, second_invoice_paid,
            first_invoice_amount, second_invoice_amount, single_invoice_mode,
            material_cost, quoted_price, completion_percentage } = updates;

    db.run(`UPDATE jobs
            SET job_name = ?, job_address = ?, job_email = ?, job_color = ?, job_identifier = ?, stage = ?, items_needed = ?, finish_work = ?,
                install_date = ?, completion_date = ?, first_invoice_sent = ?, first_invoice_paid = ?,
                second_invoice_sent = ?, second_invoice_paid = ?, first_invoice_amount = ?, second_invoice_amount = ?,
                single_invoice_mode = ?, material_cost = ?, quoted_price = ?, completion_percentage = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
      [job_name, job_address, job_email, job_color, job_identifier, stage, items_needed, finish_work, install_date, completion_date,
       first_invoice_sent, first_invoice_paid, second_invoice_sent, second_invoice_paid,
       first_invoice_amount, second_invoice_amount, single_invoice_mode ? 1 : 0,
       material_cost, quoted_price, completion_percentage || 0, jobId],
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
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
