import mermaid, { MermaidConfig } from 'mermaid';
import { MermaidExtensionConfig } from './config';

/**
 * Renders a single mermaid container element.
 */
function renderMermaidElement(
  mermaidContainer: HTMLElement,
  usedIds: Set<string>,
  writeOut: (mermaidContainer: HTMLElement, content: string) => void,
  signal?: AbortSignal
): {
  containerId: string;
  contentHash: string;
  p: Promise<void>;
} | undefined {
  const source = (mermaidContainer.textContent ?? '').trim();
  if (!source) {
    return;
  }

  const contentHash = hashString(source);
  const containerId = generateContentId(source, usedIds);
  const diagramId = `d${containerId}`;

  mermaidContainer.id = containerId;
  mermaidContainer.innerHTML = '';

  return {
    containerId,
    contentHash,
    p: (async () => {
      try {
        await mermaid.parse(source);
        if (signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        const renderResult = await mermaid.render(diagramId, source);
        if (signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        writeOut(mermaidContainer, renderResult.svg);
        renderResult.bindFunctions?.(mermaidContainer);
      } catch (error) {
        if (error instanceof Error && error.name !== 'AbortError') {
          const errorMessageNode = document.createElement('pre');
          errorMessageNode.className = 'mermaid-error';
          errorMessageNode.innerText = error.message;
          writeOut(mermaidContainer, errorMessageNode.outerHTML);
        }
        throw error;
      }
    })(),
  };
}

/**
 * Finds all .mermaid elements in a root and renders them.
 */
export async function renderMermaidBlocksInElement(
  root: HTMLElement,
  writeOut: (
    mermaidContainer: HTMLElement,
    content: string,
    contentHash: string
  ) => void,
  signal?: AbortSignal
): Promise<void> {
  const usedIds = new Set<string>();

  // Remove existing rendered output
  for (const el of root.querySelectorAll('.mermaid > svg')) {
    el.remove();
  }
  for (const svg of root.querySelectorAll('svg')) {
    if (svg.parentElement?.id.startsWith('dmermaid')) {
      svg.parentElement.remove();
    }
  }

  const renderPromises: Array<Promise<void>> = [];
  for (const mermaidContainer of root.querySelectorAll<HTMLElement>(
    '.mermaid'
  )) {
    const result = renderMermaidElement(
      mermaidContainer,
      usedIds,
      (container, content) => {
        writeOut(container, content, result!.contentHash);
      },
      signal
    );
    if (result) {
      renderPromises.push(result.p);
    }
  }

  await Promise.all(renderPromises);
}

/**
 * Reads the extension configuration from a data attribute injected by the extension host.
 */
export function loadExtensionConfig(): MermaidExtensionConfig {
  const defaultConfig: MermaidExtensionConfig = {
    darkModeTheme: 'dark',
    lightModeTheme: 'default',
    maxTextSize: 50000,
    clickDrag: 'alt' as MermaidExtensionConfig['clickDrag'],
    showControls: 'onHoverOrFocus' as MermaidExtensionConfig['showControls'],
    fullscreen: true,
    resizable: true,
    maxHeight: '',
  };

  const configSpan = document.getElementById('markdown-mermaid-zoom');
  const configAttr = configSpan?.dataset.config;
  if (!configAttr) {
    return defaultConfig;
  }

  try {
    return { ...defaultConfig, ...JSON.parse(configAttr) };
  } catch {
    return defaultConfig;
  }
}

/**
 * Builds a MermaidConfig from the extension config and current VS Code theme.
 */
export function loadMermaidConfig(): MermaidConfig {
  const config = loadExtensionConfig();
  return {
    startOnLoad: false,
    maxTextSize: config.maxTextSize,
    theme: (document.body.classList.contains('vscode-dark') ||
    document.body.classList.contains('vscode-high-contrast')
      ? config.darkModeTheme
      : config.lightModeTheme) as MermaidConfig['theme'],
  };
}

/**
 * Simple non-cryptographic hash for content-based IDs.
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function generateContentId(source: string, usedIds: Set<string>): string {
  const hash = hashString(source);
  let id = `mermaid-${hash}`;
  let counter = 0;

  while (usedIds.has(id)) {
    counter++;
    id = `mermaid-${hash}-${counter}`;
  }

  usedIds.add(id);
  return id;
}
