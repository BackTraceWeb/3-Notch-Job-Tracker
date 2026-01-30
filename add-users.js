const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./cabinet-jobs.db');

// Users to create
const users = [
  { username: 'sjackson', password: 'sjackson123', fullName: 'S Jackson', role: 'employee' },
  { username: 'jbyrd', password: 'jbyrd123', fullName: 'J Byrd', role: 'employee' },
  { username: 'mjackson', password: 'mjackson123', fullName: 'M Jackson', role: 'employee' },
  { username: 'jobfloor', password: 'jobfloor123', fullName: 'Job Floor', role: 'job-floor' }
];

users.forEach(user => {
  const hash = bcrypt.hashSync(user.password, 10);

  db.run('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)',
    [user.username, hash, user.fullName, user.role],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          console.log(`⚠️  User '${user.username}' already exists, skipping...`);
        } else {
          console.error(`❌ Error creating user '${user.username}':`, err.message);
        }
      } else {
        console.log(`✅ User '${user.username}' created successfully! (Password: ${user.password})`);
      }
    }
  );
});

// Close database after all operations
setTimeout(() => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    } else {
      console.log('\n✅ All users processed. Database closed.');
    }
  });
}, 1000);
