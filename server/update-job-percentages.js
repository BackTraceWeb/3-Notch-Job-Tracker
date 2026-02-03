const sqlite3 = require('sqlite3').verbose();

// Stage to percentage mapping
function getStagePercentage(stage) {
  const percentageMap = {
    'Quote/Estimate': 0,
    'In Progress - Ready to Cut': 15,
    'Ready to Cut': 15,
    'In Progress - Cut': 30,
    'Cut': 30,
    'In Progress - Paint & Sand': 50,
    'In Progress - Paint': 50,
    'Paint & Sand': 50,
    'Paint': 50,
    'In Progress - Assemble': 70,
    'Assemble': 70,
    'In Progress - Ready to Install': 85,
    'Ready to Install': 85,
    'In Progress - Installed': 95,
    'Installed': 95,
    'In Progress - Installed - Finish Work': 98,
    'Installed - Finish Work': 98,
    'Completed': 100
  };
  return percentageMap[stage] || 0;
}

// Open database
const db = new sqlite3.Database('./cabinet-jobs.db', (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
  console.log('Connected to database');
});

// Get all jobs and update their percentages
db.all('SELECT id, job_name, stage, completion_percentage FROM jobs', [], (err, jobs) => {
  if (err) {
    console.error('Error fetching jobs:', err);
    db.close();
    process.exit(1);
  }

  console.log(`Found ${jobs.length} jobs to update`);
  
  let updated = 0;
  let skipped = 0;
  let processed = 0;

  if (jobs.length === 0) {
    console.log('No jobs to update');
    db.close();
    return;
  }

  jobs.forEach((job) => {
    const correctPercentage = getStagePercentage(job.stage);
    
    console.log(`Job ${job.id} (${job.job_name}): stage="${job.stage}" current=${job.completion_percentage}% correct=${correctPercentage}%`);
    
    // Only update if percentage is different
    if (job.completion_percentage !== correctPercentage) {
      db.run(
        'UPDATE jobs SET completion_percentage = ? WHERE id = ?',
        [correctPercentage, job.id],
        (err) => {
          processed++;
          
          if (err) {
            console.error(`Error updating job ${job.id}:`, err);
          } else {
            console.log(`✓ Updated job ${job.id}: ${job.stage} -> ${correctPercentage}%`);
            updated++;
          }

          if (processed === jobs.length) {
            console.log(`\n=== Update complete ===`);
            console.log(`Updated: ${updated}`);
            console.log(`Skipped: ${skipped}`);
            db.close();
          }
        }
      );
    } else {
      processed++;
      skipped++;
      console.log(`- Skipped job ${job.id}: already at ${correctPercentage}%`);
      
      if (processed === jobs.length) {
        console.log(`\n=== Update complete ===`);
        console.log(`Updated: ${updated}`);
        console.log(`Skipped: ${skipped}`);
        db.close();
      }
    }
  });
});
