import { MermaidExtensionConfig } from './config';

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

/**
 * Reads extension config from a hidden span injected by the extension host.
 */
export function loadExtensionConfig(): MermaidExtensionConfig {
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
