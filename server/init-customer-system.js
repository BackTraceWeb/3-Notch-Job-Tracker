const sqlite3 = require('sqlite3').verbose();

// Open main database
const db = new sqlite3.Database('./cabinet-jobs.db', (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
  console.log('Connected to cabinet-jobs database');
});

// Create customers table
db.run(`
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    address TEXT,
    is_contractor INTEGER DEFAULT 0,
    contractor_id INTEGER,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`, (err) => {
  if (err) {
    console.error('Error creating customers table:', err);
  } else {
    console.log('✓ Customers table created');
  }
});

// Create services table for reusable line items
db.run(`
  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    default_rate REAL,
    category TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`, (err) => {
  if (err) {
    console.error('Error creating services table:', err);
  } else {
    console.log('✓ Services table created');
  }
});

// Create estimate_items table (line items for each job)
db.run(`
  CREATE TABLE IF NOT EXISTS estimate_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    service_id INTEGER,
    description TEXT NOT NULL,
    quantity REAL DEFAULT 1,
    rate REAL NOT NULL,
    amount REAL NOT NULL,
    line_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
  )
`, (err) => {
  if (err) {
    console.error('Error creating estimate_items table:', err);
  } else {
    console.log('✓ Estimate items table created');
  }
});

// Add customer_id column to jobs table
db.run(`ALTER TABLE jobs ADD COLUMN customer_id INTEGER`, (err) => {
  if (err && !err.message.includes('duplicate column')) {
    console.error('Error adding customer_id column:', err);
  } else if (!err) {
    console.log('✓ Added customer_id column to jobs');
  }
});

// Insert default services
const defaultServices = [
  { name: 'Custom Cabinet Work', description: 'Labor and materials for custom cabinet fabrication', default_rate: 0, category: 'Cabinet Work' },
  { name: 'Cabinet Installation', description: 'Professional cabinet installation services', default_rate: 0, category: 'Installation' },
  { name: 'Cabinet Painting', description: 'Professional cabinet painting and finishing', default_rate: 0, category: 'Finishing' },
  { name: 'Hardware Installation', description: 'Install cabinet hardware (hinges, pulls, knobs)', default_rate: 0, category: 'Hardware' },
  { name: 'Countertop Installation', description: 'Countertop fabrication and installation', default_rate: 0, category: 'Countertops' },
  { name: 'Custom Cabinet Doors', description: 'Custom cabinet door fabrication', default_rate: 0, category: 'Cabinet Work' },
  { name: 'Drawer Boxes', description: 'Custom drawer box construction', default_rate: 0, category: 'Cabinet Work' },
  { name: 'Soft-Close Hardware', description: 'Soft-close hinges and drawer slides', default_rate: 0, category: 'Hardware' },
  { name: 'Crown Molding', description: 'Cabinet crown molding installation', default_rate: 0, category: 'Trim' },
  { name: 'Cabinet Refinishing', description: 'Refinish existing cabinets', default_rate: 0, category: 'Finishing' }
];

setTimeout(() => {
  const stmt = db.prepare('INSERT OR IGNORE INTO services (name, description, default_rate, category) VALUES (?, ?, ?, ?)');
  defaultServices.forEach(service => {
    stmt.run(service.name, service.description, service.default_rate, service.category);
  });
  stmt.finalize(() => {
    console.log('✓ Default services added');
    
    // Migrate existing jobs to customers
    db.all('SELECT id, job_name, job_email FROM jobs WHERE job_name IS NOT NULL', [], (err, jobs) => {
      if (err) {
        console.error('Error fetching jobs:', err);
        db.close();
        return;
      }
      
      console.log(`\nMigrating ${jobs.length} existing jobs to customers...`);
      let migrated = 0;
      
      jobs.forEach((job, index) => {
        // Check if customer already exists
        db.get('SELECT id FROM customers WHERE name = ?', [job.job_name], (err, customer) => {
          if (customer) {
            // Link job to existing customer
            db.run('UPDATE jobs SET customer_id = ? WHERE id = ?', [customer.id, job.id], (err) => {
              if (!err) migrated++;
              if (index === jobs.length - 1) {
                console.log(`✓ Migrated ${migrated} jobs to customers`);
                db.close();
              }
            });
          } else {
            // Create new customer
            db.run('INSERT INTO customers (name, email) VALUES (?, ?)', [job.job_name, job.job_email], function(err) {
              if (!err) {
                // Link job to new customer
                db.run('UPDATE jobs SET customer_id = ? WHERE id = ?', [this.lastID, job.id], (err) => {
                  if (!err) migrated++;
                  if (index === jobs.length - 1) {
                    console.log(`✓ Migrated ${migrated} jobs to customers`);
                    db.close();
                  }
                });
              } else {
                if (index === jobs.length - 1) {
                  console.log(`✓ Migrated ${migrated} jobs to customers`);
                  db.close();
                }
              }
            });
          }
        });
      });
      
      if (jobs.length === 0) {
        console.log('No jobs to migrate');
        db.close();
      }
    });
  });
}, 500);
