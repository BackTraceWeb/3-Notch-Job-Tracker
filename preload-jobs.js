const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./cabinet-jobs.db');

// Jobs from whiteboard image
const jobs = [
  {
    job_name: 'Smith Residence',
    job_address: '123 Main Street',
    job_color: 'White',
    stage: 'Quote/Estimate',
    items_needed: 'Cabinet hardware specs',
    install_date: '2026-01-20',
    completion_date: null
  },
  {
    job_name: 'Johnson Kitchen',
    job_address: '456 Oak Avenue',
    job_color: 'Espresso',
    stage: 'Ordered',
    items_needed: 'Waiting on hinges',
    install_date: '2026-01-25',
    completion_date: null
  },
  {
    job_name: 'Brown Bathroom',
    job_address: '789 Pine Road',
    job_color: 'Gray',
    stage: 'Cut',
    items_needed: null,
    install_date: '2026-01-18',
    completion_date: null
  },
  {
    job_name: 'Davis Master Suite',
    job_address: '321 Elm Street',
    job_color: 'Cherry',
    stage: 'Paint',
    items_needed: null,
    install_date: '2026-01-22',
    completion_date: null
  },
  {
    job_name: 'Wilson Pantry',
    job_address: '654 Maple Drive',
    job_color: 'White',
    stage: 'Assemble',
    items_needed: null,
    install_date: '2026-01-15',
    completion_date: null
  },
  {
    job_name: 'Martinez Kitchen',
    job_address: '987 Birch Lane',
    job_color: 'Navy Blue',
    stage: 'Ready to Install',
    items_needed: null,
    install_date: '2026-01-12',
    completion_date: null
  },
  {
    job_name: 'Anderson Laundry Room',
    job_address: '147 Cedar Court',
    job_color: 'Gray',
    stage: 'Installed',
    items_needed: null,
    install_date: '2026-01-08',
    completion_date: null
  },
  {
    job_name: 'Taylor Office',
    job_address: '258 Walnut Street',
    job_color: 'Walnut',
    stage: 'Complete',
    items_needed: null,
    install_date: '2026-01-05',
    completion_date: '2026-01-10'
  }
];

// Get admin user ID (assuming ID 1)
const adminUserId = 1;

console.log('Preloading jobs from whiteboard...\n');

jobs.forEach((job, index) => {
  db.run(
    `INSERT INTO jobs (job_name, job_address, job_color, stage, items_needed, install_date, completion_date, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      job.job_name,
      job.job_address,
      job.job_color,
      job.stage,
      job.items_needed,
      job.install_date,
      job.completion_date,
      adminUserId
    ],
    function(err) {
      if (err) {
        console.error(`❌ Error adding ${job.job_name}:`, err.message);
      } else {
        console.log(`✅ Added: ${job.job_name} (${job.stage})`);
      }

      // Close DB after last job
      if (index === jobs.length - 1) {
        setTimeout(() => {
          db.close();
          console.log('\n✅ All jobs preloaded successfully!');
        }, 500);
      }
    }
  );
});
