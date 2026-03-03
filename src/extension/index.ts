import type MarkdownIt from 'markdown-it';
import * as vscode from 'vscode';
import { extendMarkdownItWithMermaid } from '../shared/markdownItMermaid';
import { configSection, injectMermaidConfig } from './config';

export function activate(ctx: vscode.ExtensionContext) {
  // Refresh markdown preview when configuration changes
  ctx.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration(configSection) ||
        e.affectsConfiguration('workbench.colorTheme')
      ) {
        vscode.commands.executeCommand('markdown.preview.refresh');
      }
    })
  );

  return {
    extendMarkdownIt(md: MarkdownIt) {
      extendMarkdownItWithMermaid(md, {
        languageIds: () => {
          return vscode.workspace
            .getConfiguration(configSection)
            .get<string[]>('languages', ['mermaid']);
        },
      });
      md.use(injectMermaidConfig);
      return md;
    },
  };
}
