const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../cabinet-jobs.db');
const db = new sqlite3.Database(dbPath);

const userUpdates = [
  { username: 'sjackson', full_name: 'Shaun Jackson' },
  { username: 'mjackson', full_name: 'Michael Jackson' },
  { username: 'jbyrd', full_name: 'Justin Byrd' },
  { username: 'admin', full_name: 'Brady Raines' }
];

console.log('Updating user full names...');

userUpdates.forEach(update => {
  db.run(
    'UPDATE users SET full_name = ? WHERE username = ?',
    [update.full_name, update.username],
    function(err) {
      if (err) {
        console.error(`Error updating ${update.username}:`, err);
      } else {
        console.log(`✓ Updated ${update.username} to "${update.full_name}"`);
      }
    }
  );
});

setTimeout(() => {
  db.close(() => {
    console.log('Database closed');
  });
}, 1000);
