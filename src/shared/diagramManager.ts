import { ClickDragMode, MermaidExtensionConfig, ShowControlsMode } from './config';
import diagramStyles from './diagramStyles.css';
import { IDisposable } from './disposable';

const minScale = 0.5;
const maxScale = 10;
const zoomFactor = 0.002;

interface Dimensions {
  readonly width: number;
  readonly height: number;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

export interface PanZoomState {
  readonly scale: number;
  readonly translate: Point;
  readonly hasInteracted: boolean;
  readonly customHeight?: number;
}

/**
 * Manages all DiagramElement instances within a window/document.
 */
export class DiagramManager {
  private readonly instances = new Map<string, DiagramElement>();
  private readonly savedStates = new Map<string, PanZoomState>();
  private readonly diagramStyleSheet: HTMLStyleElement;
  private config: MermaidExtensionConfig;

  constructor(config: MermaidExtensionConfig) {
    this.config = config;
    this.diagramStyleSheet = document.createElement('style');
    this.diagramStyleSheet.className = 'markdown-style mermaid-diagram-styles';
    this.diagramStyleSheet.textContent = diagramStyles;
    this.ensureStyleSheetAttached();
  }

  public updateConfig(config: MermaidExtensionConfig): void {
    this.config = config;
    this.ensureStyleSheetAttached();
  }

  public setup(id: string, mermaidContainer: HTMLElement): IDisposable {
    this.ensureStyleSheetAttached();
    this.disposeInstance(id);
    const parent = mermaidContainer.parentNode;
    if (!parent) {
      return { dispose: () => {} };
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'mermaid-wrapper';
    const content = document.createElement('div');
    content.className = 'mermaid-content';

    parent.insertBefore(wrapper, mermaidContainer);
    content.appendChild(mermaidContainer);
    wrapper.appendChild(content);

    const state = this.savedStates.get(id);
    const instance = new DiagramElement(wrapper, content, this.config, state);
    this.instances.set(id, instance);

    requestAnimationFrame(() => {
      instance.initialize();
    });

    return { dispose: () => this.disposeInstance(id) };
  }

  private disposeInstance(id: string): void {
    const instance = this.instances.get(id);
    if (instance) {
      this.savedStates.set(id, instance.getState());
      instance.dispose();
      this.instances.delete(id);
    }
  }

  public retainStates(activeIds: Set<string>): void {
    for (const id of this.savedStates.keys()) {
      if (!activeIds.has(id)) {
        this.savedStates.delete(id);
      }
    }
  }

  private ensureStyleSheetAttached(): void {
    if (!document.head) {
      return;
    }
    if (!this.diagramStyleSheet.isConnected) {
      document.head.appendChild(this.diagramStyleSheet);
    }
    if (!this.diagramStyleSheet.textContent) {
      this.diagramStyleSheet.textContent = diagramStyles;
    }
  }
}

export class DiagramElement {
  private scale = 1;
  private translate: Point = { x: 0, y: 0 };
  private lastSvgSize: Dimensions = { width: 0, height: 0 };
  private isPanning = false;
  private hasDragged = false;
  private hasInteracted = false;
  private panModeEnabled = false;
  private startX = 0;
  private startY = 0;
  private isResizing = false;
  private resizeStartY = 0;
  private resizeStartHeight = 0;
  private customHeight: number | undefined;
  private panModeButton: HTMLButtonElement | null = null;
  private readonly resizeHandle: HTMLElement | null = null;
  private readonly resizeObserver: ResizeObserver;
  private readonly showControls: ShowControlsMode;
  private readonly clickDrag: ClickDragMode;
  private readonly resizable: boolean;
  private readonly maxHeight: string;
  private readonly fullscreenEnabled: boolean;
  private readonly abortController = new AbortController();

