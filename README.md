# 3 Notch Cabinet Co. - Job Tracker

**Core Business Management Software** for 3 Notch Cabinet Co.

Real-time cabinet job tracking system with drag-and-drop Kanban board. This is the central hub for ALL jobs - whether they come from the contractor portal, direct sales, or manual entry.

**Features 3 Notch Cabinet Co. branding** - Dark theme with gold accents, company logo, and Oswald font matching your main website.

## System Architecture

This job tracker is the **core software** that manages all production workflows. Jobs enter the system through multiple channels:

1. **Contractor Portal** - Online ordering system (https://3notchcabinets.com/storefront.html)
   - Contractors place cabinet door orders
   - Orders are approved via email
   - Approved orders automatically create jobs in tracker

2. **Salesman Direct Sales** - In-person estimates
   - Salesman creates job in tracker
   - System generates professional estimate
   - Customer approves → Job proceeds through workflow

3. **Manual Entry** - Walk-in customers or phone orders
   - Jobs created directly in tracker
   - Immediate workflow tracking

## Features

✅ **Real-time Updates** - When one user moves a job, all other users see it instantly
✅ **Drag & Drop** - Drag job cards between stages
✅ **Multi-user** - Supports up to 10 employees with individual logins
✅ **Job Details** - Track customer name, address, cabinet color, items needed, install dates
✅ **8 Stages** - Quote/Estimate → Ordered → Cut → Paint → Assemble → Ready to Install → Installed → Complete
✅ **Mobile Friendly** - Works on tablets and phones in the shop

## Access

**HTTPS URL:** **https://jobtracker.3notchcabinets.com** 🔒

**Default Login:**
- Username: `admin`
- Password: `admin123`

**⚠️ IMPORTANT:** Change the admin password after first login!

### SSL Certificate
- ✅ **Let's Encrypt SSL** certificate installed
- ✅ **Auto-renewal** configured (renews every 90 days)
- ✅ **HTTP → HTTPS** redirect enabled

## How to Use

### 1. Login
- Go to https://jobtracker.3notchcabinets.com
- Enter your username and password

### 2. View Jobs
- The Kanban board shows all jobs organized by stage
- Each column represents a stage in the process
- Jobs are shown as cards with customer name, address, color, and details

### 3. Add New Job
- Click "+ New Job" button
- Fill in:
  - Job Name (customer)
  - Job Address
  - Cabinet Color
  - Stage (current status)
  - Items Needed/Waiting On
  - Install Date
  - Completion Date
- Click "Save Job"

### 4. Move Jobs Between Stages
- **Method 1: Drag and Drop**
  - Click and hold a job card
  - Drag it to the new stage column
  - Drop it

- **Method 2: Edit Job**
  - Click on any job card
  - Change the "Stage" dropdown
  - Click "Save Job"

### 5. Edit Job
- Click on any job card
- Update any field
- Click "Save Job"

### 6. Delete Job
- Click on a job card
- Click "Delete" button
- Confirm deletion

## Real-Time Features

- When **ANY user** moves a job, **ALL users** see the update instantly
- Toast notifications show who moved what
- No page refresh needed
- Works even if users are on different devices

## Adding New Users

Login as admin, then:

1. SSH into the server:
   ```bash
   ssh -i ~/.ssh/BTS1.pem ubuntu@ec2-3-12-72-81.us-east-2.compute.amazonaws.com
   ```

2. Navigate to the job tracker:
   ```bash
   cd /var/www/3-Notch-Cabinet-Co/job-tracker
   ```

3. Install sqlite3 if not already installed:
   ```bash
   sudo apt-get install sqlite3
   ```

4. Open the database:
   ```bash
   sqlite3 cabinet-jobs.db
   ```

5. Add a new user (replace values with actual data):
   ```sql
   -- Generate password hash first (use Node.js)
   -- Run this in a separate terminal:
   node -e "console.log(require('bcryptjs').hashSync('password123', 10))"

   -- Then insert the user (replace $2a$10$... with the hash from above)
   INSERT INTO users (username, password_hash, full_name, role)
   VALUES ('johndoe', '$2a$10$...hash...', 'John Doe', 'employee');
   ```

6. Exit sqlite:
   ```
   .exit
   ```

### Quick User Add Script

Save this as `add-user.js` in the job-tracker directory:

```javascript
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();

const [username, password, fullName] = process.argv.slice(2);

if (!username || !password || !fullName) {
  console.log('Usage: node add-user.js <username> <password> <fullName>');
  process.exit(1);
}

const db = new sqlite3.Database('./cabinet-jobs.db');
const hash = bcrypt.hashSync(password, 10);

db.run('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)',
  [username, hash, fullName, 'employee'],
  function(err) {
    if (err) {
      console.error('Error:', err.message);
    } else {
      console.log(`✅ User '${username}' created successfully!`);
    }
    db.close();
  }
);
```

Then run:
```bash
node add-user.js johndoe password123 "John Doe"
```

## Server Management

### Check if app is running:
```bash
ssh -i ~/.ssh/BTS1.pem ubuntu@ec2-3-12-72-81.us-east-2.compute.amazonaws.com "pm2 list"
```

### View logs:
```bash
ssh -i ~/.ssh/BTS1.pem ubuntu@ec2-3-12-72-81.us-east-2.compute.amazonaws.com "pm2 logs 3-notch-job-tracker"
```

### Restart app:
```bash
ssh -i ~/.ssh/BTS1.pem ubuntu@ec2-3-12-72-81.us-east-2.compute.amazonaws.com "pm2 restart 3-notch-job-tracker"
```

### Stop app:
```bash
ssh -i ~/.ssh/BTS1.pem ubuntu@ec2-3-12-72-81.us-east-2.compute.amazonaws.com "pm2 stop 3-notch-job-tracker"
```

### Start app:
```bash
ssh -i ~/.ssh/BTS1.pem ubuntu@ec2-3-12-72-81.us-east-2.compute.amazonaws.com "pm2 start 3-notch-job-tracker"
```

## Database Location

- Server: `/var/www/3-Notch-Cabinet-Co/job-tracker/cabinet-jobs.db`
- Contains all jobs, users, and activity logs
- **Backup regularly!**

## Technology Stack

- **Backend:** Node.js + Express + Socket.IO (real-time WebSocket)
- **Database:** SQLite3 (file-based, no separate database server needed)
- **Frontend:** Vanilla JavaScript + HTML5 Drag and Drop API
- **Server:** Apache2 (proxy) + PM2 (process manager)

## Troubleshooting

### Jobs not updating in real-time?
1. Check if WebSocket is connecting (open browser console, look for Socket.IO logs)
2. Make sure Apache proxy_wstunnel module is enabled
3. Restart the app: `pm2 restart 3-notch-job-tracker`

### Can't login?
1. Make sure the app is running: `pm2 list`
2. Check logs: `pm2 logs 3-notch-job-tracker`
3. Verify database exists: `ls -la /var/www/3-Notch-Cabinet-Co/job-tracker/cabinet-jobs.db`

### Lost admin password?
Reset it:
```bash
ssh -i ~/.ssh/BTS1.pem ubuntu@ec2-3-12-72-81.us-east-2.compute.amazonaws.com
cd /var/www/3-Notch-Cabinet-Co/job-tracker
sqlite3 cabinet-jobs.db

-- Generate new hash (exit sqlite first and run):
node -e "console.log(require('bcryptjs').hashSync('newpassword', 10))"

-- Then back in sqlite:
UPDATE users SET password_hash = '$2a$10$...new hash...' WHERE username = 'admin';
.exit
```

## Support

For issues or questions, contact BackTrace support.

---

**Built by BackTrace** - January 2026
