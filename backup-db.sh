#!/bin/bash
BACKUP_DIR="/home/ubuntu/backups/job-tracker"
mkdir -p $BACKUP_DIR
DATE=$(date +%Y%m%d-%H%M%S)
# Proper SQLite backup (includes WAL data)
sudo sqlite3 /home/ubuntu/cabinet-jobs.db ".backup '$BACKUP_DIR/cabinet-jobs-$DATE.db'"
# Keep last 72 backups (3 days of hourly)
ls -t $BACKUP_DIR/cabinet-jobs-*.db | tail -n +73 | xargs rm -f 2>/dev/null
