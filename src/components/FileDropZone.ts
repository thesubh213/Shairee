/**
 * Shairee — FileDropZone component
 * Animated drag-and-drop zone with gradient border
 */

import { addFiles, addFolder } from '../utils/tauri-api';

let dropZoneEl: HTMLElement | null = null;
let isProcessing = false;

// Store event handler references for cleanup
const eventHandlers = {
  handleDragEnter: null as ((e: DragEvent) => void) | null,
  handleDragOver: null as ((e: DragEvent) => void) | null,
  handleDragLeave: null as ((e: DragEvent) => void) | null,
  handleDrop: null as ((e: DragEvent) => void) | null,
  handleWindowDragEnter: null as ((e: DragEvent) => void) | null,
  handleWindowDragLeave: null as ((e: DragEvent) => void) | null,
  handleWindowDrop: null as ((e: DragEvent) => void) | null,
  handleWindowDragOver: null as ((e: DragEvent) => void) | null,
  handleBrowse: null as (() => Promise<void>) | null,
  handleBrowseFolder: null as (() => Promise<void>) | null,
};

export function cleanupFileDropZone(): void {
  // Remove all event listeners to prevent memory leaks
  if (dropZoneEl && eventHandlers.handleDragEnter) {
    dropZoneEl.removeEventListener('dragenter', eventHandlers.handleDragEnter);
    dropZoneEl.removeEventListener('dragover', eventHandlers.handleDragOver);
    dropZoneEl.removeEventListener('dragleave', eventHandlers.handleDragLeave);
    dropZoneEl.removeEventListener('drop', eventHandlers.handleDrop);
  }

  if (eventHandlers.handleWindowDragEnter) {
    document.removeEventListener('dragenter', eventHandlers.handleWindowDragEnter);
    document.removeEventListener('dragleave', eventHandlers.handleWindowDragLeave);
    document.removeEventListener('drop', eventHandlers.handleWindowDrop);
    document.removeEventListener('dragover', eventHandlers.handleWindowDragOver);
  }

  const browseBtn = document.getElementById('browse-btn');
  if (browseBtn && eventHandlers.handleBrowse) {
    browseBtn.removeEventListener('click', eventHandlers.handleBrowse);
  }

  const browseFolderBtn = document.getElementById('browse-folder-btn');
  if (browseFolderBtn && eventHandlers.handleBrowseFolder) {
    browseFolderBtn.removeEventListener('click', eventHandlers.handleBrowseFolder);
  }

  dropZoneEl = null;
}

export function initFileDropZone(): void {
  // Clean up any existing listeners first
  cleanupFileDropZone();

  dropZoneEl = document.getElementById('file-drop-zone');
  if (!dropZoneEl) return;

  // Bind handler functions (store references for cleanup)
  eventHandlers.handleDragEnter = handleDragEnter;
  eventHandlers.handleDragOver = handleDragOver;
  eventHandlers.handleDragLeave = handleDragLeave;
  eventHandlers.handleDrop = handleDrop;
  eventHandlers.handleWindowDragEnter = handleWindowDragEnter;
  eventHandlers.handleWindowDragLeave = handleWindowDragLeave;
  eventHandlers.handleWindowDrop = handleWindowDrop;
  eventHandlers.handleWindowDragOver = (e: DragEvent) => e.preventDefault();
  eventHandlers.handleBrowse = handleBrowse;
  eventHandlers.handleBrowseFolder = handleBrowseFolder;

  dropZoneEl.addEventListener('dragenter', eventHandlers.handleDragEnter);
  dropZoneEl.addEventListener('dragover', eventHandlers.handleDragOver);
  dropZoneEl.addEventListener('dragleave', eventHandlers.handleDragLeave);
  dropZoneEl.addEventListener('drop', eventHandlers.handleDrop);

  const browseBtn = document.getElementById('browse-btn');
  browseBtn?.addEventListener('click', eventHandlers.handleBrowse);

  const browseFolderBtn = document.getElementById('browse-folder-btn');
  browseFolderBtn?.addEventListener('click', eventHandlers.handleBrowseFolder);

  // Whole window drag awareness
  document.addEventListener('dragenter', eventHandlers.handleWindowDragEnter);
  document.addEventListener('dragleave', eventHandlers.handleWindowDragLeave);
  document.addEventListener('drop', eventHandlers.handleWindowDrop);
  document.addEventListener('dragover', eventHandlers.handleWindowDragOver);
}

function handleDragEnter(e: DragEvent): void {
  e.preventDefault();
  e.stopPropagation();
  dropZoneEl?.classList.add('drag-active');
}

function handleDragOver(e: DragEvent): void {
  e.preventDefault();
  e.stopPropagation();
}

function handleDragLeave(e: DragEvent): void {
  e.preventDefault();
  e.stopPropagation();
  const rect = dropZoneEl?.getBoundingClientRect();
  if (!rect) return;
  const { clientX: x, clientY: y } = e;
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
    dropZoneEl?.classList.remove('drag-active');
  }
}

async function handleDrop(e: DragEvent): Promise<void> {
  e.preventDefault();
  e.stopPropagation();
  dropZoneEl?.classList.remove('drag-active');
  document.body.classList.remove('window-drag-active');

  if (isProcessing) return;
  isProcessing = true;
  setDropZoneLoading(true);

  try {
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    // Tauri intercepts file drops and gives us paths
    // We collect paths from the FileList
    const paths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      // In Tauri WebView, File.path is available
      const path = (f as unknown as { path?: string }).path;
      if (path) paths.push(path);
    }

    if (paths.length > 0) {
      await addFiles(paths);
    }
  } catch (err) {
    console.error('Drop error:', err);
  } finally {
    isProcessing = false;
    setDropZoneLoading(false);
  }
}

function handleWindowDragEnter(e: DragEvent): void {
  e.preventDefault();
  if (e.dataTransfer?.types.includes('Files')) {
    document.body.classList.add('window-drag-active');
  }
}

function handleWindowDragLeave(e: DragEvent): void {
  e.preventDefault();
  if (e.clientX === 0 && e.clientY === 0) {
    document.body.classList.remove('window-drag-active');
  }
}

function handleWindowDrop(e: DragEvent): void {
  e.preventDefault();
  document.body.classList.remove('window-drag-active');
}

async function handleBrowse(): Promise<void> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      multiple: true,
      title: 'Select files to share',
    });
    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected];
      const stringPaths = paths.map((p: any) => typeof p === 'string' ? p : p.path);
      if (stringPaths.length > 0) {
        await addFiles(stringPaths);
      }
    }
  } catch (err) {
    console.error('Browse error:', err);
  }
}

async function handleBrowseFolder(): Promise<void> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      directory: true,
      title: 'Select folder to share',
    });
    if (selected) {
      const path = typeof selected === 'string' ? selected : (selected as any).path;
      await addFolder(path);
    }
  } catch (err) {
    console.error('Browse folder error:', err);
  }
}

function setDropZoneLoading(loading: boolean): void {
  const icon = dropZoneEl?.querySelector('.drop-icon');
  const text = dropZoneEl?.querySelector('.drop-text');
  if (loading) {
    icon?.classList.add('animate-spin-slow');
    if (text) text.textContent = 'Processing files…';
  } else {
    icon?.classList.remove('animate-spin-slow');
    if (text) text.textContent = 'Drop files here or click to browse';
  }
}
