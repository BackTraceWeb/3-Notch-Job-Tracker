const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./cabinet-jobs.db', (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
  console.log('Connected to database');
});

// Check what tables exist
db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, tables) => {
  if (err) {
    console.error('Error querying tables:', err);
    db.close();
    process.exit(1);
  }

  console.log('\nTables in database:');
  tables.forEach(table => {
    console.log('  -', table.name);
  });

  // Check user count
  db.get('SELECT COUNT(*) as count FROM users', [], (err, row) => {
    if (err) {
      console.error('\nError checking users:', err.message);
    } else {
      console.log('\nTotal users:', row.count);
    }

    // Check job count
    db.get('SELECT COUNT(*) as count FROM jobs', [], (err, row) => {
      if (err) {
        console.error('Error checking jobs:', err.message);
      } else {
        console.log('Total jobs:', row.count);
      }

      db.close();
    });
  });
});
