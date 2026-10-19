# Colima Sysbox profile

This directory contains a repeatable macOS setup for running the Vibe Dashboard
Docker app with Sysbox-backed Docker-in-Docker.

## Setup

```bash
brew install colima docker
./scripts/setup-sysbox.sh
```

The setup script creates/updates a native-architecture Colima profile named
`vd-sysbox`, switches Docker to `colima-vd-sysbox`, installs Sysbox in the Linux
VM, and verifies that `sysbox-runc` can launch a container.

Override the profile name if needed:

```bash
COLIMA_SYSBOX_PROFILE=my-profile ./scripts/setup-sysbox.sh
```

## Verify

```bash
./scripts/colima/check-sysbox.sh
DOCKER_CONTEXT=colima-vd-sysbox ./scripts/smoke-sysbox-dind.sh
```

## Use with compose

```bash
VKVD_CONTAINER_RUNTIME=sysbox-runc DOCKER_CONTEXT=colima-vd-sysbox docker compose up -d code-vibe
```

## Switch back to OrbStack

```bash
docker context use orbstack
```
