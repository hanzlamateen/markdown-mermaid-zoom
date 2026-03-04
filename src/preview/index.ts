import mermaid from 'mermaid';
import { loadExtensionConfig } from '../shared/mermaidRenderer';
import { DiagramManager } from '../shared/diagramManager';
import { IDisposable } from '../shared/disposable';

let currentDisposables: IDisposable[] = [];
const diagramManager = new DiagramManager(loadExtensionConfig());
let renderGeneration = 0;

function getTheme(): string {
  const isDark =
    document.body.classList.contains('vscode-dark') ||
    document.body.classList.contains('vscode-high-contrast');
  const cfg = loadExtensionConfig();
  return isDark ? cfg.darkModeTheme : cfg.lightModeTheme;
}

async function renderDiagrams(
  elements: HTMLElement[],
  theme: string,
  maxTextSize: number
): Promise<void> {
  mermaid.initialize({
    startOnLoad: false,
    theme: theme as any,
    maxTextSize,
  });

  // Restore source text and clear processed flag so mermaid.run() re-renders
  for (const el of elements) {
    const encoded = el.getAttribute('data-mermaid-source');
    if (encoded) {
      el.textContent = decodeURIComponent(encoded);
    }
    el.removeAttribute('data-processed');
  }

  await mermaid.run({
    nodes: elements,
    suppressErrors: true,
  });
}

async function init() {
  const gen = ++renderGeneration;

  for (const d of currentDisposables) {
    d.dispose();
  }
  currentDisposables = [];

  const extConfig = loadExtensionConfig();
  diagramManager.updateConfig(extConfig);

  if (gen !== renderGeneration) {
    return;
  }

  // Unwrap .mermaid elements from stale DiagramManager wrappers
  document.body.querySelectorAll('.mermaid-wrapper').forEach((wrapper) => {
    const inner = wrapper.querySelector('.mermaid');
    if (inner && wrapper.parentNode) {
      wrapper.parentNode.insertBefore(inner, wrapper);
      wrapper.remove();
    }
  });

  const mermaidElements = Array.from(
    document.body.querySelectorAll<HTMLElement>('.mermaid')
  );

  if (mermaidElements.length === 0) {
    return;
  }

  const theme = getTheme();

  // First attempt
  await renderDiagrams(mermaidElements, theme, extConfig.maxTextSize);

  if (gen !== renderGeneration) {
    return;
  }

  // Check if any element failed to render (no SVG produced).
  // If so, re-initialize mermaid fully and retry those elements.
  const failed = mermaidElements.filter((el) => !el.querySelector('svg'));
  if (failed.length > 0) {
    await renderDiagrams(failed, theme, extConfig.maxTextSize);
    if (gen !== renderGeneration) {
      return;
    }
  }

  // Set up DiagramManager for each successfully rendered element
  const activeIds = new Set<string>();
  const stamp = Date.now();

  for (let i = 0; i < mermaidElements.length; i++) {
    const el = mermaidElements[i];
    if (!el.querySelector('svg')) {
      continue;
    }
    const id = 'mermaid-' + stamp + '-' + i;
    el.id = id;
    activeIds.add(id);
    currentDisposables.push(diagramManager.setup(id, el));
  }

  diagramManager.retainStates(activeIds);
}

let initTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleInit() {
  clearTimeout(initTimer);
  initTimer = setTimeout(init, 50);
}

window.addEventListener('vscode.markdown.updateContent', scheduleInit);
scheduleInit();
