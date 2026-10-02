#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

const sourcePaths = {
  codex: path.join('crates', 'executors', 'src', 'executors', 'codex.rs'),
  claude: path.join('crates', 'executors', 'src', 'executors', 'claude.rs'),
  executorsCargoToml: path.join('crates', 'executors', 'Cargo.toml'),
  cargoLock: 'Cargo.lock',
};

const fixtures = [
  {
    cli: 'codex',
    package: '@openai/codex',
    currentVersion: readPackageVersion(sourcePaths.codex, '@openai/codex@'),
  },
  {
    cli: 'claude',
    package: '@anthropic-ai/claude-code',
    currentVersion: readPackageVersion(
      sourcePaths.claude,
      '@anthropic-ai/claude-code@'
    ),
  },
];

runNormalizeCheck();
checkCodexProtocolVersions(fixtures[0].currentVersion);

for (const fixture of fixtures) {
  const current = checkMetadata(fixture, 'current');
  const previous = checkMetadata(fixture, 'previous');
  if (current.version !== fixture.currentVersion) {
    throw new Error(
      `${fixture.cli} current fixture version must match pinned source version ` +
        `${fixture.currentVersion}, got ${current.version}`
    );
  }
  if (previous.version === current.version) {
    throw new Error(
      `${fixture.cli} previous fixture version must differ from current version ${current.version}`
    );
  }
}

console.log('agent fixture metadata and JSONL checks passed');

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function readPackageVersion(relativePath, packagePrefix, content = readRepoFile(relativePath)) {
  const marker = packagePrefix;
  const start = content.indexOf(marker);
  if (start === -1) {
    throw new Error(`${relativePath} does not contain ${packagePrefix}`);
  }
  return content
    .slice(start + marker.length)
    .split(/["\s]/)[0]
    .trim();
}

function checkCodexProtocolVersions(codexVersion) {
  const expectedTag = `rust-v${codexVersion}`;
  const cargoToml = readRepoFile(sourcePaths.executorsCargoToml);
  assertDependencyTag(cargoToml, 'codex-protocol', expectedTag);
  assertDependencyTag(cargoToml, 'codex-app-server-protocol', expectedTag);

  const cargoLock = readRepoFile(sourcePaths.cargoLock);
  assertLockPackage(cargoLock, 'codex-protocol', codexVersion, expectedTag);
  assertLockPackage(
    cargoLock,
    'codex-app-server-protocol',
    codexVersion,
    expectedTag
  );
}

function assertDependencyTag(cargoToml, dependency, expectedTag) {
  const line = cargoToml
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(`${dependency} = `));
  if (!line || !line.includes(`tag = "${expectedTag}"`)) {
    throw new Error(`${dependency} must use tag ${expectedTag}`);
  }
}

function assertLockPackage(lock, packageName, expectedVersion, expectedTag) {
  const block = lock
    .split('[[package]]')
    .find((candidate) => candidate.includes(`name = "${packageName}"`));
  if (!block) {
    throw new Error(`Cargo.lock is missing ${packageName}`);
  }
  if (!block.includes(`version = "${expectedVersion}"`)) {
    throw new Error(`${packageName} Cargo.lock version must be ${expectedVersion}`);
  }
  if (!block.includes(`tag=${expectedTag}`)) {
    throw new Error(`${packageName} Cargo.lock source must use ${expectedTag}`);
  }
}

function checkMetadata(fixture, versionRole) {
  const metadataPath = path.join(
    repoRoot,
    'crates',
    'executors',
    'tests',
    'fixtures',
    'agent-cli',
    fixture.cli,
    versionRole,
    'metadata.json'
  );
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
  const expected = {
    cli: fixture.cli,
    package: fixture.package,
    version_role: versionRole,
    captured_from: 'committed_raw_fixture',
    raw_fixture: 'stdout.jsonl',
    compatibility_scope: 'normalization_no_migration',
  };

  for (const [key, value] of Object.entries(expected)) {
    if (metadata[key] !== value) {
      throw new Error(
        `${path.relative(repoRoot, metadataPath)} ${key} must be ${JSON.stringify(
          value
        )}, got ${JSON.stringify(metadata[key])}`
      );
    }
  }

  if (typeof metadata.version !== 'string' || metadata.version.trim() === '') {
    throw new Error(
      `${path.relative(repoRoot, metadataPath)} version must be a non-empty string`
    );
  }

  const rawFixturePath = path.join(path.dirname(metadataPath), metadata.raw_fixture);
  readFileSync(rawFixturePath, 'utf8');

  return metadata;
}

function runNormalizeCheck() {
  const result = spawnSync(
    process.execPath,
    [path.join(repoRoot, 'scripts', 'agent-fixtures', 'normalize.mjs'), '--check'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'inherit',
    }
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
