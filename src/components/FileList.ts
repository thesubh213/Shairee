/**
 * Shairee — FileList component
 * Animated file cards with remove actions
 */

import { getSharedFiles, removeFile, clearFiles, type SharedFileInfo } from '../utils/tauri-api';
import { formatFileSize, getFileIcon, getExtension, truncateFilename } from '../utils/formatters';

let fileListEl: HTMLElement | null = null;
let emptyStateEl: HTMLElement | null = null;
let fileCountEl: HTMLElement | null = null;
let totalSizeEl: HTMLElement | null = null;
let clearAllBtn: HTMLElement | null = null;
let currentFiles: SharedFileInfo[] = [];

export function initFileList(): void {
  fileListEl = document.getElementById('file-list');
  emptyStateEl = document.getElementById('file-list-empty');
  fileCountEl = document.getElementById('file-count');
  totalSizeEl = document.getElementById('total-size');
  clearAllBtn = document.getElementById('clear-all-btn');

  clearAllBtn?.addEventListener('click', handleClearAll);

  refreshFileList();
}

export async function refreshFileList(): Promise<void> {
  try {
    currentFiles = await getSharedFiles();
    renderFileList();
  } catch (err) {
    console.error('Failed to fetch files:', err);
  }
}

function renderFileList(): void {
  if (!fileListEl) return;

  // Update counters
  const totalSize = currentFiles.reduce((sum, f) => sum + f.size, 0);
  if (fileCountEl) fileCountEl.textContent = `${currentFiles.length} file${currentFiles.length !== 1 ? 's' : ''}`;
  if (totalSizeEl) totalSizeEl.textContent = formatFileSize(totalSize);
  if (clearAllBtn) clearAllBtn.style.display = currentFiles.length > 0 ? '' : 'none';

  if (currentFiles.length === 0) {
    fileListEl.innerHTML = '';
    if (emptyStateEl) emptyStateEl.style.display = '';
    return;
  }

  if (emptyStateEl) emptyStateEl.style.display = 'none';

  // Build new DOM — keep existing cards if unchanged for smoother transitions
  const existingIds = new Set(
    Array.from(fileListEl.children).map(el => el.getAttribute('data-file-id'))
  );
  const newIds = new Set(currentFiles.map(f => f.id));

  // Remove cards that are no longer in the list
  Array.from(fileListEl.children).forEach(el => {
    const id = el.getAttribute('data-file-id');
    if (id && !newIds.has(id)) {
      el.classList.add('file-card-exit');
      setTimeout(() => el.remove(), 300);
    }
  });

  // Add new cards
  currentFiles.forEach((file, index) => {
    if (!existingIds.has(file.id)) {
      const card = createFileCard(file, index);
      fileListEl!.appendChild(card);
    }
  });
}

function createFileCard(file: SharedFileInfo, index: number): HTMLElement {
  const card = document.createElement('div');
  card.className = 'file-card glass-card animate-slide-up';
  card.setAttribute('data-file-id', file.id);
  card.style.animationDelay = `${index * 50}ms`;

  const icon = getFileIcon(file.name, file.mimeType);
  const ext = getExtension(file.name);
  const displayName = truncateFilename(file.name, 36);
  const size = formatFileSize(file.size);

  card.innerHTML = `
    <div class="flex items-center gap-3 min-w-0 flex-1">
      <div class="file-icon-wrapper shrink-0">
        <span class="text-xl" aria-hidden="true">${icon}</span>
      </div>
      <div class="min-w-0 flex-1">
        <p class="file-name text-sm font-medium text-gray-100 truncate" title="${file.name}">${displayName}</p>
        <div class="flex items-center gap-2 mt-0.5">
          ${ext ? `<span class="ext-badge">${ext}</span>` : ''}
          <span class="text-xs text-gray-400">${size}</span>
          ${file.isDirectory ? '<span class="text-xs text-cyan-400">📁 Folder</span>' : ''}
        </div>
      </div>
    </div>
    <button class="remove-btn group" data-remove-id="${file.id}" title="Remove file" aria-label="Remove ${file.name}">
      <svg class="w-4 h-4 text-gray-500 group-hover:text-red-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
      </svg>
    </button>
  `;

  const removeBtn = card.querySelector('.remove-btn') as HTMLButtonElement;
  removeBtn?.addEventListener('click', async () => {
    card.classList.add('file-card-exit');
    setTimeout(async () => {
      try {
        await removeFile(file.id);
        await refreshFileList();
      } catch (err) {
        console.error('Remove error:', err);
        card.classList.remove('file-card-exit');
      }
    }, 250);
  });

  return card;
}

async function handleClearAll(): Promise<void> {
  try {
    // Animate all cards out
    if (fileListEl) {
      Array.from(fileListEl.children).forEach((el, i) => {
        (el as HTMLElement).style.animationDelay = `${i * 30}ms`;
        el.classList.add('file-card-exit');
      });
    }
    await new Promise(resolve => setTimeout(resolve, 350));
    await clearFiles();
    await refreshFileList();
  } catch (err) {
    console.error('Clear all error:', err);
  }
}
