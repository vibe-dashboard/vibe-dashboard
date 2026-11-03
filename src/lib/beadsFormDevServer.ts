export const BEADS_FORM_DISABLE_HMR_ENV = 'BEADS_FORM_DISABLE_HMR';

export type DevServerEnv = Record<string, string | undefined>;

export function isTruthyEnvValue(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value ?? '');
}

export function shouldDisableBeadsFormHmr(env: DevServerEnv = process.env): boolean {
  return isTruthyEnvValue(env[BEADS_FORM_DISABLE_HMR_ENV]);
}

export function resolveDevPort(env: DevServerEnv = process.env): number {
  const rawPort = env.PORT ?? '';
  const parsed = Number.parseInt(rawPort, 10);
  return Number.isNaN(parsed) ? 3000 : parsed;
}

export function buildViteDevServerOptions(env: DevServerEnv = process.env): {
  port: number;
  host: true;
  hmr?: false;
  proxy: {
    '/api': {
      target: string;
      changeOrigin: true;
      ws: true;
      rewriteWsOrigin: true;
      headers: { Origin: string };
    };
    '/vk-api': {
      target: string;
      changeOrigin: true;
      rewrite: (path: string) => string;
      headers: { Origin: string };
    };
  };
} {
  const vkBackendOrigin = `http://localhost:${env.BACKEND_PORT || '3007'}`;
  const proxyOrigin =
    env.VITE_VK_PROXY_ORIGIN ||
    env.VK_ALLOWED_ORIGINS?.split(',')
      .map((origin) => origin.trim())
      .find((origin) => origin && !origin.includes('*')) ||
    vkBackendOrigin;
  return {
    port: resolveDevPort(env),
    host: true,
    ...(shouldDisableBeadsFormHmr(env) ? { hmr: false as const } : {}),
    proxy: {
      '/api': {
        target: vkBackendOrigin,
        changeOrigin: true,
        ws: true,
        rewriteWsOrigin: true,
        headers: { Origin: proxyOrigin },
      },
      '/vk-api': {
        target: vkBackendOrigin,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/vk-api/, '/api'),
        headers: { Origin: proxyOrigin },
      },
    },
  };
}

export function buildBeadsFormPreviewDevEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    [BEADS_FORM_DISABLE_HMR_ENV]: env[BEADS_FORM_DISABLE_HMR_ENV] ?? '1',
  };
}
