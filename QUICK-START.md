# 3 Notch Cabinet Job Tracker - Quick Start

## ✅ Status: LIVE and WORKING!

**Updated with 3 Notch Cabinet Co. Branding** - Dark theme with gold accents and company logo

---

## 🚀 Access the Tracker

**HTTPS URL:** **https://jobtracker.3notchcabinets.com** 🔒 (Secure)

**Login Credentials:**
- Username: `admin`
- Password: `admin123`

⚠️ **IMPORTANT:** Change the admin password after first login!

---

## 📱 How It Works

1. **Login** at http://3.12.72.81/tracker
2. **View** all jobs organized by stage (Quote → Ordered → Cut → Paint → Assemble → Ready to Install → Installed → Complete)
3. **Add** new jobs with "+ New Job" button
4. **Drag & Drop** job cards between stages
5. **Real-time** - When one employee moves a job, everyone sees it instantly!

---

## 👥 Add More Employees (Up to 10)

SSH into the server and run:

```bash
ssh -i ~/.ssh/BTS1.pem ubuntu@ec2-3-12-72-81.us-east-2.compute.amazonaws.com
cd /var/www/3-Notch-Cabinet-Co/job-tracker
node add-user.js johndoe password123 "John Doe"
```

Replace with actual username, password, and full name.

---

## 📊 Features

✅ **Real-time Updates** - All users see changes instantly
✅ **Drag & Drop** - Move jobs between stages by dragging
✅ **Multi-user** - 10 employees can work simultaneously
✅ **Mobile Friendly** - Works on tablets and phones
✅ **8 Stages** - Full workflow tracking
✅ **Job Details** - Track customer, address, color, items needed, install dates

---

## 🔧 Server Management

**Check Status:**
```bash
ssh -i ~/.ssh/BTS1.pem ubuntu@ec2-3-12-72-81.us-east-2.compute.amazonaws.com "pm2 list"
```

**Restart:**
```bash
ssh -i ~/.ssh/BTS1.pem ubuntu@ec2-3-12-72-81.us-east-2.compute.amazonaws.com "pm2 restart 3-notch-job-tracker"
```

**View Logs:**
```bash
ssh -i ~/.ssh/BTS1.pem ubuntu@ec2-3-12-72-81.us-east-2.compute.amazonaws.com "pm2 logs 3-notch-job-tracker"
```

---

## 🌐 Future: Custom Domain

For a cleaner URL like `tracker.3notchcabinets.com`:
1. Add DNS A record: `tracker.3notchcabinets.com` → `3.12.72.81`
2. Access via the new subdomain

---

**Built by BackTrace** - January 2026
