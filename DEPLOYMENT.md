# Deployment Guide - Job Tracker Updates

## What's New

### Kanban View
✅ **Inline Stage Dropdown** - Each job card now has a dropdown at the bottom to quickly change stages without opening the full record

### Whiteboard View
✅ **Inline Progress Dropdown** - Change job stage directly in the table
✅ **Inline Items Needed** - Edit items needed field directly in the table
✅ **Inline Install Date** - Pick install date directly in the table
✅ **Auto-Complete Date** - When you set Progress to "Complete", the completion date automatically fills with today's date

### Both Views
✅ **Real-Time Updates** - Socket.IO already configured for live updates across all users

## Deploy to Server

### Option 1: Quick Deploy (Recommended)

```bash
cd /Users/raines/Documents/GitHub/3-Notch-Cabinet-Co

# Add and commit changes
git add job-tracker/
git commit -m "Add inline editing to job tracker

Kanban View:
- Added stage dropdown directly on job cards for quick updates
- Users can now change job stage without opening the modal
- Maintains drag-and-drop functionality

Whiteboard View:
- Inline progress dropdown for quick stage changes
- Inline items needed input field
- Inline install date picker
- Auto-populate completion date when progress set to Complete

All changes sync in real-time via Socket.IO"

# Push to repository
git push origin master
```

The changes will automatically deploy via the GitHub webhook.

### Option 2: Manual Deploy via SSH

```bash
# SSH into the server
ssh -i ~/.ssh/BTS1.pem ubuntu@ec2-3-12-72-81.us-east-2.compute.amazonaws.com

# Navigate to the job tracker
cd /var/www/3-Notch-Cabinet-Co/job-tracker

# Pull latest changes
git pull origin master

# Restart the app
pm2 restart 3-notch-job-tracker

# Verify it's running
pm2 list
```

### Option 3: Copy Files Directly

If git isn't working, copy the updated files:

```bash
# From your local machine
scp -i ~/.ssh/BTS1.pem /Users/raines/Documents/GitHub/3-Notch-Cabinet-Co/job-tracker/public/app.js ubuntu@ec2-3-12-72-81.us-east-2.compute.amazonaws.com:/var/www/3-Notch-Cabinet-Co/job-tracker/public/app.js

scp -i ~/.ssh/BTS1.pem /Users/raines/Documents/GitHub/3-Notch-Cabinet-Co/job-tracker/public/style.css ubuntu@ec2-3-12-72-81.us-east-2.compute.amazonaws.com:/var/www/3-Notch-Cabinet-Co/job-tracker/public/style.css

# Then SSH in and restart
ssh -i ~/.ssh/BTS1.pem ubuntu@ec2-3-12-72-81.us-east-2.compute.amazonaws.com "pm2 restart 3-notch-job-tracker"
```

## Testing After Deployment

1. Go to https://jobtracker.3notchcabinets.com
2. Login with your credentials
3. Look for a **Stage:** dropdown at the bottom of each job card
4. Change a stage using the dropdown - it should move the card to the new column
5. Open another browser or device and verify the change appears in real-time

## Real-Time Updates - Already Working!

Your app already has Socket.IO configured (see app.js:463-501 and server.js:189, 233, 255). This means:

- ✅ When ANY user moves a job, ALL users see it instantly
- ✅ Toast notifications show who moved what
- ✅ No manual page refresh needed
- ✅ Works across different devices

If real-time updates aren't working:
1. Check browser console for Socket.IO connection errors
2. Verify Apache proxy_wstunnel module is enabled
3. Restart the app: `pm2 restart 3-notch-job-tracker`

## Features

### Kanban View - Three ways to change a job's stage:

1. **Inline Dropdown** (NEW) - Use the dropdown on the card itself
2. **Drag & Drop** - Drag the card to a different column
3. **Edit Modal** - Click the card, change the stage dropdown, and save

### Whiteboard View - Inline editing for quick updates:

1. **Progress Dropdown** (NEW) - Change stage directly in the table
2. **Items Needed Input** (NEW) - Type items needed directly in the table
3. **Install Date Picker** (NEW) - Select install date directly in the table
4. **Auto-Complete** (NEW) - Completion date fills automatically when status is "Complete"
5. **Full Edit** - Click the job name to open the full modal

All editing methods trigger real-time updates to all connected users!

---

**Updated:** January 7, 2026
