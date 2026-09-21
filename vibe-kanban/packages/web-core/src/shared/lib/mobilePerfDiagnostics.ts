type DiagnosticPrimitive = string | number | boolean | null;
type DiagnosticDetails = Record<
  string,
  DiagnosticPrimitive | DiagnosticPrimitive[] | undefined
>;

export interface MobilePerfDiagnosticEvent {
  ts: number;
  name: string;
  details?: DiagnosticDetails;
}

export interface MobilePerfDiagnosticsApi {
  enabled: boolean;
  buffer: MobilePerfDiagnosticEvent[];
  record: (name: string, details?: DiagnosticDetails) => void;
  snapshot: () => MobilePerfDiagnosticEvent[];
  clear: () => void;
  enable: () => void;
  disable: () => void;
}

declare global {
  interface Window {
    __VK_MOBILE_PERF_DIAGNOSTICS__?: MobilePerfDiagnosticsApi;
  }

  interface Performance {
    memory?: {
      usedJSHeapSize?: number;
      totalJSHeapSize?: number;
      jsHeapSizeLimit?: number;
    };
    measureUserAgentSpecificMemory?: () => Promise<{
      bytes?: number;
      breakdown?: Array<{ bytes?: number }>;
    }>;
  }
}

const LOCAL_STORAGE_KEY = 'vk.mobilePerfDiagnostics';
const MAX_EVENTS = 500;
const HEARTBEAT_INTERVAL_MS = 1000;
const STALL_THRESHOLD_MS = 250;
const VIEWPORT_EVENT_THROTTLE_MS = 1000;
const MEMORY_SAMPLE_INTERVAL_MS = 30000;

const buffer: MobilePerfDiagnosticEvent[] = [];
let installed = false;
let enabled = false;
let lastViewportEventAt = 0;
let lastMemorySampleAt = 0;
let pendingUserAgentMemorySample = false;

function readEnvFlag(): boolean {
  return import.meta.env.VITE_VK_MOBILE_PERF_DIAGNOSTICS === '1';
}

