/**
 * Shairee — QRCode component
 * Displays QR code for mobile access
 */

import { getQrCode } from '../utils/tauri-api';

let qrContainerEl: HTMLElement | null = null;
let qrImageEl: HTMLImageElement | null = null;
let qrPlaceholderEl: HTMLElement | null = null;

export function initQRCode(): void {
  qrContainerEl = document.getElementById('qr-container');
  qrImageEl = document.getElementById('qr-image') as HTMLImageElement;
  qrPlaceholderEl = document.getElementById('qr-placeholder');
}

export async function refreshQRCode(serverRunning: boolean): Promise<void> {
  if (!qrContainerEl || !qrImageEl || !qrPlaceholderEl) return;

  if (!serverRunning) {
    qrImageEl.style.display = 'none';
    qrPlaceholderEl.style.display = '';
    qrPlaceholderEl.innerHTML = `
      <div class="flex flex-col items-center gap-2 text-gray-500">
        <svg class="w-12 h-12 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"/>
        </svg>
        <span class="text-sm">Start server to show QR</span>
      </div>
    `;
    return;
  }

  try {
    const dataUri = await getQrCode();
    if (dataUri) {
      qrImageEl.src = dataUri;
      qrImageEl.style.display = '';
      qrPlaceholderEl.style.display = 'none';
      qrImageEl.classList.add('animate-scale-in');
      setTimeout(() => qrImageEl?.classList.remove('animate-scale-in'), 400);
    }
  } catch (err) {
    console.error('Failed to fetch QR code:', err);
    qrImageEl.style.display = 'none';
    qrPlaceholderEl.style.display = '';
    qrPlaceholderEl.innerHTML = `
      <div class="text-sm text-red-400">Failed to generate QR code</div>
    `;
  }
}
