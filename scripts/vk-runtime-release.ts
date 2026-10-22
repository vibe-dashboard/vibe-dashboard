import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const exec = promisify(execFile);

export class VkRuntimeRelease {
  readonly contentHash: string;
  readonly tag: string;
  readonly artifactRoot: string;
  readonly binaryPath: string;
  private readonly archiveName: string;
  private readonly platform: string;

  constructor(vdRoot: string, contentHash: string) {
    if (!/^[0-9a-f]{64}$/.test(contentHash)) {
      throw new Error(
        'VK_MOCKED_CONTENT_HASH must be a full lowercase SHA-256 content hash',
      );
    }
    this.contentHash = contentHash;
    this.tag = `vk-assets-sha256-${contentHash}`;
    this.platform = `${process.platform === 'darwin' ? 'macos' : process.platform}-${process.arch}`;
    if (!['linux-x64', 'linux-arm64', 'macos-arm64'].includes(this.platform)) {
      throw new Error(`Unsupported VK runtime platform: ${this.platform}`);
    }
    this.archiveName = `vibe-kanban-${this.platform}.tar.gz`;
    this.artifactRoot = join(
      vdRoot,
      '.vk-mocked-sandbox',
      'vk-runtime-releases',
      this.tag,
      this.platform,
    );
    this.binaryPath = join(this.artifactRoot, 'extracted', 'vibe-kanban');
  }

  static async forCheckout(
    vdRoot: string,
    env: NodeJS.ProcessEnv,
  ): Promise<VkRuntimeRelease> {
    const contentHash =
      env.VK_MOCKED_CONTENT_HASH?.trim() ||
      env.VK_MOCKED_RELEASE_HASH?.trim() ||
      (
        await exec('bash', ['.github/scripts/vk-content-hash.sh'], {
          cwd: vdRoot,
        })
      ).stdout.trim();
    return new VkRuntimeRelease(vdRoot, contentHash);
  }

  async download(
    repo = 'vibe-dashboard/vibe-kanban',
    waitSeconds = 0,
  ): Promise<void> {
    if (!Number.isFinite(waitSeconds) || waitSeconds < 0) {
      throw new Error(
        'VK_MOCKED_RELEASE_WAIT_SECONDS must be a nonnegative number',
      );
    }
    await mkdir(this.artifactRoot, { recursive: true });
    const deadline = Date.now() + waitSeconds * 1000;
    for (;;) {
      try {
        await exec('gh', [
          'release',
          'download',
          this.tag,
          '--repo',
          repo,
          '--dir',
          this.artifactRoot,
          '--pattern',
          this.archiveName,
          '--pattern',
          `${this.archiveName}.sha256`,
          '--pattern',
          'manifest.json',
          '--clobber',
        ]);
        break;
      } catch (error) {
        if (Date.now() >= deadline) throw error;
        console.log(
          `[vk-mocked-sandbox] Waiting for remote release ${this.tag}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 10_000));
      }
    }
    await this.verify();
    const extractDir = join(this.artifactRoot, 'extracted');
    await rm(extractDir, { recursive: true, force: true });
    await mkdir(extractDir, { recursive: true });
    await exec('tar', [
      '-xzf',
      join(this.artifactRoot, this.archiveName),
      '-C',
      extractDir,
    ]);
    await chmod(this.binaryPath, 0o755);
    console.log(
      `[vk-mocked-sandbox] Verified remote VK ${this.tag}: ${this.binaryPath}`,
    );
  }

  async verify(): Promise<void> {
    const manifest = JSON.parse(
      await readFile(join(this.artifactRoot, 'manifest.json'), 'utf8'),
    );
    if (
      manifest.vk_content_hash !== this.contentHash ||
      manifest.release_tag !== this.tag
    ) {
      throw new Error(
        `VK release manifest does not match requested content ${this.contentHash}`,
      );
    }
    const asset = manifest.platforms?.[this.platform]?.assets?.['vibe-kanban'];
    if (
      asset?.file !== this.archiveName ||
      !/^[0-9a-f]{64}$/.test(asset?.sha256 ?? '')
    ) {
      throw new Error(
        `VK release manifest is missing ${this.platform} archive/checksum`,
      );
    }
    const archive = await readFile(join(this.artifactRoot, this.archiveName));
    if (createHash('sha256').update(archive).digest('hex') !== asset.sha256) {
      throw new Error('VK runtime archive does not match manifest checksum');
    }
    await exec('sha256sum', ['-c', `${this.archiveName}.sha256`], {
      cwd: this.artifactRoot,
    });
  }
}
