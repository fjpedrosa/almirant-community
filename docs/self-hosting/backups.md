# Backups and Restore

Almirant Self-Hosted stores data in two places: the Postgres volume and the `./data` directory (secrets + uploads). Both must be backed up.

## What to back up

| Item | Location |
|------|----------|
| Database | Docker volume `postgres-data` |
| Auth secret | `./data/secrets/auth.secret` |
| Uploaded files | `./data/uploads/` |
| GitHub App private key | `./data/github-app.pem` (if using GitHub integration) |
| `.env` file | `./.env` |

## Manual backup

### Database dump

```bash
docker compose exec -T postgres pg_dump -U almirant almirant > backup-$(date +%Y-%m-%d-%H%M).sql
```

This produces a plain SQL file. For large databases, compress it:

```bash
docker compose exec -T postgres pg_dump -U almirant -Fc almirant > backup-$(date +%Y-%m-%d-%H%M).dump
```

### Data directory

```bash
tar czf data-$(date +%Y-%m-%d-%H%M).tar.gz ./data
```

### Store both off-site

Copy the `.sql`/`.dump` and `.tar.gz` to an S3 bucket, another server, or any external storage.

## Automated backups

A simple cron job on the host:

```cron
# Daily at 3am
0 3 * * * cd /path/to/almirant && ./scripts/backup.sh
```

Example `scripts/backup.sh`:

```bash
#!/bin/sh
set -e
BACKUP_DIR=/var/backups/almirant
TIMESTAMP=$(date +%Y-%m-%d-%H%M)
mkdir -p "$BACKUP_DIR"
docker compose exec -T postgres pg_dump -U almirant -Fc almirant > "$BACKUP_DIR/db-$TIMESTAMP.dump"
tar czf "$BACKUP_DIR/data-$TIMESTAMP.tar.gz" ./data
find "$BACKUP_DIR" -type f -mtime +30 -delete  # keep 30 days
```

For off-site uploads, add an `rclone` or `aws s3 cp` step after the tar.

## Restore

### From SQL dump

```bash
# Stop the stack (the API must not be writing during restore)
docker compose stop backend frontend

# Restore DB
docker compose exec -T postgres psql -U almirant -d almirant < backup-YYYY-MM-DD.sql

# Restore data directory
tar xzf data-YYYY-MM-DD.tar.gz

# Restart
docker compose start backend frontend
```

### From pg_dump custom format

```bash
docker compose stop backend frontend
docker compose exec -T postgres pg_restore -U almirant -d almirant --clean < backup-YYYY-MM-DD.dump
tar xzf data-YYYY-MM-DD.tar.gz
docker compose start backend frontend
```

## Before every upgrade

Major version upgrades (v1.x → v2.x) can require irreversible schema migrations. Back up the DB and the data directory **before** pulling new images. See [Upgrading](../upgrading/README.md).

## Retention

A reasonable policy:

- Daily backups kept for 14 days
- Weekly backups kept for 3 months
- Monthly backups kept for 1 year

Adjust to your compliance needs.
