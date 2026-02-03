#!/bin/bash
# Backup job tracker database
BACKUP_DIR="/home/ubuntu/backups/job-tracker"
mkdir -p $BACKUP_DIR
DATE=$(date +%Y%m%d-%H%M%S)
cp /var/www/3-Notch-Cabinet-Co/job-tracker/cabinet-jobs.db $BACKUP_DIR/cabinet-jobs-$DATE.db
# Keep only last 30 backups
ls -t $BACKUP_DIR/cabinet-jobs-*.db | tail -n +31 | xargs rm -f 2>/dev/null
