/**
 * Shairee — TransferLog component
 * Real-time transfer activity feed
 */

import { getTransferLog, type TransferRecord, type TransferProgressPayload, type TransferCompletePayload } from '../utils/tauri-api';
import { formatFileSize, formatSpeed, formatPercent, formatTimestamp } from '../utils/formatters';

let logListEl: HTMLElement | null = null;
let logEmptyEl: HTMLElement | null = null;
let logCountEl: HTMLElement | null = null;

// Active transfers (keyed by fileId+clientIp)
const activeTransfers = new Map<string, TransferProgressPayload>();

export function initTransferLog(): void {
  logListEl = document.getElementById('transfer-log-list');
  logEmptyEl = document.getElementById('transfer-log-empty');
  logCountEl = document.getElementById('transfer-log-count');

  refreshTransferLog();
}

export async function refreshTransferLog(): Promise<void> {
  try {
    const records = await getTransferLog();
    renderLog(records);
  } catch (err) {
    console.error('Failed to fetch transfer log:', err);
  }
}

function renderLog(records: TransferRecord[]): void {
  if (!logListEl) return;

  const allItems: Array<{ type: 'active' | 'record'; data: TransferProgressPayload | TransferRecord }> = [];

  // Active transfers first
  activeTransfers.forEach(t => allItems.push({ type: 'active', data: t }));

  // Then completed records (most recent first)
  const sorted = [...records].sort((a, b) => {
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });
  sorted.forEach(r => allItems.push({ type: 'record', data: r }));

  if (logCountEl) logCountEl.textContent = `${allItems.length}`;

  if (allItems.length === 0) {
    logListEl.innerHTML = '';
    if (logEmptyEl) logEmptyEl.style.display = '';
    return;
  }

  if (logEmptyEl) logEmptyEl.style.display = 'none';

  // Only render last 50
  const toRender = allItems.slice(0, 50);

  logListEl.innerHTML = toRender.map((item, _i) => {
    if (item.type === 'active') {
      const t = item.data as TransferProgressPayload;
      const pct = formatPercent(t.bytesTransferred, t.totalBytes);
      return `
        <div class="transfer-item transfer-active animate-fade-in">
          <div class="flex items-center justify-between mb-1">
            <span class="text-xs font-medium text-gray-200 truncate max-w-[60%]">${t.fileName}</span>
            <span class="text-xs text-cyan-400 font-mono">${formatSpeed(t.speedBps)}</span>
          </div>
          <div class="transfer-progress-bar">
            <div class="transfer-progress-fill" style="width: ${pct}%"></div>
          </div>
          <div class="flex items-center justify-between mt-1">
            <span class="text-[10px] text-gray-500">${t.clientIp}</span>
            <span class="text-[10px] text-gray-400">${formatFileSize(t.bytesTransferred)} / ${formatFileSize(t.totalBytes)} (${pct}%)</span>
          </div>
        </div>
      `;
    } else {
      const r = item.data as TransferRecord;
      const isComplete = r.status === 'completed' || r.status === 'complete';
      const statusClass = isComplete ? 'text-emerald-400' : 'text-red-400';
      const statusIcon = isComplete ? '✓' : '✗';
      return `
        <div class="transfer-item animate-fade-in">
          <div class="flex items-center justify-between">
            <span class="text-xs font-medium text-gray-300 truncate max-w-[55%]">${r.fileName}</span>
            <span class="${statusClass} text-xs font-bold">${statusIcon} ${r.status}</span>
          </div>
          <div class="flex items-center justify-between mt-0.5">
            <span class="text-[10px] text-gray-500">${r.clientIp}</span>
            <span class="text-[10px] text-gray-500">${formatFileSize(r.bytesTransferred)} · ${formatTimestamp(r.timestamp)}</span>
          </div>
        </div>
      `;
    }
  }).join('');
}

export function handleTransferProgress(payload: TransferProgressPayload): void {
  const key = `${payload.fileId}_${payload.clientIp}`;
  activeTransfers.set(key, payload);
  refreshTransferLog();
}

export function handleTransferComplete(payload: TransferCompletePayload): void {
  const key = `${payload.fileId}_${payload.clientIp}`;
  activeTransfers.delete(key);
  refreshTransferLog();
}
