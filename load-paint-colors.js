const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const db = new sqlite3.Database('./cabinet-jobs.db', (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
  console.log('Connected to database');
});

// Create paint_colors table
db.serialize(() => {
  console.log('Creating paint_colors table...');
  
  db.run(`
    CREATE TABLE IF NOT EXISTS paint_colors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      hex_color TEXT NOT NULL,
      brand TEXT DEFAULT 'Sherwin-Williams',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('Error creating table:', err);
      db.close();
      process.exit(1);
    }
    console.log('✓ Table created successfully');
  });

  // Create index for faster lookups
  db.run('CREATE INDEX IF NOT EXISTS idx_paint_name ON paint_colors(name COLLATE NOCASE)', (err) => {
    if (err) {
      console.error('Error creating index:', err);
    } else {
      console.log('✓ Index created successfully');
    }
  });

  // Load and parse paint-colors.js
  console.log('\nLoading paint colors from paint-colors.js...');
  const paintColorsPath = path.join(__dirname, 'public', 'paint-colors.js');
  const fileContent = fs.readFileSync(paintColorsPath, 'utf8');
  
  // Extract the paintColors object
  const paintColorsMatch = fileContent.match(/const paintColors = \{([\s\S]+)\};/);
  if (!paintColorsMatch) {
    console.error('Could not parse paint-colors.js');
    db.close();
    process.exit(1);
  }

  // Parse the colors - extract unique color names (ignoring the no-space versions)
  const lines = paintColorsMatch[1].split('\n');
  const colors = new Map(); // Use Map to avoid duplicates
  
  lines.forEach(line => {
    const match = line.match(/"([^"]+)"\s*:\s*"(#[A-F0-9]{6})"/i);
    if (match) {
      const name = match[1];
      const hex = match[2].toUpperCase();
      
      // Only add colors with spaces (the actual color names, not the concatenated versions)
      if (name.includes(' ') || name === name.toLowerCase()) {
        colors.set(name, hex);
      }
    }
  });

  console.log(`Found ${colors.size} unique paint colors`);

  // Insert colors into database
  const stmt = db.prepare('INSERT INTO paint_colors (name, hex_color) VALUES (?, ?)');
  
  let insertCount = 0;
  colors.forEach((hex, name) => {
    stmt.run(name, hex, (err) => {
      if (err) {
        console.error(`Error inserting color ${name}:`, err.message);
      } else {
        insertCount++;
      }
    });
  });

  stmt.finalize((err) => {
    if (err) {
      console.error('Error finalizing statement:', err);
    }
    
    // Verify insertion
    db.get('SELECT COUNT(*) as count FROM paint_colors', [], (err, row) => {
      if (err) {
        console.error('Error counting colors:', err);
      } else {
        console.log(`\n✓ Successfully loaded ${row.count} paint colors into database`);
        
        // Show some sample colors
        db.all('SELECT name, hex_color FROM paint_colors ORDER BY name LIMIT 5', [], (err, rows) => {
          if (!err && rows) {
            console.log('\nSample colors:');
            rows.forEach(row => {
              console.log(`  - ${row.name}: ${row.hex_color}`);
            });
          }
          
          db.close((err) => {
            if (err) {
              console.error('Error closing database:', err);
            } else {
              console.log('\nDatabase connection closed');
            }
          });
        });
      }
    });
  });
});
