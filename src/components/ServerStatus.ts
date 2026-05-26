/**
 * Shairee — ServerStatus component
 * Status indicator, toggle controls, URL display
 */

import {
  getServerStatus, startServer, stopServer,
  type ServerStatus,
} from '../utils/tauri-api';

let statusDotEl: HTMLElement | null = null;
let statusTextEl: HTMLElement | null = null;
let toggleBtn: HTMLButtonElement | null = null;
let toggleBtnText: HTMLElement | null = null;
let accessUrlEl: HTMLElement | null = null;
let copyUrlBtn: HTMLElement | null = null;
let connectionsEl: HTMLElement | null = null;
let portDisplayEl: HTMLElement | null = null;
let serverRunning = false;
let isTogglingServer = false;

export function initServerStatus(): void {
  statusDotEl = document.getElementById('server-status-dot');
  statusTextEl = document.getElementById('server-status-text');
  toggleBtn = document.getElementById('server-toggle-btn') as HTMLButtonElement;
  toggleBtnText = document.getElementById('server-toggle-text');
  accessUrlEl = document.getElementById('access-url');
  copyUrlBtn = document.getElementById('copy-url-btn');
  connectionsEl = document.getElementById('active-connections');
  portDisplayEl = document.getElementById('port-display');

  toggleBtn?.addEventListener('click', handleToggleServer);
  copyUrlBtn?.addEventListener('click', handleCopyUrl);

  refreshServerStatus();
}

export async function refreshServerStatus(): Promise<void> {
  try {
    const status = await getServerStatus();
    updateStatusUI(status);
  } catch (err) {
    console.error('Failed to get server status:', err);
  }
}

export function getServerRunning(): boolean {
  return serverRunning;
}

function updateStatusUI(status: ServerStatus): void {
  serverRunning = status.serverRunning;

  // Status dot
  if (statusDotEl) {
    statusDotEl.className = status.serverRunning
      ? 'status-dot status-dot-online'
      : 'status-dot status-dot-offline';
  }

  // Status text
  if (statusTextEl) {
    statusTextEl.textContent = status.serverRunning ? 'Online' : 'Offline';
    statusTextEl.className = status.serverRunning
      ? 'text-sm font-medium text-emerald-400'
      : 'text-sm font-medium text-gray-400';
  }

  // Toggle button
  if (toggleBtn && toggleBtnText) {
    if (status.serverRunning) {
      toggleBtn.className = 'server-btn server-btn-stop';
      toggleBtnText.textContent = 'Stop Server';
    } else {
      toggleBtn.className = 'server-btn server-btn-start';
      toggleBtnText.textContent = 'Start Server';
    }
    toggleBtn.disabled = isTogglingServer;
  }

  // Access URL
  if (accessUrlEl) {
    if (status.serverRunning && status.accessUrl) {
      accessUrlEl.textContent = status.accessUrl;
      accessUrlEl.parentElement?.classList.remove('opacity-50');
    } else {
      accessUrlEl.textContent = 'Not running';
      accessUrlEl.parentElement?.classList.add('opacity-50');
    }
  }

  // Copy button visibility
  if (copyUrlBtn) {
    copyUrlBtn.style.display = status.serverRunning ? '' : 'none';
  }

  // Connections
  if (connectionsEl) {
    connectionsEl.textContent = `${status.activeConnections}`;
  }

  // Port
  if (portDisplayEl) {
    portDisplayEl.textContent = `Port ${status.port}`;
  }
}

async function handleToggleServer(): Promise<void> {
  if (isTogglingServer) return;
  isTogglingServer = true;

  if (toggleBtn) toggleBtn.disabled = true;
  if (toggleBtnText) toggleBtnText.textContent = serverRunning ? 'Stopping…' : 'Starting…';

  try {
    if (serverRunning) {
      await stopServer();
    } else {
      await startServer();
    }
    // Status will be updated via events
    await refreshServerStatus();
  } catch (err) {
    console.error('Server toggle error:', err);
  } finally {
    isTogglingServer = false;
    if (toggleBtn) toggleBtn.disabled = false;
  }
}

async function handleCopyUrl(): Promise<void> {
  const url = accessUrlEl?.textContent;
  if (!url || url === 'Not running') return;

  try {
    await navigator.clipboard.writeText(url);
    // Flash feedback
    if (copyUrlBtn) {
      const orig = copyUrlBtn.innerHTML;
      copyUrlBtn.innerHTML = `<svg class="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>`;
      setTimeout(() => { if (copyUrlBtn) copyUrlBtn.innerHTML = orig; }, 1500);
    }
  } catch (_err) {
    console.error('Copy failed');
  }
}

export function updateConnectionCount(count: number): void {
  if (connectionsEl) connectionsEl.textContent = `${count}`;
}

export function setServerOnline(url: string): void {
  serverRunning = true;
  if (statusDotEl) statusDotEl.className = 'status-dot status-dot-online';
  if (statusTextEl) {
    statusTextEl.textContent = 'Online';
    statusTextEl.className = 'text-sm font-medium text-emerald-400';
  }
  if (accessUrlEl) {
    accessUrlEl.textContent = url;
    accessUrlEl.parentElement?.classList.remove('opacity-50');
  }
  if (copyUrlBtn) copyUrlBtn.style.display = '';
  if (toggleBtn) {
    toggleBtn.className = 'server-btn server-btn-stop';
  }
  if (toggleBtnText) toggleBtnText.textContent = 'Stop Server';
}

export function setServerOffline(): void {
  serverRunning = false;
  if (statusDotEl) statusDotEl.className = 'status-dot status-dot-offline';
  if (statusTextEl) {
    statusTextEl.textContent = 'Offline';
    statusTextEl.className = 'text-sm font-medium text-gray-400';
  }
  if (accessUrlEl) {
    accessUrlEl.textContent = 'Not running';
    accessUrlEl.parentElement?.classList.add('opacity-50');
  }
  if (copyUrlBtn) copyUrlBtn.style.display = 'none';
  if (toggleBtn) {
    toggleBtn.className = 'server-btn server-btn-start';
  }
  if (toggleBtnText) toggleBtnText.textContent = 'Start Server';
  if (connectionsEl) connectionsEl.textContent = '0';
}
