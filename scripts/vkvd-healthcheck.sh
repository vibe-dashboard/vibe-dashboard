#!/usr/bin/env bash
set -euo pipefail

# Check the supervisor as well as the proxy. Docker is optional in runc mode.
supervisorctl status caddy | grep -q 'RUNNING'

if [ "${VKVD_CONTAINER_RUNTIME:-runc}" = "sysbox-runc" ]; then
    # Test the socket used by agents, with their permissions. A running outer
    # container or an existing socket alone does not imply a working daemon.
    timeout 8s runuser -u vkuser -- env -u DOCKER_CONTEXT -u DOCKER_TLS_VERIFY \
        docker --host=unix:///var/run/docker.sock info >/dev/null
fi
