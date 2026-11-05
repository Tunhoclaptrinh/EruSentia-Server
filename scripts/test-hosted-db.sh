#!/usr/bin/env bash
# Disposable PostgreSQL with a temporary CA. Requires Docker, openssl and built JS.
set -euo pipefail
cd "$(dirname "$0")/.."
test_tls_dir=$(mktemp -d /tmp/eru-hosted-tls.XXXXXX)
test_container="eru-hosted-test-$(basename "$test_tls_dir" | tr '[:upper:]' '[:lower:]')"
cleanup() {
  docker rm -fv "$test_container" >/dev/null 2>&1 || true
  rm -rf "$test_tls_dir"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -subj /CN=Eru-Test-CA -keyout "$test_tls_dir/ca.key" -out "$test_tls_dir/ca.crt" >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes -subj /CN=localhost \
  -keyout "$test_tls_dir/server.key" -out "$test_tls_dir/server.csr" >/dev/null 2>&1
printf 'subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n' > "$test_tls_dir/extensions"
openssl x509 -req -days 1 -in "$test_tls_dir/server.csr" \
  -CA "$test_tls_dir/ca.crt" -CAkey "$test_tls_dir/ca.key" -CAcreateserial \
  -extfile "$test_tls_dir/extensions" -out "$test_tls_dir/server.crt" >/dev/null 2>&1
docker run -d --name "$test_container" \
  -p 127.0.0.1::5432 \
  -e POSTGRES_PASSWORD=ci-only-disposable-password \
  -e POSTGRES_DB=project_test_foundation \
  -v "$test_tls_dir:/test-tls:ro" \
  postgres:16-alpine sh -c \
  'cp /test-tls/server.crt /test-tls/server.key /tmp/; chown postgres:postgres /tmp/server.*; chmod 600 /tmp/server.key; exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/tmp/server.crt -c ssl_key_file=/tmp/server.key' >/dev/null
test_ready=false
for _ in $(seq 1 60); do
  # The initdb temporary server accepts Unix sockets before restarting. Wait for
  # the final TCP listener so createdb/tests cannot race that shutdown on CI.
  if docker exec "$test_container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then
    test_ready=true
    break
  fi
  sleep 1
done
if [ "$test_ready" != true ]; then
  docker logs --tail 50 "$test_container"
  exit 1
fi
docker exec "$test_container" createdb -U postgres project_test_hosted
docker exec "$test_container" createdb -U postgres project_test_revisions
export DB_HOST=localhost
export DB_PORT=$(docker port "$test_container" 5432/tcp | sed 's/.*://')
export DB_USERNAME=postgres DB_PASSWORD=ci-only-disposable-password
export DB_DATABASE=project_test_foundation DB_SSL=true DB_POOL_MAX=5
export NODE_EXTRA_CA_CERTS="$test_tls_dir/ca.crt"
export QUEUE_ENABLED=false CACHE_ENABLED=false
export RUN_FOUNDATION_TESTS=1 RUN_HOSTED_TESTS=1
export RUN_VERSIONING_TESTS=1 C3_TEST_DATABASE=project_test_revisions
node --test test/foundation-api.test.cjs test/hosted-startup.test.cjs test/template-revisions.test.cjs
