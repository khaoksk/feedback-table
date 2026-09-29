#!/usr/bin/env bash
set -e

: "${POSTGRES_HOST:=db}"
: "${POSTGRES_PORT:=5432}"

echo "Waiting for Postgres at ${POSTGRES_HOST}:${POSTGRES_PORT}..."
until nc -z "${POSTGRES_HOST}" "${POSTGRES_PORT}"; do
  sleep 0.5
done
echo "Postgres is up."

# Allow one-off commands, e.g. `docker compose run web python manage.py shell`.
if [ "$#" -gt 0 ]; then
  exec "$@"
fi

python manage.py migrate --noinput
python manage.py seed
python manage.py createsuperuser --noinput 2>/dev/null || true

exec python manage.py runserver 0.0.0.0:8000
