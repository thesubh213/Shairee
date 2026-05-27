/**
 * Shairee — Settings component
 * Password, port, and preferences panel
 */

import { getConfig, updateConfig, type AppConfig } from '../utils/tauri-api';
import { refreshServerStatus } from './ServerStatus';

let settingsPanel: HTMLElement | null = null;
let settingsOverlay: HTMLElement | null = null;
let isOpen = false;
let currentConfig: AppConfig | null = null;

export function initSettings(): void {
  settingsPanel = document.getElementById('settings-panel');
  settingsOverlay = document.getElementById('settings-overlay');

  const openBtn = document.getElementById('settings-btn');
  const closeBtn = document.getElementById('settings-close-btn');

  openBtn?.addEventListener('click', openSettings);
  closeBtn?.addEventListener('click', closeSettings);
  settingsOverlay?.addEventListener('click', closeSettings);

  // Handle Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) closeSettings();
  });
}

async function openSettings(): Promise<void> {
  if (isOpen) return;
  isOpen = true;

  try {
    currentConfig = await getConfig();
    populateForm(currentConfig);
  } catch (err) {
    console.error('Failed to load config:', err);
  }

  if (settingsOverlay) {
    settingsOverlay.style.display = '';
    settingsOverlay.classList.add('animate-fade-in');
  }
  if (settingsPanel) {
    settingsPanel.style.display = '';
    settingsPanel.classList.add('animate-slide-up');
  }
}

function closeSettings(): void {
  if (!isOpen) return;
  isOpen = false;

  if (settingsOverlay) {
    settingsOverlay.style.display = 'none';
    settingsOverlay.classList.remove('animate-fade-in');
  }
  if (settingsPanel) {
    settingsPanel.style.display = 'none';
    settingsPanel.classList.remove('animate-slide-up');
  }
}

function populateForm(config: AppConfig): void {
  const portInput = document.getElementById('settings-port') as HTMLInputElement;
  const passwordInput = document.getElementById('settings-password') as HTMLInputElement;
  const autoStartInput = document.getElementById('settings-autostart') as HTMLInputElement;
  const notifInput = document.getElementById('settings-notifications') as HTMLInputElement;
  const saveBtn = document.getElementById('settings-save-btn');

  if (portInput) portInput.value = String(config.port);
  if (passwordInput) passwordInput.value = config.password || '';
  if (autoStartInput) autoStartInput.checked = config.autoStart ?? false;
  if (notifInput) notifInput.checked = config.showNotifications ?? true;

  saveBtn?.addEventListener('click', async () => {
    if (!currentConfig) return;

    // Validate port input
    const portStr = portInput?.value?.trim() || '8080';
    const port = parseInt(portStr, 10);
    
    if (isNaN(port) || port < 1 || port > 65535) {
      showToast(`Invalid port: must be 1-65535`);
      return;
    }

    // Validate PIN if enabled
    const password = passwordInput?.value?.trim() || '';
    const autoStart = autoStartInput?.checked ?? false;
    const showNotifications = notifInput?.checked ?? true;

    const updated: AppConfig = {
      ...currentConfig,
      port,
      password,
      autoStart,
      showNotifications,
    };

    try {
      await updateConfig(updated);
      currentConfig = updated;
      closeSettings();
      await refreshServerStatus();
      showToast('Settings saved');
    } catch (err) {
      console.error('Failed to save config:', err);
      showToast('Failed to save settings');
    }
  }, { once: true });
}

function showToast(message: string): void {
  const existing = document.getElementById('toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'toast';
  toast.className = 'toast animate-slide-up';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 400);
  }, 2500);
}
