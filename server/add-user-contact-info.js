const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./cabinet-jobs.db', (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
  console.log('Connected to cabinet-jobs database');
});

// Add email and phone columns to users table
db.run(`ALTER TABLE users ADD COLUMN email TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column')) {
    console.error('Error adding email column:', err);
  } else {
    console.log('✓ Email column added/exists');
  }
});

db.run(`ALTER TABLE users ADD COLUMN phone TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column')) {
    console.error('Error adding phone column:', err);
  } else {
    console.log('✓ Phone column added/exists');
  }

  // Update users with their contact information
  const users = [
    { username: 'sjackson', email: 'sjackson@3notchcabinets.com', phone: '334-504-4534' },
    { username: 'jbyrd', email: 'jbyrd@3notchcabinets.com', phone: '334-208-4295' },
    { username: 'mjackson', email: 'mjackson@3notchcabinets.com', phone: '334-504-2858' },
    { username: 'admin', email: 'braines@3notchcabinets.com', phone: '334-892-4044' }
  ];

  console.log('\nUpdating user contact information...');
  let updated = 0;

  users.forEach((user, index) => {
    db.run('UPDATE users SET email = ?, phone = ? WHERE username = ?',
      [user.email, user.phone, user.username],
      function(err) {
        if (err) {
          console.error(`Error updating ${user.username}:`, err);
        } else if (this.changes > 0) {
          console.log(`✓ Updated ${user.username} - ${user.email}`);
          updated++;
        } else {
          console.log(`⚠ User ${user.username} not found`);
        }

        if (index === users.length - 1) {
          console.log(`\n✅ Updated ${updated} users with contact information`);
          db.close();
        }
      }
    );
  });
});
