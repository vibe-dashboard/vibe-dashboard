"""Exercise the container healthcheck without a Docker host or root access."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/vkvd-healthcheck.sh"


class HealthcheckTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.env = dict(os.environ, PATH=f"{self.root}:{os.environ['PATH']}",
                        CALL_LOG=str(self.root / "calls"),
                        DOCKER_CONTEXT="unrelated-remote-context",
                        DOCKER_TLS_VERIFY="1")
        self.stub("supervisorctl", 'echo "caddy ${CADDY_STATE:-RUNNING}"; exit "${SUPERVISOR_EXIT:-0}"')
        self.stub("runuser", '''
test "$1 $2 $3" = '-u vkuser --' || exit 90
shift 3
exec "$@"
''')
        self.stub("docker", '''
printf '%s\n' "$*" >> "$CALL_LOG"
test "$*" = '--host=unix:///var/run/docker.sock info' || exit 91
test -z "${DOCKER_CONTEXT:-}${DOCKER_TLS_VERIFY:-}" || exit 92
exit "${DOCKER_EXIT:-0}"
''')

    def stub(self, name, body):
        path = self.root / name
        path.write_text(f"#!/bin/sh\n{body}\n")
        path.chmod(0o755)

    def run_check(self, **env):
        return subprocess.run(["bash", str(SCRIPT)], env=dict(self.env, **env),
                              capture_output=True, text=True, timeout=12)

    def test_runc_does_not_require_docker(self):
        result = self.run_check(VKVD_CONTAINER_RUNTIME="runc", DOCKER_EXIT="1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.root / "calls").exists())

    def test_sysbox_checks_local_docker_as_agent_despite_inherited_context(self):
        result = self.run_check(VKVD_CONTAINER_RUNTIME="sysbox-runc")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / "calls").read_text().strip(),
                         "--host=unix:///var/run/docker.sock info")

    def test_unavailable_or_inaccessible_docker_is_unhealthy(self):
        result = self.run_check(VKVD_CONTAINER_RUNTIME="sysbox-runc", DOCKER_EXIT="1")
        self.assertNotEqual(result.returncode, 0)

    def test_caddy_not_running_is_unhealthy(self):
        result = self.run_check(CADDY_STATE="FATAL")
        self.assertNotEqual(result.returncode, 0)

    def test_supervisor_failure_is_unhealthy_even_if_output_says_running(self):
        result = self.run_check(SUPERVISOR_EXIT="1")
        self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
