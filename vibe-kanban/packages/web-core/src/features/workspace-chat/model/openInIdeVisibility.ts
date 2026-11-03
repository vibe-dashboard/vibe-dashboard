interface OpenInIdeVisibilityInput {
  isMobile: boolean;
  hostname: string;
  remoteSshHost: string | null | undefined;
}

export function shouldShowOpenInIde({
  isMobile,
  hostname,
  remoteSshHost,
}: OpenInIdeVisibilityInput): boolean {
  if (isMobile) return false;
  if (remoteSshHost?.trim()) return true;

  const normalized = hostname.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '[::1]'
  );
}