  // Fullscreen state
  private isFullscreen = false;
  private fullscreenOverlay: HTMLElement | null = null;
  private fullscreenContent: HTMLElement | null = null;
  private fullscreenPanMode = false;
  private fullscreenPanModeBtn: HTMLButtonElement | null = null;
  private fsScale = 1;
  private fsTranslate: Point = { x: 0, y: 0 };
  private fsIsPanning = false;
  private fsHasDragged = false;
  private fsStartX = 0;
  private fsStartY = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly content: HTMLElement,
    config: MermaidExtensionConfig,
    initialState?: PanZoomState
  ) {
    this.showControls = config.showControls;
    this.clickDrag = config.clickDrag;
    this.resizable = config.resizable;
    this.maxHeight = config.maxHeight;
    this.fullscreenEnabled = config.fullscreen;

    if (initialState) {
      this.scale = initialState.scale;
      this.translate = { x: initialState.translate.x, y: initialState.translate.y };
      this.hasInteracted = initialState.hasInteracted;
      this.customHeight = initialState.customHeight;
    }

    this.content.style.transformOrigin = '0 0';
    this.container.style.overflow = 'hidden';
    this.container.tabIndex = 0;

    if (this.maxHeight) {
      const sanitized = sanitizeCssLength(this.maxHeight);
      if (sanitized) {
        this.container.style.maxHeight = sanitized;
      }
    }

    this.setCursor(false, false);
    this.setupEventListeners();

    if (this.showControls !== ShowControlsMode.Never) {
      this.createZoomControls();
    }

    if (this.resizable) {
      this.resizeHandle = this.createResizeHandle();
      this.container.appendChild(this.resizeHandle);
    }

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);
  }

  public initialize(): void {
    if (this.hasInteracted) {
      this.tryResizeContainerToFitSvg();
      this.applyTransform();
    } else {
      this.centerContent();
    }
  }

  public getState(): PanZoomState {
    return {
      scale: this.scale,
      translate: { x: this.translate.x, y: this.translate.y },
      hasInteracted: this.hasInteracted,
      customHeight: this.customHeight,
    };
  }

  public dispose(): void {
    this.exitFullscreen();
    this.abortController.abort();
    this.resizeObserver.disconnect();
  }

