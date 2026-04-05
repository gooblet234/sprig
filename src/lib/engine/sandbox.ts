// fixes #3764

import { normalizeGameError, type NormalizedError } from './error'
import { bitmaps } from '../state'

export interface SandboxedRunResult {
  error: NormalizedError | null
  cleanup: () => void
}
// construct the sandbox
function buildIframeHTML(transformedCode: string, apiKeys: string[]): string {
// pass all functionality to the sandbox
  const escapedCode = JSON.stringify(transformedCode)
  const escapedKeys = JSON.stringify(apiKeys)

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#000;overflow:hidden;">
<canvas id="c" width="1000" height="800" style="width:100%;height:100%;display:block;"></canvas>
<script type="module">
  import { webEngine, textToTune } from 'https://esm.sh/sprig@1/web';

  const canvas = document.getElementById('c');
  const game = webEngine(canvas);
  const tunes = [];
  const timeouts = [];
  const intervals = [];

  function postError(err) {
    parent.postMessage({ type: 'error', error: { message: err.message, stack: err.stack } }, '*');
  }

  window.addEventListener('error', (e) => {
    postError(e.error ?? new Error(e.message));
  });

  const api = {
    ...game.api,
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, ms);
      timeouts.push(t);
      return t;
    },
    setInterval: (fn, ms) => {
      const t = setInterval(fn, ms);
      intervals.push(t);
      return t;
    },
    playTune: (text, n) => {
      const tune = textToTune(text);
      const res = game.api.playTune(tune, n);
      tunes.push(res);
      return res;
    },
    console: {
      log: (...args) => {
        console.log(...args);
        parent.postMessage({ type: 'log', args: args.map(String), isErr: false }, '*');
      },
      error: (...args) => {
        console.error(...args);
        parent.postMessage({ type: 'log', args: args.map(String), isErr: true }, '*');
      }
    }
  };

  window.addEventListener('message', (e) => {
    if (e.data?.type === 'keydown') {
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: e.data.key, bubbles: true }));
    } else if (e.data?.type === 'keyup') {
      canvas.dispatchEvent(new KeyboardEvent('keyup', { key: e.data.key, bubbles: true }));
    } else if (e.data?.type === 'cleanup') {
      game.cleanup();
      tunes.forEach(t => t.end());
      timeouts.forEach(clearTimeout);
      intervals.forEach(clearInterval);
    }
  });

  try {
    const keys = ${escapedKeys};
    const code = ${escapedCode};
    const fn = new Function(...keys, code);
    fn(...Object.values(api));
    parent.postMessage({ type: 'ready' }, '*');
  } catch (err) {
    postError(err);
  }
<\/script>
</body>
</html>`
}

export function runGameSandboxed(
  transformedCode: string,
  apiKeys: string[],
  container: HTMLElement,
  onError: (error: NormalizedError) => void,
  onLog: (args: string[], isErr: boolean) => void,
): SandboxedRunResult {
  // construct iframe
  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-scripts') // DO NOT ALLOW SAME ORIGIN BRO
  iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;background:#000;'

  // package code runner into blob html
  const html = buildIframeHTML(transformedCode, apiKeys)
  const blob = new Blob([html], { type: 'text/html' })
  const blobUrl = URL.createObjectURL(blob)
  iframe.src = blobUrl

  // listener for inline sandbox
  const messageHandler = (e: MessageEvent) => {
    if (e.source !== iframe.contentWindow) return
    const msg = e.data
    if (!msg) return

    if (msg.type === 'error') {
      const syntheticError = new Error(msg.error.message)
      syntheticError.stack = msg.error.stack
      onError(normalizeGameError({ kind: 'runtime', error: syntheticError }))
    } else if (msg.type === 'log') {
      onLog(msg.args, msg.isErr)
    }
  }
  window.addEventListener('message', messageHandler)

  // keyboard forwarder
  const keydownHandler = (e: KeyboardEvent) => {
    iframe.contentWindow?.postMessage({ type: 'keydown', key: e.key }, '*')
  }
  const keyupHandler = (e: KeyboardEvent) => {
    iframe.contentWindow?.postMessage({ type: 'keyup', key: e.key }, '*')
  }
  window.addEventListener('keydown', keydownHandler)
  window.addEventListener('keyup', keyupHandler)

  container.appendChild(iframe)

  const cleanup = () => {
    iframe.contentWindow?.postMessage({ type: 'cleanup' }, '*')
    window.removeEventListener('message', messageHandler)
    window.removeEventListener('keydown', keydownHandler)
    window.removeEventListener('keyup', keyupHandler)
    iframe.remove()
    URL.revokeObjectURL(blobUrl)
  }

  return { error: null, cleanup }
}
