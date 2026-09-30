type IframeShortcutAction = 'cycle-next' | 'cycle-prev';

type ShortcutDecision =
  | { action: IframeShortcutAction }
  | { action: null; reason: string };

const INSTALL_FLAG = '__vkIframeShortcutBridgeInstalled';
const CAPTURE_PHASE = { capture: true } as const;
const LOG_PREFIX = '[VK iframe shortcuts]';

declare global {
  interface Window {
    [INSTALL_FLAG]?: boolean;
  }
}

function debugLog(message: string, details?: Record<string, unknown>) {
  if (details) {
    console.debug(LOG_PREFIX, message, details);
  } else {
    console.debug(LOG_PREFIX, message);
  }
}

function describeShortcutEvent(event: KeyboardEvent) {
  return {
    key: event.key,
    code: event.code,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    defaultPrevented: event.defaultPrevented,
    isComposing: event.isComposing,
    isTextEditingTarget: isTextEditingTarget(event.target),
  };
}

function isTextEditingTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;

  const tagName = target.tagName;
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
    return true;
  }

  return Boolean(
    target.closest('[contenteditable]:not([contenteditable="false"])')
  );
}

function isShortcutCandidate(event: KeyboardEvent) {
  return (
    event.key === '[' ||
    event.key === ']' ||
    event.code === 'BracketLeft' ||
    event.code === 'BracketRight'
  );
}

function getIframeShortcutAction(event: KeyboardEvent): ShortcutDecision {
  if (event.defaultPrevented) {
    return { action: null, reason: 'default already prevented' };
  }
  if (event.isComposing) {
    return { action: null, reason: 'IME composition in progress' };
  }
  if (!event.ctrlKey) {
    return { action: null, reason: 'Ctrl key is not pressed' };
  }
  if (event.metaKey) {
    return { action: null, reason: 'Meta key is pressed' };
  }
  if (event.altKey) {
    return { action: null, reason: 'Alt key is pressed' };
  }
  if (event.shiftKey) {
    return { action: null, reason: 'Shift key is pressed' };
  }
  if (event.key === ']' || event.code === 'BracketRight') {
    return { action: 'cycle-next' };
  }

  if (event.key === '[' || event.code === 'BracketLeft') {
    return { action: 'cycle-prev' };
  }

  return { action: null, reason: 'key is not a bracket shortcut' };
}

export function installIframeShortcutBridge() {
  if (window[INSTALL_FLAG]) return;

  window[INSTALL_FLAG] = true;

  const handledEvents = new WeakSet<KeyboardEvent>();
  const onKeyDown = (event: KeyboardEvent) => {
    if (handledEvents.has(event)) return;
    handledEvents.add(event);

    const decision = getIframeShortcutAction(event);
    if (!decision.action) {
      if (isShortcutCandidate(event)) {
        debugLog('shortcut candidate rejected', {
          reason: decision.reason,
          event: describeShortcutEvent(event),
        });
      }
      return;
    }

    debugLog('shortcut matched; posting message to parent', {
      action: decision.action,
      event: describeShortcutEvent(event),
    });

    window.parent.postMessage(
      { type: 'vk-iframe-shortcut', action: decision.action },
      '*'
    );
  };

  window.addEventListener('keydown', onKeyDown, CAPTURE_PHASE);
  document.addEventListener('keydown', onKeyDown, CAPTURE_PHASE);
}
