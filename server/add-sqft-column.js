const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../cabinet-jobs.db');
const db = new sqlite3.Database(dbPath);

console.log('Adding sqft column to estimate_items table...');

db.run(`ALTER TABLE estimate_items ADD COLUMN sqft REAL DEFAULT 1`, (err) => {
  if (err) {
    if (err.message.includes('duplicate column name')) {
      console.log('✓ Column sqft already exists');
    } else {
      console.error('Error adding sqft column:', err);
    }
  } else {
    console.log('✓ Added sqft column to estimate_items table');
  }

  db.close(() => {
    console.log('Database closed');
  });
});
