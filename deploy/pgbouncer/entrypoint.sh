#!/bin/sh
set -e

# Generate userlist.txt from environment variables
echo "\"${DB_USER}\" \"${DB_PASSWORD}\"" > /etc/pgbouncer/userlist.txt

# Template the pgbouncer.ini with actual values
sed -i "s/\${DB_HOST}/${DB_HOST}/g" /etc/pgbouncer/pgbouncer.ini
sed -i "s/\${DB_PORT}/${DB_PORT}/g" /etc/pgbouncer/pgbouncer.ini
sed -i "s/\${DB_NAME}/${DB_NAME}/g" /etc/pgbouncer/pgbouncer.ini

echo "PgBouncer starting — pooling ${DB_HOST}:${DB_PORT}/${DB_NAME}"
exec pgbouncer /etc/pgbouncer/pgbouncer.ini