function readLocalStorageFlag(): boolean {
  try {
    return window.localStorage.getItem(LOCAL_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function setLocalStorageFlag(value: boolean) {
  try {
    if (value) {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, '1');
    } else {
      window.localStorage.removeItem(LOCAL_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors in private browsing or restricted contexts.
  }
}

function detectMobile(): boolean {
  const ua = navigator.userAgent;
  const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches;
  const narrowViewport = window.innerWidth <= 768;
  return (
    /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ||
    !!coarsePointer ||
    narrowViewport
  );
}

function activeElementType(): string | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  const tag = active.tagName.toLowerCase();
  const inputType =
    active instanceof HTMLInputElement && active.type ? `:${active.type}` : '';
  const editable = active.isContentEditable ? ':contenteditable' : '';
  return `${tag}${inputType}${editable}`;
}

function viewportDetails(): DiagnosticDetails {
  const vv = window.visualViewport;
  return {
    viewport_width: window.innerWidth,
    viewport_height: window.innerHeight,
    visual_viewport_width: vv ? Math.round(vv.width) : undefined,
    visual_viewport_height: vv ? Math.round(vv.height) : undefined,
    visual_viewport_offset_top: vv ? Math.round(vv.offsetTop) : undefined,
    visual_viewport_scale: vv ? Number(vv.scale.toFixed(3)) : undefined,
    device_pixel_ratio: Number(window.devicePixelRatio.toFixed(3)),
    orientation:
      window.innerWidth > window.innerHeight ? 'landscape' : 'portrait',
    visibility_state: document.visibilityState,
    active_element: activeElementType(),
    mobile_detected: detectMobile(),
  };
}

function memoryDetails(): DiagnosticDetails {
  const memory = performance.memory;
  if (!memory) return {};
  return {
    used_js_heap_mb: memory.usedJSHeapSize
      ? Math.round(memory.usedJSHeapSize / 1024 / 1024)
      : undefined,
    total_js_heap_mb: memory.totalJSHeapSize
      ? Math.round(memory.totalJSHeapSize / 1024 / 1024)
      : undefined,
    js_heap_limit_mb: memory.jsHeapSizeLimit
      ? Math.round(memory.jsHeapSizeLimit / 1024 / 1024)
      : undefined,
  };
}

function sanitizeDetails(details: DiagnosticDetails): DiagnosticDetails {
  const sanitized: DiagnosticDetails = {};
  for (const [key, value] of Object.entries(details)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      sanitized[key] = value
        .slice(0, 20)
        .map((item) =>
          typeof item === 'string' && item.length > 120
            ? `${item.slice(0, 117)}...`
            : item
        );
      continue;
    }
    sanitized[key] =
      typeof value === 'string' && value.length > 120
        ? `${value.slice(0, 117)}...`
        : value;
  }
  return sanitized;
}

function record(name: string, details?: DiagnosticDetails) {
  if (!enabled) return;

  const event: MobilePerfDiagnosticEvent = {
    ts: Math.round(performance.now()),
    name,
    details: details ? sanitizeDetails(details) : undefined,
  };
  buffer.push(event);
  if (buffer.length > MAX_EVENTS) {
    buffer.splice(0, buffer.length - MAX_EVENTS);
  }

  // Intentionally console.debug only and opt-in only; no network telemetry.
  console.debug('[vk-mobile-perf]', event.name, event.details ?? {});
}

function sampleMemory(reason: string) {
  if (!enabled) return;

  const now = performance.now();
  if (now - lastMemorySampleAt < MEMORY_SAMPLE_INTERVAL_MS) return;
  lastMemorySampleAt = now;

  const syncMemory = memoryDetails();
  if (Object.keys(syncMemory).length > 0) {
    record('memory.snapshot', { reason, ...syncMemory });
  }

  if (
    performance.measureUserAgentSpecificMemory &&
    !pendingUserAgentMemorySample
  ) {
    pendingUserAgentMemorySample = true;
    void performance
      .measureUserAgentSpecificMemory()
      .then((result) => {
        record('memory.user_agent_specific', {
          reason,
          bytes_mb: result.bytes
            ? Math.round(result.bytes / 1024 / 1024)
            : undefined,
          breakdown_count: result.breakdown?.length ?? 0,
        });
      })
      .catch((error: unknown) => {
        record('memory.user_agent_specific_failed', {
          reason,
          error_name: error instanceof Error ? error.name : 'unknown',
        });
      })
      .finally(() => {
        pendingUserAgentMemorySample = false;
      });
  }
}

function recordViewportEvent(name: string) {
  const now = performance.now();
  if (now - lastViewportEventAt < VIEWPORT_EVENT_THROTTLE_MS) return;
  lastViewportEventAt = now;
  record(name, viewportDetails());
}

function installLongTaskObserver() {
  if (!('PerformanceObserver' in window)) return;

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        record('browser.longtask', {
          duration_ms: Math.round(entry.duration),
          start_time_ms: Math.round(entry.startTime),
          visibility_state: document.visibilityState,
          active_element: activeElementType(),
        });
        sampleMemory('longtask');
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
  } catch {
    record('browser.longtask_unsupported');
  }
}

function installHeartbeat() {
  let expected = performance.now() + HEARTBEAT_INTERVAL_MS;
  window.setInterval(() => {
    const now = performance.now();
    const lag = now - expected;
    expected = now + HEARTBEAT_INTERVAL_MS;

    if (lag >= STALL_THRESHOLD_MS) {
      record('browser.event_loop_stall', {
        lag_ms: Math.round(lag),
        ...viewportDetails(),
        ...memoryDetails(),
      });
      sampleMemory('event-loop-stall');
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function installLifecycleListeners() {
  const recordLifecycle = (name: string) => {
    record(name, {
      ...viewportDetails(),
      ...memoryDetails(),
    });
  };

  document.addEventListener('visibilitychange', () => {
    recordLifecycle('page.visibilitychange');
  });
  window.addEventListener('pagehide', () => recordLifecycle('page.pagehide'));
  window.addEventListener('pageshow', () => recordLifecycle('page.pageshow'));
  document.addEventListener('freeze', () => recordLifecycle('page.freeze'));
  document.addEventListener('resume', () => recordLifecycle('page.resume'));
}

function installViewportListeners() {
  window.addEventListener('resize', () =>
    recordViewportEvent('viewport.resize')
  );
  window.visualViewport?.addEventListener('resize', () =>
    recordViewportEvent('viewport.visual_resize')
  );
  window.visualViewport?.addEventListener('scroll', () =>
    recordViewportEvent('viewport.visual_scroll')
  );
  document.addEventListener('focusin', () =>
    recordViewportEvent('input.focusin')
  );
  document.addEventListener('focusout', () =>
    recordViewportEvent('input.focusout')
  );
}

function installDiagnostics() {
  if (installed) return;
  installed = true;

  installLongTaskObserver();
  installHeartbeat();
  installLifecycleListeners();
  installViewportListeners();

  record('diagnostics.initialized', {
    env_enabled: readEnvFlag(),
    storage_enabled: readLocalStorageFlag(),
    longtask_supported:
      typeof PerformanceObserver !== 'undefined' &&
      PerformanceObserver.supportedEntryTypes?.includes('longtask'),
    performance_memory_supported: !!performance.memory,
    ua_specific_memory_supported: !!performance.measureUserAgentSpecificMemory,
    ...viewportDetails(),
  });
  sampleMemory('initialized');
}

export function isMobilePerfDiagnosticsEnabled(): boolean {
  return enabled;
}

export function recordMobilePerfDiagnostic(
  name: string,
  details?: DiagnosticDetails
) {
  record(name, details);
}

export function initializeMobilePerfDiagnostics() {
  if (typeof window === 'undefined') return;
  enabled = readEnvFlag() || readLocalStorageFlag();

  window.__VK_MOBILE_PERF_DIAGNOSTICS__ = {
    get enabled() {
      return enabled;
    },
    buffer,
    record,
    snapshot: () => [...buffer],
    clear: () => {
      buffer.length = 0;
    },
    enable: () => {
      enabled = true;
      setLocalStorageFlag(true);
      installDiagnostics();
      record('diagnostics.enabled', viewportDetails());
    },
    disable: () => {
      record('diagnostics.disabled');
      enabled = false;
      setLocalStorageFlag(false);
    },
  };

  if (enabled) {
    installDiagnostics();
  }
}