  private setupEventListeners(): void {
    const signal = this.abortController.signal;
    this.container.addEventListener('mousedown', (e) => this.handleMouseDown(e), { signal });
    document.addEventListener('mousemove', (e) => this.handleMouseMove(e), { signal });
    document.addEventListener('mouseup', () => this.handleMouseUp(), { signal });
    this.container.addEventListener('click', (e) => this.handleClick(e), { signal });
    this.container.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false, signal });
    this.container.addEventListener('mousemove', (e) => this.updateCursor(e), { signal });
    this.container.addEventListener('mouseenter', (e) => this.updateCursor(e), { signal });
    window.addEventListener('keydown', (e) => this.handleKeyChange(e), { signal });
    window.addEventListener('keyup', (e) => this.handleKeyChange(e), { signal });
  }

  private createZoomControls(): void {
    const signal = this.abortController.signal;
    const controls = document.createElement('div');
    controls.className = 'mermaid-zoom-controls';
    if (this.showControls === ShowControlsMode.OnHoverOrFocus) {
      controls.classList.add('mermaid-zoom-controls-auto-hide');
    }

    let html = '<button class="pan-mode-btn" title="Pan mode"><i class="codicon codicon-move"></i></button>';
    html += '<button class="zoom-in-btn" title="Zoom in"><i class="codicon codicon-zoom-in"></i></button>';
    html += '<button class="zoom-out-btn" title="Zoom out"><i class="codicon codicon-zoom-out"></i></button>';
    if (this.fullscreenEnabled) {
      html += '<button class="fullscreen-btn" title="Fullscreen"><i class="codicon codicon-screen-full"></i></button>';
    }
    controls.innerHTML = html;

    this.panModeButton = controls.querySelector('.pan-mode-btn');
    this.panModeButton?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.togglePanMode(); }, { signal });
    controls.querySelector('.zoom-in-btn')?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.zoomIn(); }, { signal });
    controls.querySelector('.zoom-out-btn')?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.zoomOut(); }, { signal });
    if (this.fullscreenEnabled) {
      controls.querySelector('.fullscreen-btn')?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.enterFullscreen(); }, { signal });
    }
    this.container.appendChild(controls);
  }

  private createResizeHandle(): HTMLElement {
    const signal = this.abortController.signal;
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'mermaid-resize-handle';
    resizeHandle.title = 'Drag to resize';

    resizeHandle.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      this.isResizing = true;
      this.resizeStartY = e.clientY;
      this.resizeStartHeight = this.container.getBoundingClientRect().height;
      document.body.style.cursor = 'ns-resize';
    }, { signal });

    document.addEventListener('mousemove', (e) => {
      if (!this.isResizing) return;
      if (e.buttons === 0) { this.isResizing = false; document.body.style.cursor = ''; return; }
      const deltaY = e.clientY - this.resizeStartY;
      const newHeight = Math.max(100, this.resizeStartHeight + deltaY);
      this.container.style.height = newHeight + 'px';
      this.customHeight = newHeight;
    }, { signal });

    document.addEventListener('mouseup', () => {
      if (this.isResizing) { this.isResizing = false; document.body.style.cursor = ''; }
    }, { signal });

    return resizeHandle;
  }

  // ---- Fullscreen ----
  private enterFullscreen(): void {
    if (this.isFullscreen) return;
    this.isFullscreen = true;
    this.fsScale = this.scale;
    this.fsTranslate = { ...this.translate };
    this.fullscreenPanMode = this.panModeEnabled;

    this.fullscreenOverlay = document.createElement('div');
    this.fullscreenOverlay.className = 'mermaid-fullscreen-overlay';

    const toolbar = document.createElement('div');
    toolbar.className = 'mermaid-fullscreen-toolbar';
    toolbar.innerHTML = '<button class="fs-pan-mode-btn" title="Pan mode"><i class="codicon codicon-move"></i></button>' +
      '<button class="fs-zoom-in-btn" title="Zoom in"><i class="codicon codicon-zoom-in"></i></button>' +
      '<button class="fs-zoom-out-btn" title="Zoom out"><i class="codicon codicon-zoom-out"></i></button>' +
      '<button class="fs-reset-btn" title="Reset view"><i class="codicon codicon-discard"></i></button>' +
      '<button class="fs-exit-btn" title="Exit fullscreen"><i class="codicon codicon-screen-normal"></i></button>';
    this.fullscreenOverlay.appendChild(toolbar);

    const body = document.createElement('div');
    body.className = 'mermaid-fullscreen-body';
    this.fullscreenContent = document.createElement('div');
    this.fullscreenContent.className = 'mermaid-fullscreen-content';
    this.fullscreenContent.style.transformOrigin = '0 0';

    const svg = this.content.querySelector('svg');
    if (svg) { this.fullscreenContent.appendChild(svg.cloneNode(true)); }

    body.appendChild(this.fullscreenContent);
    this.fullscreenOverlay.appendChild(body);
    document.body.appendChild(this.fullscreenOverlay);

    const signal = this.abortController.signal;
    this.fullscreenPanModeBtn = toolbar.querySelector('.fs-pan-mode-btn');
    if (this.fullscreenPanMode) {
      this.fullscreenPanModeBtn?.classList.add('active');
      body.style.cursor = 'grab';
    }
    this.fullscreenPanModeBtn?.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      this.fullscreenPanMode = !this.fullscreenPanMode;
      this.fullscreenPanModeBtn?.classList.toggle('active', this.fullscreenPanMode);
      body.style.cursor = this.fullscreenPanMode ? 'grab' : 'default';
    }, { signal });
    toolbar.querySelector('.fs-zoom-in-btn')?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.fsZoomAtCenter(1.25, body); }, { signal });
    toolbar.querySelector('.fs-zoom-out-btn')?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.fsZoomAtCenter(0.8, body); }, { signal });
    toolbar.querySelector('.fs-reset-btn')?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.fsScale = 1; this.fsTranslate = { x: 0, y: 0 }; this.applyFullscreenTransform(); this.fsCenterContent(body); }, { signal });
    toolbar.querySelector('.fs-exit-btn')?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.exitFullscreen(); }, { signal });

    window.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Escape') { this.exitFullscreen(); } }, { signal });

    body.addEventListener('mousedown', (e) => this.fsHandleMouseDown(e, body), { signal });
    document.addEventListener('mousemove', (e) => this.fsHandleMouseMove(e), { signal });
    document.addEventListener('mouseup', () => this.fsHandleMouseUp(body), { signal });
    body.addEventListener('wheel', (e) => this.fsHandleWheel(e, body), { passive: false, signal });

    requestAnimationFrame(() => { this.fsCenterContent(body); });
  }

  private exitFullscreen(): void {
    if (!this.isFullscreen) return;
    this.isFullscreen = false;

    // Carry fullscreen zoom/pan state back to inline view
    this.scale = this.fsScale;
    this.translate = { ...this.fsTranslate };
    this.hasInteracted = true;
    if (this.panModeEnabled !== this.fullscreenPanMode) {
      this.togglePanMode();
    }
    this.applyTransform();

    if (this.fullscreenOverlay) {
      this.fullscreenOverlay.remove();
      this.fullscreenOverlay = null;
      this.fullscreenContent = null;
    }
  }

  private applyFullscreenTransform(): void {
    if (this.fullscreenContent) {
      this.fullscreenContent.style.transform = 'translate(' + this.fsTranslate.x + 'px, ' + this.fsTranslate.y + 'px) scale(' + this.fsScale + ')';
    }
  }

  private fsCenterContent(body: HTMLElement): void {
    const svg = this.fullscreenContent?.querySelector('svg');
    if (!svg || !this.fullscreenContent) return;
    svg.removeAttribute('height');
    const oldTransform = this.fullscreenContent.style.transform;
    this.fullscreenContent.style.transform = 'none';
    const svgRect = svg.getBoundingClientRect();
    this.fullscreenContent.style.transform = oldTransform;
    const bodyRect = body.getBoundingClientRect();
    const scaleX = bodyRect.width / svgRect.width;
    const scaleY = bodyRect.height / svgRect.height;
    this.fsScale = Math.min(scaleX, scaleY, 1);
    this.fsTranslate = {
      x: (bodyRect.width - svgRect.width * this.fsScale) / 2,
      y: (bodyRect.height - svgRect.height * this.fsScale) / 2,
    };
    this.applyFullscreenTransform();
  }

  private fsZoomAtCenter(factor: number, body: HTMLElement): void {
    const rect = body.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const newScale = Math.min(maxScale, Math.max(minScale, this.fsScale * factor));
    const scaleFactor = newScale / this.fsScale;
    this.fsTranslate = { x: cx - (cx - this.fsTranslate.x) * scaleFactor, y: cy - (cy - this.fsTranslate.y) * scaleFactor };
    this.fsScale = newScale;
    this.applyFullscreenTransform();
  }

  private fsHandleMouseDown(e: MouseEvent, body: HTMLElement): void {
    if (e.button !== 0) return;
    if (!this.fullscreenPanMode && !e.altKey) return;
    e.preventDefault(); e.stopPropagation();
    this.fsIsPanning = true; this.fsHasDragged = false;
    this.fsStartX = e.clientX - this.fsTranslate.x;
    this.fsStartY = e.clientY - this.fsTranslate.y;
    body.style.cursor = 'grabbing';
  }

  private fsHandleMouseMove(e: MouseEvent): void {
    if (!this.fsIsPanning) return;
    if (e.buttons === 0) { this.fsIsPanning = false; return; }
    const dx = e.clientX - this.fsStartX - this.fsTranslate.x;
    const dy = e.clientY - this.fsStartY - this.fsTranslate.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) { this.fsHasDragged = true; }
    this.fsTranslate = { x: e.clientX - this.fsStartX, y: e.clientY - this.fsStartY };
    this.applyFullscreenTransform();
  }

  private fsHandleMouseUp(body: HTMLElement): void {
    if (this.fsIsPanning) {
      this.fsIsPanning = false;
      body.style.cursor = this.fullscreenPanMode ? 'grab' : 'default';
    }
  }

  private fsHandleWheel(e: WheelEvent, body: HTMLElement): void {
    const isPinchZoom = e.ctrlKey;
    if (isPinchZoom || e.altKey || this.fullscreenPanMode) {
      e.preventDefault(); e.stopPropagation();
      const rect = body.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const pinchMultiplier = isPinchZoom ? 10 : 1;
      const delta = -e.deltaY * zoomFactor * pinchMultiplier;
      const newScale = Math.min(maxScale, Math.max(minScale, this.fsScale * (1 + delta)));
      const scaleFactor = newScale / this.fsScale;
      this.fsTranslate = { x: mouseX - (mouseX - this.fsTranslate.x) * scaleFactor, y: mouseY - (mouseY - this.fsTranslate.y) * scaleFactor };
      this.fsScale = newScale;
      this.applyFullscreenTransform();
    }
  }

  // ---- Inline Pan/Zoom ----
  private togglePanMode(): void {
    this.panModeEnabled = !this.panModeEnabled;
    this.panModeButton?.classList.toggle('active', this.panModeEnabled);
    this.setCursor(false, false);
  }

  private handleKeyChange(e: KeyboardEvent): void {
    if ((e.key === 'Alt' || e.key === 'Shift') && !this.isPanning) {
      e.preventDefault();
      this.setCursor(e.altKey, e.shiftKey);
    }
  }

  private updateCursor(e: MouseEvent): void {
    if (!this.isPanning) { this.setCursor(e.altKey, e.shiftKey); }
  }

  private setCursor(altKey: boolean, shiftKey: boolean): void {
    if (this.panModeEnabled) { this.container.style.cursor = 'grab'; return; }
    if (this.clickDrag === ClickDragMode.Alt) {
      if (altKey && shiftKey) { this.container.style.cursor = 'zoom-out'; }
      else if (altKey) { this.container.style.cursor = 'grab'; }
      else { this.container.style.cursor = 'default'; }
    } else {
      if (altKey && !shiftKey) { this.container.style.cursor = 'zoom-in'; }
      else if (altKey && shiftKey) { this.container.style.cursor = 'zoom-out'; }
      else { this.container.style.cursor = 'grab'; }
    }
  }

  private handleClick(e: MouseEvent): void {
    if (!e.altKey || this.hasDragged) return;
    e.preventDefault(); e.stopPropagation();
    const rect = this.container.getBoundingClientRect();
    const factor = e.shiftKey ? 0.8 : 1.25;
    this.zoomAtPoint(factor, e.clientX - rect.left, e.clientY - rect.top);
  }

  private handleWheel(e: WheelEvent): void {
    const isPinchZoom = e.ctrlKey;
    if (isPinchZoom || e.altKey || this.panModeEnabled) {
      e.preventDefault(); e.stopPropagation();
      const rect = this.container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const pinchMultiplier = isPinchZoom ? 10 : 1;
      const delta = -e.deltaY * zoomFactor * pinchMultiplier;
      const newScale = Math.min(maxScale, Math.max(minScale, this.scale * (1 + delta)));
      const scaleFactor = newScale / this.scale;
      this.translate = { x: mouseX - (mouseX - this.translate.x) * scaleFactor, y: mouseY - (mouseY - this.translate.y) * scaleFactor };
      this.scale = newScale;
      this.applyTransform();
      this.hasInteracted = true;
    }
  }

  private handleMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    if (!this.panModeEnabled && this.clickDrag === ClickDragMode.Alt && !e.altKey) return;
    e.preventDefault(); e.stopPropagation();
    this.isPanning = true; this.hasDragged = false;
    this.startX = e.clientX - this.translate.x;
    this.startY = e.clientY - this.translate.y;
    this.container.style.cursor = 'grabbing';
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.isPanning) return;
    if (e.buttons === 0) { this.handleMouseUp(); return; }
    const dx = e.clientX - this.startX - this.translate.x;
    const dy = e.clientY - this.startY - this.translate.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) { this.hasDragged = true; }
    this.translate = { x: e.clientX - this.startX, y: e.clientY - this.startY };
    this.applyTransform();
  }

  private handleMouseUp(): void {
    if (this.isPanning) {
      this.isPanning = false;
      this.setCursor(false, false);
      this.hasInteracted = true;
    }
  }

  private applyTransform(): void {
    this.content.style.transform = 'translate(' + this.translate.x + 'px, ' + this.translate.y + 'px) scale(' + this.scale + ')';
  }

  private handleResize(): void {
    if (this.hasInteracted) {
      const svgAtOriginX = -this.translate.x / this.scale;
      const svgAtOriginY = -this.translate.y / this.scale;
      const percentX = this.lastSvgSize.width > 0 ? svgAtOriginX / this.lastSvgSize.width : 0;
      const percentY = this.lastSvgSize.height > 0 ? svgAtOriginY / this.lastSvgSize.height : 0;
      if (!this.tryResizeContainerToFitSvg()) return;
      const newSvgAtOriginX = percentX * this.lastSvgSize.width;
      const newSvgAtOriginY = percentY * this.lastSvgSize.height;
      this.translate = { x: -newSvgAtOriginX * this.scale, y: -newSvgAtOriginY * this.scale };
      this.applyTransform();
    } else {
      this.centerContent();
    }
  }

  private tryResizeContainerToFitSvg(): boolean {
    const svg = this.content.querySelector('svg');
    if (!svg) return false;
    svg.removeAttribute('height');
    const oldTransform = this.content.style.transform;
    this.content.style.transform = 'none';
    const rect = svg.getBoundingClientRect();
    this.content.style.transform = oldTransform;
    this.lastSvgSize = { width: rect.width, height: rect.height };
    const containerHeight = this.customHeight ?? this.lastSvgSize.height;
    this.container.style.height = containerHeight + 'px';
    return true;
  }

  private centerContent(): void {
    if (!this.tryResizeContainerToFitSvg()) return;
    this.scale = 1;
    const containerRect = this.container.getBoundingClientRect();
    this.translate = { x: (containerRect.width - this.lastSvgSize.width) / 2, y: 0 };
    this.applyTransform();
  }

  public reset(): void {
    this.scale = 1;
    this.translate = { x: 0, y: 0 };
    this.hasInteracted = false;
    this.customHeight = undefined;
    this.centerContent();
  }

  public zoomIn(): void {
    const rect = this.container.getBoundingClientRect();
    this.zoomAtPoint(1.25, rect.width / 2, rect.height / 2);
  }

  public zoomOut(): void {
    const rect = this.container.getBoundingClientRect();
    this.zoomAtPoint(0.8, rect.width / 2, rect.height / 2);
  }

  private zoomAtPoint(factor: number, x: number, y: number): void {
    const newScale = Math.min(maxScale, Math.max(minScale, this.scale * factor));
    const scaleFactor = newScale / this.scale;
    this.translate = { x: x - (x - this.translate.x) * scaleFactor, y: y - (y - this.translate.y) * scaleFactor };
    this.scale = newScale;
    this.applyTransform();
    this.hasInteracted = true;
  }
}

function sanitizeCssLength(value: string): string {
  if (/^\d+(\.\d+)?(px|em|rem|vh|vw|%)?$/.test(value.trim())) {
    return value.trim().match(/\d/) ? value.trim() : '';
  }
  return '';
}
