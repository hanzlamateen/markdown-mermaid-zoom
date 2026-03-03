/**
 * Main entrypoint for the markdown preview webview.
 *
 * This script runs inside VS Code's markdown preview webview.
 * It initializes mermaid.js, renders all mermaid diagrams,
 * and attaches the DiagramManager for zoom/pan/fullscreen.
 */
import mermaid, { MermaidConfig } from 'mermaid';
import { loadExtensionConfig, renderMermaidBlocksInElement } from '../shared/mermaidRenderer';
import { DiagramManager } from '../shared/diagramManager';
import { IDisposable } from '../shared/disposable';

let currentAbortController: AbortController | undefined;
let currentDisposables: IDisposable[] = [];
const diagramManager = new DiagramManager(loadExtensionConfig());

async function init() {
  // Dispose previous instances
  for (const disposable of currentDisposables) {
    disposable.dispose();
  }
  currentDisposables = [];

  // Abort any in-progress render
  currentAbortController?.abort();
  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;

  const extConfig = loadExtensionConfig();
  diagramManager.updateConfig(extConfig);

  const config: MermaidConfig = {
    startOnLoad: false,
    maxTextSize: extConfig.maxTextSize,
    theme: (document.body.classList.contains('vscode-dark') ||
    document.body.classList.contains('vscode-high-contrast')
      ? extConfig.darkModeTheme
      : extConfig.lightModeTheme) as MermaidConfig['theme'],
  };

  mermaid.initialize(config);

  const activeIds = new Set<string>();
  await renderMermaidBlocksInElement(
    document.body,
    (mermaidContainer, content) => {
      mermaidContainer.innerHTML = content;
      activeIds.add(mermaidContainer.id);
      currentDisposables.push(
        diagramManager.setup(mermaidContainer.id, mermaidContainer)
      );
    },
    signal
  );

  // Clean up saved states for diagrams that no longer exist
  diagramManager.retainStates(activeIds);
}

// VS Code fires this event when the markdown preview content updates
window.addEventListener('vscode.markdown.updateContent', init);
init();
