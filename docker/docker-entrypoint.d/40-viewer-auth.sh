#!/bin/sh
# Writes the Basic-auth gate for /api/*, then gets out of the way.
#
# This is the ONE thing templated at runtime in this image. The app bundle itself still has
# nothing baked in — it talks to the relative /api, so the same index.html works behind this
# nginx, behind the Vite dev proxy, and from a bare double-click. What is deployment-coupled
# here is exactly two strings: the compose DNS name `edge` in nginx.conf, and this credential.
#
# /docker-entrypoint.sh runs every executable /docker-entrypoint.d/*.sh in `sort -V` order
# BEFORE it execs nginx, under `set -e` — so a non-zero exit here stops the container rather
# than starting an ungated one. (A *non-executable* hook is silently skipped instead, with
# only a log line. The Dockerfile sets the mode; do not rely on git to carry it.)
#
# Both targets are created by the Dockerfile and owned by the runtime user, so this only ever
# truncates files it owns. That needs write permission on the FILE, not on the directory,
# which removes the question of what the base image chowns where.

set -eu

HTPASSWD=/etc/nginx/.htpasswd
AUTH_CONF=/etc/nginx/viewer-auth.conf

AUTH="${VIEWER_AUTH:-on}"

# `${VAR-}`, not `${VAR:-default}`. There is no default credential: an image that invents
# one ships a published password as the only authentication in the system. The `-` form
# also lets an EXPLICITLY EMPTY value through to the guard below, where it belongs —
# `:-` substitutes on empty as well as unset, which is how `VIEWER_PASSWORD=` (what compose
# produces from an unset host variable) used to become a working password instead of a
# refusal, and how the guard below came to be unreachable.
USER_NAME="${VIEWER_USER-}"
PASSWORD="${VIEWER_PASSWORD-}"

log() { echo "40-viewer-auth.sh: $*"; }

# Only the literal "off" disables the gate. A typo, an empty value, "false", "0" — all of
# them mean on. The safe direction for a misread variable is closed.
if [ "$AUTH" = "off" ]; then
	log "WARNING: VIEWER_AUTH=off — /api/* is UNAUTHENTICATED."
	log "  Everything the EMS serves (live device readings, the site's device list, worker"
	log "  and replay state) is readable by anything that can reach this port. That is only"
	log "  safe on a loopback bind or behind a tunnel."
	printf 'auth_basic off;\n' >"$AUTH_CONF"
	: >"$HTPASSWD"
	exit 0
fi

# "file" means an operator bind-mounted their own .htpasswd — more than one user, or a
# password that never enters an environment variable. Leave it entirely alone.
if [ "$AUTH" = "file" ]; then
	if [ ! -s "$HTPASSWD" ]; then
		log "ERROR: VIEWER_AUTH=file but $HTPASSWD is missing or empty."
		log "  Mount one, or unset VIEWER_AUTH to use VIEWER_USER/VIEWER_PASSWORD."
		exit 1
	fi
	log "using the mounted $HTPASSWD"
	exit 0
fi

# The container refuses to start rather than gate itself with something guessable. This is
# the reachable version of the guard that used to sit here: the `:-admin` defaults above
# meant neither variable could ever be empty by the time it ran, so it never fired once.
#
# Refusing is safe by construction. The Dockerfile creates both targets in the gated state
# with an empty .htpasswd, so a container that never gets here rejects everyone; nothing is
# left half-configured by exiting.
if [ -z "$USER_NAME" ] || [ -z "$PASSWORD" ]; then
	log "ERROR: VIEWER_USER and VIEWER_PASSWORD must both be set and non-empty."
	log "  Refusing to start rather than ship a default credential — this nginx is the only"
	log "  authentication in front of the EMS, so a guessable one is the same as none."
	log "  Set both, mount your own .htpasswd with VIEWER_AUTH=file, or state the risk"
	log "  explicitly with VIEWER_AUTH=off."
	exit 1
fi

# htpasswd -n, NOT -c. The file-writing path creates its temp file in the current working
# directory, which is / here and is not writable by this user; -n prints "user:hash" to
# stdout and touches no file at all. -i reads the password from stdin so it never lands in
# /proc/*/cmdline. -B is bcrypt, which nginx verifies through crypt(3).
#
# Cost 8 rather than the default 5: nginx re-verifies on EVERY request, synchronously, in
# the worker process. Cost 12 would put a quarter of a second of blocked worker in front of
# each poll; cost 8 is single-digit milliseconds and invisible at any sane cadence.
#
# The hash buys less than it looks like — the plaintext is in this container's own
# environment, so anyone who can read the file can read the variable. It is here for format
# compatibility with an operator-supplied .htpasswd, and so a diagnostic `docker exec cat`
# does not put the password in a chat log.
if ! entry="$(printf '%s\n' "$PASSWORD" | htpasswd -i -n -B -C 8 "$USER_NAME" 2>/dev/null)"; then
	log "ERROR: could not hash the password."
	exit 1
fi

printf '%s\n' "$entry" >"$HTPASSWD"
printf 'auth_basic "Motrix Edge View";\nauth_basic_user_file %s;\n' "$HTPASSWD" >"$AUTH_CONF"

# Said at every start, because it is true at every start and it is the thing an operator is
# most likely to assume away. Matches the house style of the EMS's own non-loopback warning.
log "gating /api/* for user '$USER_NAME'. Basic auth sends this password base64-encoded —"
log "  reversibly — on every request. Put TLS in front before exposing this beyond loopback."
