#!/usr/bin/env sh
# Start a throwaway Transmission daemon in Docker for manual testing.
#   scripts/dev-daemon.sh            start (or restart) on http://127.0.0.1:9091
#   scripts/dev-daemon.sh stop       stop and remove it
#   scripts/dev-daemon.sh add <url>  add a torrent/magnet to it
set -eu
NAME=helm-transmission
DATA="${HELM_DAEMON_DATA:-${TMPDIR:-/tmp}/helm-transmission}"
case "${1:-start}" in
  stop) docker rm -f "$NAME" >/dev/null 2>&1 && echo "stopped $NAME" ;;
  add) shift; docker exec "$NAME" transmission-remote -a "$@" ;;
  start)
    mkdir -p "$DATA/config" "$DATA/downloads" "$DATA/watch"
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    docker run -d --name "$NAME" -p 9091:9091 \
      -e PUID="$(id -u)" -e PGID="$(id -g)" -e TZ=UTC \
      ${HELM_DAEMON_USER:+-e USER="$HELM_DAEMON_USER" -e PASS="${HELM_DAEMON_PASS:-}"} \
      -v "$DATA/config:/config" -v "$DATA/downloads:/downloads" -v "$DATA/watch:/watch" \
      lscr.io/linuxserver/transmission:latest >/dev/null
    echo "Transmission daemon starting on http://127.0.0.1:9091/transmission/rpc (data in $DATA)"
    echo "Throttle it with: docker exec $NAME transmission-remote -d 200 -u 50"
    ;;
  *) echo "usage: $0 [start|stop|add <url>]" >&2; exit 2 ;;
esac
