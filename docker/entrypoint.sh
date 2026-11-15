#!/bin/sh
set -eu

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
DATA_DIR="${RAINLOG_DATA_DIR:-/data}"

case "$PUID$PGID" in
  *[!0-9]*)
    echo "rainlog: PUID and PGID must be numeric (got PUID=$PUID PGID=$PGID)" >&2
    exit 1
    ;;
esac

if [ "$PUID" != "0" ]; then
  if ! grep -q "^[^:]*:[^:]*:${PGID}:" /etc/group 2>/dev/null; then
    addgroup -g "$PGID" rainlog
  fi
  GROUP_NAME="$(grep "^[^:]*:[^:]*:${PGID}:" /etc/group | head -n 1 | cut -d: -f1)"
  if ! grep -q "^[^:]*:[^:]*:${PUID}:" /etc/passwd 2>/dev/null; then
    adduser -D -H -u "$PUID" -G "$GROUP_NAME" rainlog
  fi
fi

if [ "${RAINLOG_CHOWN:-0}" = "1" ]; then
  echo "rainlog: chowning $DATA_DIR to $PUID:$PGID (RAINLOG_CHOWN=1)"
  chown -R "$PUID:$PGID" "$DATA_DIR" 2>/dev/null || true
fi

if ! su-exec "$PUID:$PGID" test -w "$DATA_DIR" 2>/dev/null; then
  echo "rainlog: $DATA_DIR is not writable by $PUID:$PGID." >&2
  echo "rainlog: make the mounted directory writable by that user, set PUID/PGID to its owner," >&2
  echo "rainlog: or set RAINLOG_CHOWN=1 to let the container take ownership of the data directory." >&2
  exit 1
fi

exec su-exec "$PUID:$PGID" "$@"
