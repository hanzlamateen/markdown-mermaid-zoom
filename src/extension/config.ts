import type MarkdownIt from 'markdown-it';
import * as vscode from 'vscode';

export const configSection = 'markdownMermaidZoom';

/**
 * Reads the current extension configuration and maps it to a serializable object
 * that can be injected into the preview webview.
 */
function getConfigForPreview(): Record<string, unknown> {
  const config = vscode.workspace.getConfiguration(configSection);
  return {
    lightModeTheme: config.get<string>('lightModeTheme', 'default'),
    darkModeTheme: config.get<string>('darkModeTheme', 'dark'),
    maxTextSize: config.get<number>('maxTextSize', 50000),
    clickDrag: config.get<string>('mouseNavigation', 'alt'),
    showControls: config.get<string>('controls.show', 'onHoverOrFocus'),
    fullscreen: config.get<boolean>('fullscreen', true),
    resizable: config.get<boolean>('resizable', true),
    maxHeight: config.get<string>('maxHeight', ''),
  };
}

/**
 * markdown-it plugin that injects extension configuration into the rendered HTML
 * as a hidden <span> element with a data-config attribute.
 */
export function injectMermaidConfig(md: MarkdownIt): void {
  const render = md.renderer.render.bind(md.renderer);
  md.renderer.render = (tokens, options, env) => {
    const configData = JSON.stringify(getConfigForPreview());
    const configTag = `<span id="markdown-mermaid-zoom" data-config='${configData}' style="display:none"></span>`;
    return configTag + render(tokens, options, env);
  };
}
