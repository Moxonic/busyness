#!/bin/bash
# Runs once when the local database volume is first created.
# Creates the restricted application role and a separate database for tests.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE ROLE ${APP_DB_ROLE} LOGIN PASSWORD '${APP_DB_PASSWORD}';
  CREATE DATABASE busyness_test OWNER ${POSTGRES_USER};
  GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO ${APP_DB_ROLE};
  GRANT CONNECT ON DATABASE busyness_test TO ${APP_DB_ROLE};
EOSQL
