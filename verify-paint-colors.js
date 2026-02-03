const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./cabinet-jobs.db', (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
});

db.serialize(() => {
  // Check total count
  db.get('SELECT COUNT(*) as count FROM paint_colors', [], (err, row) => {
    if (err) {
      console.error('Error:', err);
      db.close();
      process.exit(1);
    }
    
    console.log(`Total paint colors in database: ${row.count}`);
    console.log('');
  });

  // Search for some popular Sherwin-Williams colors
  const popularColors = ['Naval', 'Agreeable Gray', 'Repose Gray', 'Pure White', 'Tricorn Black'];
  
  console.log('Popular Sherwin-Williams colors:');
  popularColors.forEach(colorName => {
    db.get('SELECT name, hex_color FROM paint_colors WHERE name LIKE ? COLLATE NOCASE', 
           [`%${colorName}%`], 
           (err, row) => {
      if (err) {
        console.error(`Error searching for ${colorName}:`, err);
      } else if (row) {
        console.log(`  ✓ ${row.name}: ${row.hex_color}`);
      } else {
        console.log(`  ✗ ${colorName}: Not found`);
      }
    });
  });

  // Wait a bit for async queries to complete, then show tables
  setTimeout(() => {
    db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, tables) => {
      if (!err) {
        console.log('\nDatabase tables:');
        tables.forEach(table => {
          console.log(`  - ${table.name}`);
        });
      }
      db.close();
    });
  }, 500);
});
