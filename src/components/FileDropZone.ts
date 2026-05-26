/**
 * Shairee — FileDropZone component
 * Animated drag-and-drop zone with gradient border
 */

import { addFiles, addFolder } from '../utils/tauri-api';

let dropZoneEl: HTMLElement | null = null;
let isProcessing = false;

export function initFileDropZone(): void {
  dropZoneEl = document.getElementById('file-drop-zone');
  if (!dropZoneEl) return;

  dropZoneEl.addEventListener('dragenter', handleDragEnter);
  dropZoneEl.addEventListener('dragover', handleDragOver);
  dropZoneEl.addEventListener('dragleave', handleDragLeave);
  dropZoneEl.addEventListener('drop', handleDrop);

  const browseBtn = document.getElementById('browse-btn');
  browseBtn?.addEventListener('click', handleBrowse);

  const browseFolderBtn = document.getElementById('browse-folder-btn');
  browseFolderBtn?.addEventListener('click', handleBrowseFolder);

  // Whole window drag awareness
  document.addEventListener('dragenter', handleWindowDragEnter);
  document.addEventListener('dragleave', handleWindowDragLeave);
  document.addEventListener('drop', handleWindowDrop);
  document.addEventListener('dragover', (e) => e.preventDefault());
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
