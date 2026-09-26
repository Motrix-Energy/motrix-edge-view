# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app
# Dependencies first, so a source edit does not reinstall them. `npm ci`, not install:
# the lockfile is the pin, and the version boundary with the EMS repo is a pinned tag all
# the way down.
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# nginx-unprivileged rather than nginx:alpine, to match the EMS image, which also runs as a
# non-root user. It listens on 8080 rather than 80 for that reason, which is why the compose
# mapping is ${VIEWER_PORT}:8080.
FROM nginxinc/nginx-unprivileged:1.27-alpine

# One runtime template, and only one: the Basic-auth credential for /api/*. The app bundle
# still has nothing baked in — it talks to the relative /api, so the same file works behind
# this nginx, behind the Vite dev proxy and from a bare double-click. The two
# deployment-coupled strings in this image are the compose DNS name `edge` in nginx.conf and
# the credential the hook below writes.
#
# apache2-utils is here for htpasswd(1) alone (~2 MB). Verified against this exact base:
# neither htpasswd nor the openssl *binary* is present (only libssl/libcrypto, which nginx
# links), and a shell implementation of apr1 would be a thousand md5sum forks.
USER root
RUN apk add --no-cache apache2-utils

COPY --from=build /app/dist/index.html /usr/share/nginx/html/index.html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
# Mode set here rather than trusted to git: a non-executable hook is *silently skipped* by
# the entrypoint, and nginx then starts with the empty .htpasswd below — 401 for everyone,
# with nothing but one log line to say why. This repo is developed on Windows.
COPY --chmod=0755 docker/docker-entrypoint.d/40-viewer-auth.sh /docker-entrypoint.d/40-viewer-auth.sh
# Line endings normalised here for the same reason, and just as silently fatal. .gitattributes
# makes a fresh clone LF, but the build context is the WORKING TREE, and a Windows editor or an
# old checkout can leave the hook CRLF there. Its shebang then reads `#!/bin/sh\r`, the
# entrypoint reports the hook "not found", and under `set -e` the container exits 127 before
# nginx ever starts.
RUN sed -i 's/\r$//' /docker-entrypoint.d/40-viewer-auth.sh

# Created here, as root, and chowned to the runtime user (uid/gid 101 — verified, the group
# is 101 and not 0 on this image). The hook then only ever *truncates* files it owns, which
# needs write permission on the file rather than on /etc/nginx.
#
# Their build-time content is the FAIL-CLOSED state: the gate is on and the password file is
# empty, so an image whose hook never runs rejects every credential rather than admitting
# every one.
RUN printf 'auth_basic "Motrix Edge View";\nauth_basic_user_file /etc/nginx/.htpasswd;\n' \
        > /etc/nginx/viewer-auth.conf \
    && : > /etc/nginx/.htpasswd \
    && chown 101:101 /etc/nginx/viewer-auth.conf /etc/nginx/.htpasswd \
    && chmod 0644 /etc/nginx/viewer-auth.conf \
    && chmod 0640 /etc/nginx/.htpasswd

USER 101

EXPOSE 8080

# Probes /, the static shell, which is public by design. That is what lets this work with no
# credential in the command, and it keeps "viewer healthy" meaning "nginx serves the app"
# rather than "the EMS is up". The viewer is genuinely healthy in file mode with the EMS
# dead, and under `restart: unless-stopped` an /api/health probe would restart it for that.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD ["/bin/sh", "-c", "wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1"]
