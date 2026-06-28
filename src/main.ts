import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getVersion } from "@tauri-apps/api/app";

function escapeHtml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ─── State ────────────────────────────────────────────────────────────

let serverPort = 8384;
let requirePin = false;
let configPin = "";
let serverRunning = false;
let activeIpList: string[] = [];
let activeIpIndex = 0;
let searchQuery = "";
let sharedFilesList: any[] = [];
let currentTheme = localStorage.getItem("shairee-theme") || "light";
let discoveryAutoRefreshTimer: number | null = null;
let discoveryModalOpen = false;
let lastFocusedElement: HTMLElement | null = null;

// ─── Theme ────────────────────────────────────────────────────────────

function initTheme() {
  const toggleBtn = document.getElementById("btn-theme-toggle");
  applyTheme(currentTheme);

  toggleBtn?.addEventListener("click", () => {
    currentTheme = currentTheme === "light" ? "dark" : "light";
    localStorage.setItem("shairee-theme", currentTheme);
    applyTheme(currentTheme);
    showToast(`Switched to ${currentTheme} mode`, "info");
  });
}

function applyTheme(theme: string) {
  document.documentElement.setAttribute("data-theme", theme);
  if (theme === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
}

// ─── Toast ────────────────────────────────────────────────────────────

function showToast(message: string, type: "success" | "error" | "info" = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = "px-4 py-3 border text-xs font-semibold uppercase tracking-wider transition-all duration-300 transform translate-y-4 opacity-0 pointer-events-auto flex items-center gap-2 rounded-xl shadow-lg";

  if (type === "success") {
    toast.className += " border-success text-success bg-canvas";
    toast.innerHTML = `<span class="text-sm font-bold shrink-0">✓</span><span class="flex-1 normal-case font-medium">${message}</span>`;
  } else if (type === "error") {
    toast.className += " border-sale text-sale bg-canvas";
    toast.innerHTML = `<span class="text-sm font-bold shrink-0">✕</span><span class="flex-1 normal-case font-medium">${message}</span>`;
  } else {
    toast.className += " border-info text-info bg-canvas";
    toast.innerHTML = `<span class="text-sm font-bold shrink-0">⚡</span><span class="flex-1 normal-case font-medium">${message}</span>`;
  }

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.remove("translate-y-4", "opacity-0");
    toast.classList.add("translate-y-0", "opacity-100");
  }, 10);

  setTimeout(() => {
    toast.classList.remove("translate-y-0", "opacity-100");
    toast.classList.add("translate-y-4", "opacity-0");
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ─── Loading Overlay ─────────────────────────────────────────────────

function showFileLoading(isLoading: boolean) {
  const loader = document.getElementById("file-list-loading");
  if (!loader) return;
  if (isLoading) {
    loader.classList.remove("hidden");
    loader.classList.add("flex");
  } else {
    loader.classList.add("hidden");
    loader.classList.remove("flex");
  }
}

// ─── Portal Start/Stop Button Enablement ─────────────────────────────

function updateStartButtonState() {
  const hasFiles = sharedFilesList.length > 0;
  const startBtnHero = document.getElementById("btn-start-server-large") as HTMLButtonElement | null;
  const startBtnAux = document.getElementById("btn-start-server-large-aux") as HTMLButtonElement | null;
  const toggleBtn = document.getElementById("btn-toggle-server") as HTMLButtonElement | null;
  const offlineHint = document.getElementById("offline-hint");

  if (serverRunning) {
    // Server is running — allow stopping via toggle, disable "Start" buttons (replaced by Stop button)
    if (startBtnHero) {
      startBtnHero.disabled = false;
      startBtnHero.classList.remove("opacity-50", "cursor-not-allowed");
      startBtnHero.textContent = "Stop Portal";
    }
    if (toggleBtn) {
      toggleBtn.disabled = false;
      toggleBtn.classList.remove("opacity-50", "cursor-not-allowed");
    }
    // Show no-files hint if server running but no files
    const hint = document.getElementById("no-files-hint");
    if (hint) {
      if (!hasFiles) {
        hint.classList.remove("hidden");
        hint.classList.add("flex");
      } else {
        hint.classList.add("hidden");
        hint.classList.remove("flex");
      }
    }
  } else {
    // Server is stopped
    if (startBtnHero) {
      startBtnHero.textContent = "Start Portal";
      if (hasFiles) {
        startBtnHero.disabled = false;
        startBtnHero.classList.remove("opacity-50", "cursor-not-allowed");
        startBtnHero.title = "Start sharing portal";
      } else {
        startBtnHero.disabled = true;
        startBtnHero.classList.add("opacity-50", "cursor-not-allowed");
        startBtnHero.title = "Add files first to start sharing";
      }
    }
    if (startBtnAux) {
      if (hasFiles) {
        startBtnAux.disabled = false;
        startBtnAux.classList.remove("opacity-50", "cursor-not-allowed");
        startBtnAux.title = "Start sharing portal";
      } else {
        startBtnAux.disabled = true;
        startBtnAux.classList.add("opacity-50", "cursor-not-allowed");
        startBtnAux.title = "Add files first";
      }
    }
    if (toggleBtn) {
      if (hasFiles) {
        toggleBtn.disabled = false;
        toggleBtn.classList.remove("opacity-50", "cursor-not-allowed");
        toggleBtn.title = "Toggle portal";
      } else {
        toggleBtn.disabled = true;
        toggleBtn.classList.add("opacity-50", "cursor-not-allowed");
        toggleBtn.title = "Add files first to start portal";
      }
    }
    if (offlineHint) {
      offlineHint.textContent = hasFiles
        ? "Click above to start sharing on your network"
        : "Add files above to enable the portal";
    }
    // Hide no-files hint when server is stopped
    const hint = document.getElementById("no-files-hint");
    if (hint) {
      hint.classList.add("hidden");
      hint.classList.remove("flex");
    }
  }
}

// ─── Server Status ────────────────────────────────────────────────────

async function updateServerStatus() {
  try {
    const status: any = await invoke("get_server_status");
    serverRunning = status.serverRunning;
    serverPort = status.port;

    if (status.localIps && status.localIps.length > 0) {
      activeIpList = status.localIps;
      if (activeIpIndex >= activeIpList.length) activeIpIndex = 0;
    }

    const indicator = document.getElementById("header-status-indicator");
    const text = document.getElementById("header-status-text");
    const ping = document.getElementById("status-ping");
    const dot = document.getElementById("status-dot");
    const offlineState = document.getElementById("server-offline-state");
    const onlineState = document.getElementById("server-online-state");
    const toggleKnob = document.getElementById("server-toggle-knob");
    const cycleBtn = document.getElementById("btn-cycle-ip");

    // Cycle IP visibility
    if (serverRunning && activeIpList.length > 1) {
      cycleBtn?.classList.remove("hidden");
    } else {
      cycleBtn?.classList.add("hidden");
    }

    if (serverRunning) {
      // Header status
      indicator?.classList.replace("bg-soft-cloud", "bg-success/5");
      indicator?.classList.replace("border-hairline-soft", "border-success");
      if (text) { text.textContent = "Running"; text.classList.add("text-success"); }
      ping?.classList.replace("bg-red-400", "bg-success");
      dot?.classList.replace("bg-red-500", "bg-success");

      offlineState?.classList.add("hidden");
      onlineState?.classList.remove("hidden");
      onlineState?.classList.add("flex");

      toggleKnob?.parentElement?.classList.replace("bg-hairline", "bg-ink");
      toggleKnob?.classList.replace("translate-x-1", "translate-x-6");
      // Sync aria-checked for accessibility
      const toggleParent = toggleKnob?.parentElement as HTMLElement | undefined;
      if (toggleParent) toggleParent.setAttribute("aria-checked", "true");

      const currentIp = activeIpList[activeIpIndex] || "localhost";
      const displayUrl = `http://${currentIp}:${serverPort}`;

      const urlEl = document.getElementById("access-url");
      if (urlEl) {
        urlEl.textContent = displayUrl;
        urlEl.title = activeIpList.length > 1 ? "Multiple IPs — click cycle icon to switch" : "";
        urlEl.style.cursor = activeIpList.length > 1 ? "pointer" : "default";
      }

      const connectionsEl = document.getElementById("active-connections");
      if (connectionsEl) connectionsEl.textContent = (status.activeConnections || 0).toString();

      const pinEl = document.getElementById("active-pin-info");
      if (pinEl) pinEl.textContent = requirePin ? (configPin ? "Active" : "Set") : "None";

      // Fetch QR code
      try {
        const qrBase64 = await invoke("get_qr_code", { url: displayUrl });
        const qrImg = document.getElementById("qr-code-img") as HTMLImageElement;
        if (qrImg) qrImg.src = qrBase64 as string;
      } catch (e) {
        console.error("QR code error:", e);
      }
    } else {
      indicator?.classList.replace("bg-success/5", "bg-soft-cloud");
      indicator?.classList.replace("border-success", "border-hairline-soft");
      if (text) { text.textContent = "Stopped"; text.classList.remove("text-success"); }
      ping?.classList.replace("bg-success", "bg-red-400");
      dot?.classList.replace("bg-success", "bg-red-500");

      offlineState?.classList.remove("hidden");
      onlineState?.classList.add("hidden");
      onlineState?.classList.remove("flex");

      toggleKnob?.parentElement?.classList.replace("bg-ink", "bg-hairline");
      toggleKnob?.classList.replace("translate-x-6", "translate-x-1");
      // Sync aria-checked for accessibility
      const toggleParentOff = toggleKnob?.parentElement as HTMLElement | undefined;
      if (toggleParentOff) toggleParentOff.setAttribute("aria-checked", "false");
    }

    updateStartButtonState();
  } catch (error) {
    console.error("Failed to fetch server status:", error);
  }
}

// ─── File Management ──────────────────────────────────────────────────

async function loadFiles() {
  try {
    sharedFilesList = await invoke("get_shared_files");
    renderFiles();
    updateStartButtonState();
  } catch (error) {
    console.error("Failed to load files:", error);
  }
}

function renderFiles() {
  const fileList = document.getElementById("file-list");
  const emptyState = document.getElementById("file-list-empty");
  const fileCount = document.getElementById("file-count");
  const clearBtn = document.getElementById("btn-clear-files");

  const filtered = sharedFilesList.filter(f =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (fileCount) fileCount.textContent = `${filtered.length} file${filtered.length !== 1 ? "s" : ""}`;

  // Nothing to show at all
  if (sharedFilesList.length === 0) {
    emptyState?.classList.remove("hidden");
    fileList?.classList.add("hidden");
    clearBtn?.classList.add("hidden");
    updateEmptyStateMessage("No files added yet", "Add files above to share them on your local network.");
    return;
  }

  clearBtn?.classList.remove("hidden");

  // Search returned no matches
  if (filtered.length === 0) {
    emptyState?.classList.remove("hidden");
    fileList?.classList.add("hidden");
    updateEmptyStateMessage("No matching files", `Nothing matches "${searchQuery}". Try a different search.`);
    return;
  }

  emptyState?.classList.add("hidden");
  fileList?.classList.remove("hidden");

  if (fileList) {
    fileList.innerHTML = filtered.map(f => {
      const isDir = f.isDirectory;
      const sizeMb = f.size >= 1024 * 1024
        ? `${(f.size / 1024 / 1024).toFixed(1)} MB`
        : f.size >= 1024
          ? `${(f.size / 1024).toFixed(0)} KB`
          : `${f.size} B`;

      const ext = escapeHtml(f.name.split(".").pop()?.toUpperCase() || "FILE");

      let dot1Color = "bg-success";
      if (f.size > 100 * 1024 * 1024) dot1Color = "bg-sale";
      else if (f.size > 10 * 1024 * 1024) dot1Color = "bg-amber-500";

      let dot2Color = "bg-ink";
      let textVisual = escapeHtml(ext.substring(0, 3));
      let stageBg = "bg-soft-cloud";
      let typeLabel = "Document";

      if (isDir) {
        dot2Color = "bg-info";
        textVisual = "DIR";
        stageBg = "bg-blue-50 dark:bg-blue-950/20";
        typeLabel = "Folder";
      } else {
        const extLower = ext.toLowerCase();
        if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(extLower)) {
          dot2Color = "bg-pink-500"; textVisual = "IMG"; stageBg = "bg-pink-50 dark:bg-pink-950/10"; typeLabel = "Image";
        } else if (["mp3", "wav", "flac", "ogg", "m4a"].includes(extLower)) {
          dot2Color = "bg-emerald-500"; textVisual = "AUD"; stageBg = "bg-teal-50 dark:bg-teal-950/10"; typeLabel = "Audio";
        } else if (["mp4", "mkv", "avi", "mov", "webm"].includes(extLower)) {
          dot2Color = "bg-purple-500"; textVisual = "VID"; stageBg = "bg-purple-50 dark:bg-purple-950/10"; typeLabel = "Video";
        } else if (["zip", "rar", "7z", "tar", "gz"].includes(extLower)) {
          dot2Color = "bg-amber-600"; textVisual = "ZIP"; stageBg = "bg-amber-50 dark:bg-amber-950/10"; typeLabel = "Archive";
        } else if (["pdf"].includes(extLower)) {
          dot2Color = "bg-red-500"; textVisual = "PDF"; stageBg = "bg-red-50 dark:bg-red-950/10"; typeLabel = "PDF";
        }
      }

      return `
        <li id="file-${f.id}" class="group relative flex flex-col bg-canvas border border-hairline hover:border-ink rounded-xl select-none animate-fade-in transition-all duration-150 overflow-hidden">
          <!-- Stage -->
          <div class="aspect-square w-full ${stageBg} flex items-center justify-center relative select-none">
            <span class="font-display text-4xl opacity-30 font-bold tracking-widest text-ink select-none">${textVisual}</span>
            <!-- Extension badge -->
            <div class="absolute top-2 left-2 bg-canvas border border-hairline text-ink text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded">
              .${ext}
            </div>
            <!-- Delete button -->
            <button class="btn-delete-file absolute top-2 right-2 w-7 h-7 rounded-full bg-canvas border border-hairline text-ink flex items-center justify-center btn-tap-collapse opacity-0 group-hover:opacity-100 hover:text-sale hover:border-sale transition-all duration-150" data-id="${f.id}" title="Remove">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>
          
          <!-- Metadata -->
          <div class="flex flex-col p-2.5 gap-1">
            <div class="flex gap-1.5 items-center mb-0.5">
              <span class="w-3 h-3 rounded-full ${dot1Color} border border-canvas ring-1 ring-hairline shrink-0" title="Size"></span>
              <span class="w-3 h-3 rounded-full ${dot2Color} border border-canvas ring-1 ring-hairline shrink-0" title="Type"></span>
            </div>
            <span class="text-[11px] font-bold uppercase tracking-wide text-ink truncate" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
            <div class="flex items-center justify-between">
              <span class="text-[10px] font-medium text-mute">${typeLabel}</span>
              <span class="text-[10px] font-bold text-ink">${sizeMb}</span>
            </div>
          </div>
        </li>
      `;
    }).join('');

    document.querySelectorAll(".btn-delete-file").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const target = e.currentTarget as HTMLButtonElement;
        const id = target.getAttribute("data-id");
        if (id) {
          try {
            await invoke("remove_file", { id });
            showToast("File removed from sharing list", "info");
            loadFiles();
          } catch (err) {
            showToast("Failed to remove file", "error");
          }
        }
      });
    });
  }
}

/** Swap the title + subtitle text of the #file-list-empty empty state. */
function updateEmptyStateMessage(title: string, subtitle: string) {
  const emptyState = document.getElementById("file-list-empty");
  if (!emptyState) return;
  const titleEl = emptyState.querySelector(".empty-state-title") as HTMLElement | null;
  const subtitleEl = emptyState.querySelector(".empty-state-subtitle") as HTMLElement | null;
  if (titleEl) titleEl.textContent = title;
  if (subtitleEl) subtitleEl.textContent = subtitle;
}

// ─── Settings Modal ───────────────────────────────────────────────────

async function loadConfig() {
  try {
    const config: any = await invoke("get_config");
    serverPort = config.port;
    requirePin = !!config.password;
    configPin = config.password || "";

    const usernameInput = document.getElementById("setting-username") as HTMLInputElement;
    if (usernameInput) usernameInput.value = config.username || "";

    const portInput = document.getElementById("setting-port") as HTMLInputElement;
    if (portInput) portInput.value = serverPort.toString();

    const passwordInput = document.getElementById("setting-password") as HTMLInputElement;
    if (passwordInput) passwordInput.value = configPin;

    const bindAddressInput = document.getElementById("setting-bind-address") as HTMLInputElement;
    if (bindAddressInput) bindAddressInput.value = config.bindAddress || "0.0.0.0";

    const manualIpInput = document.getElementById("setting-manual-ip") as HTMLInputElement;
    if (manualIpInput) manualIpInput.value = config.manualIp || "";

    const autoDetectToggle = document.getElementById("setting-auto-detect-ip");
    const autoDetectKnob = autoDetectToggle?.querySelector("span");
    if (config.autoDetectIp) {
      autoDetectToggle?.classList.replace("bg-hairline", "bg-ink");
      autoDetectKnob?.classList.replace("translate-x-1", "translate-x-6");
      autoDetectToggle?.setAttribute("aria-checked", "true");
    } else {
      autoDetectToggle?.classList.replace("bg-ink", "bg-hairline");
      autoDetectKnob?.classList.replace("translate-x-6", "translate-x-1");
      autoDetectToggle?.setAttribute("aria-checked", "false");
    }

    const maxDownloadsInput = document.getElementById("setting-max-downloads") as HTMLInputElement;
    if (maxDownloadsInput) maxDownloadsInput.value = config.maxConcurrentDownloads?.toString() || "0";

    updatePasswordToggleUI();
  } catch (e) {
    console.error("Failed to load config:", e);
  }
}

function updatePasswordToggleUI() {
  const passwordToggle = document.getElementById("setting-password-toggle");
  const passwordToggleKnob = passwordToggle?.querySelector("span");
  const passwordInputContainer = document.getElementById("password-input-container");

  if (requirePin) {
    passwordToggle?.classList.replace("bg-hairline", "bg-ink");
    passwordToggleKnob?.classList.replace("translate-x-1", "translate-x-6");
    passwordToggle?.setAttribute("aria-checked", "true");
    passwordInputContainer?.classList.remove("hidden");
  } else {
    passwordToggle?.classList.replace("bg-ink", "bg-hairline");
    passwordToggleKnob?.classList.replace("translate-x-6", "translate-x-1");
    passwordToggle?.setAttribute("aria-checked", "false");
    passwordInputContainer?.classList.add("hidden");
  }
}

function openSettings() {
  loadConfig();
  const errorMsgEl = document.getElementById("settings-error-msg");
  if (errorMsgEl) { errorMsgEl.textContent = ""; errorMsgEl.classList.add("hidden"); }
  openModal("settings-modal");
}

function closeSettings() {
  closeModal("settings-modal");
}

async function saveSettings() {
  const usernameInput = document.getElementById("setting-username") as HTMLInputElement;
  const portInput = document.getElementById("setting-port") as HTMLInputElement;
  const passwordInput = document.getElementById("setting-password") as HTMLInputElement;
  const bindAddressInput = document.getElementById("setting-bind-address") as HTMLInputElement;
  const manualIpInput = document.getElementById("setting-manual-ip") as HTMLInputElement;
  const maxDownloadsInput = document.getElementById("setting-max-downloads") as HTMLInputElement;
  const autoDetectToggle = document.getElementById("setting-auto-detect-ip");
  const errorMsgEl = document.getElementById("settings-error-msg");

  if (errorMsgEl) { errorMsgEl.textContent = ""; errorMsgEl.classList.add("hidden"); }

  const nextUsername = usernameInput?.value.trim() || "Shairee Device";
  const nextPort = parseInt(portInput?.value) || 8384;
  const nextPassword = requirePin ? passwordInput?.value.trim() : "";
  const nextBindAddress = bindAddressInput?.value.trim() || "0.0.0.0";
  const nextManualIp = manualIpInput?.value.trim() || null;
  const autoDetectIp = autoDetectToggle?.classList.contains("bg-ink") ?? true;
  const maxDownloads = parseInt(maxDownloadsInput?.value) || 0;

  if (!nextUsername) {
    showError(errorMsgEl, "Username cannot be empty.");
    return;
  }
  if (isNaN(nextPort) || nextPort < 1 || nextPort > 65535) {
    showError(errorMsgEl, "Port must be between 1 and 65535.");
    return;
  }
  if (requirePin && (nextPassword!.length < 4 || nextPassword!.length > 8 || !/^\d+$/.test(nextPassword!))) {
    showError(errorMsgEl, "PIN must be 4–8 numeric digits.");
    return;
  }

  try {
    // Backend handles port-change restart atomically in update_config
    await invoke("update_config", {
      config: {
        port: nextPort,
        password: nextPassword || null,
        autoStart: false,
        showNotifications: true,
        username: nextUsername,
        bindAddress: nextBindAddress,
        manualIp: nextManualIp,
        autoDetectIp,
        maxConcurrentDownloads: maxDownloads
      }
    });

    showToast("Settings saved", "success");
    closeSettings();
    updateServerStatus();
  } catch (e: any) {
    showError(errorMsgEl, e?.message || "Failed to save settings.");
    showToast("Settings save failed", "error");
  }
}

function showError(el: HTMLElement | null, msg: string) {
  if (el) { el.textContent = msg; el.classList.remove("hidden"); }
  showToast(msg, "error");
}

// ─── Modal Helpers ────────────────────────────────────────────────────

function openModal(modalId: string) {
  const overlay = document.getElementById("modal-overlay");
  const modal = document.getElementById(modalId);

  // Save currently focused element to restore on close
  if (document.activeElement instanceof HTMLElement) {
    lastFocusedElement = document.activeElement;
  }

  // Hide all other modals first
  document.querySelectorAll("[id$='-modal']:not([id='modal-overlay'])").forEach(m => {
    if (m.id !== modalId) {
      m.classList.add("hidden", "opacity-0", "scale-95");
      m.classList.remove("block", "flex", "opacity-100", "scale-100");
    }
  });

  overlay?.classList.remove("opacity-0", "pointer-events-none");
  overlay?.classList.add("opacity-100", "pointer-events-auto");

  modal?.classList.remove("hidden", "opacity-0", "scale-95");
  modal?.classList.add("block", "opacity-100", "scale-100");

  // Move focus into the modal — first focusable element
  if (modal) {
    const focusable = modal.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    setTimeout(() => focusable?.focus(), 50);
  }
}

function closeModal(modalId: string) {
  const overlay = document.getElementById("modal-overlay");
  const modal = document.getElementById(modalId);

  overlay?.classList.remove("opacity-100", "pointer-events-auto");
  overlay?.classList.add("opacity-0", "pointer-events-none");

  modal?.classList.remove("opacity-100", "scale-100");
  modal?.classList.add("opacity-0", "scale-95");

  // Restore focus to the element that opened the modal
  setTimeout(() => {
    modal?.classList.add("hidden");
    modal?.classList.remove("block", "flex");
    lastFocusedElement?.focus();
    lastFocusedElement = null;
  }, 200);
}

// ─── Clear Confirmation ───────────────────────────────────────────────

function openClearConfirm() {
  openModal("confirm-modal");
}

function fnCloseClearConfirm() {
  closeModal("confirm-modal");
}

// ─── Discovery Modal (Unified Send & Receive) ─────────────────────────

let scanning = false;
let incomingSenderIp = "";
let scannedDevicesList: any[] = [];
let activeRemoteDevice: any = null;
let activeRemotePin = "";
let activeRemoteFiles: any[] = [];

function openDiscovery() {
  discoveryModalOpen = true;
  openModal("discovery-modal");
  showDiscoverySubView('devices');
  scanDevices();
  // Start auto-refresh every 3 seconds
  if (discoveryAutoRefreshTimer) clearInterval(discoveryAutoRefreshTimer);
  discoveryAutoRefreshTimer = window.setInterval(() => {
    if (discoveryModalOpen) scanDevices();
  }, 3000);
}

function closeDiscovery() {
  discoveryModalOpen = false;
  closeModal("discovery-modal");
  if (discoveryAutoRefreshTimer) {
    clearInterval(discoveryAutoRefreshTimer);
    discoveryAutoRefreshTimer = null;
  }
}

function showDiscoverySubView(viewName: 'devices' | 'pin' | 'files') {
  const devicesView = document.getElementById("view-discovery-devices");
  const pinView = document.getElementById("view-discovery-pin");
  const filesView = document.getElementById("view-discovery-files");
  const titleEl = document.getElementById("discovery-modal-title");

  devicesView?.classList.toggle("hidden", viewName !== 'devices');
  pinView?.classList.toggle("hidden", viewName !== 'pin');
  filesView?.classList.toggle("hidden", viewName !== 'files');

  if (titleEl) {
    if (viewName === 'devices') titleEl.textContent = "DEVICES";
    else if (viewName === 'pin') titleEl.textContent = "VERIFY PIN";
    else if (viewName === 'files') titleEl.textContent = "REMOTE PORTAL";
  }
}

async function connectToDevice(device: any, pinCode = "") {
  activeRemoteDevice = device;
  activeRemotePin = pinCode;
  
  const errorEl = document.getElementById("remote-pin-error");
  if (errorEl) errorEl.classList.add("hidden");

  try {
    const headers: any = {};
    if (pinCode) {
      headers["Authorization"] = "Bearer " + pinCode;
    }
    
    // Fetch remote files list from the first reachable IP
    let res: Response | null = null;
    let workingIp = "";
    
    for (const ip of device.ips) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const testRes = await fetch(`http://${ip}:${device.port}/api/files`, {
          headers,
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (testRes.ok || testRes.status === 401) {
          res = testRes;
          workingIp = ip;
          break;
        }
      } catch (e) {
        console.warn(`IP ${ip} not reachable for device ${device.name}:`, e);
      }
    }

    if (!res) {
      throw new Error("Could not reach the device on any of its IP addresses.");
    }
    
    // Save the resolved working IP back into the device object so subsequent fetch/downloads use it
    device.ip = workingIp;
    
    if (res.status === 401) {
      if (pinCode) {
        if (errorEl) {
          errorEl.textContent = "Incorrect Passkey PIN. Please try again.";
          errorEl.classList.remove("hidden");
        }
        showToast("Incorrect PIN", "error");
      }
      
      const pinPromptTitle = document.getElementById("pin-prompt-title");
      if (pinPromptTitle) pinPromptTitle.textContent = `ENTER PIN FOR ${device.name.toUpperCase()}`;

      const pinInput = document.getElementById("remote-pin-input") as HTMLInputElement;
      if (pinInput) {
        pinInput.value = "";
        // Autofocus after the view transition completes
        setTimeout(() => pinInput.focus(), 100);
      }

      showDiscoverySubView('pin');
      return;
    }

    if (!res.ok) {
      throw new Error(`HTTP error: ${res.status}`);
    }

    const files = await res.json();
    activeRemoteFiles = files;
    
    // Render remote files
    renderRemoteFiles(device, files);
    showDiscoverySubView('files');

  } catch (err: any) {
    console.error("Connect to remote device failed:", err);
    showToast(`Failed to connect to ${device.name}: ${err.message || err}`, "error");
    showDiscoverySubView('devices');
  }
}

function renderRemoteFiles(device: any, files: any[]) {
  const titleEl = document.getElementById("remote-device-title");
  const ipEl = document.getElementById("remote-device-ip");
  const listEl = document.getElementById("remote-files-list");
  const emptyEl = document.getElementById("remote-files-empty");
  const downloadAllBtn = document.getElementById("btn-remote-download-all") as HTMLButtonElement | null;

  if (titleEl) titleEl.textContent = device.name;
  if (ipEl) ipEl.textContent = `http://${device.ip}:${device.port}`;

  if (files.length === 0) {
    emptyEl?.classList.remove("hidden");
    listEl?.classList.add("hidden");
    if (downloadAllBtn) downloadAllBtn.classList.add("hidden");
    return;
  }

  emptyEl?.classList.add("hidden");
  listEl?.classList.remove("hidden");
  if (downloadAllBtn) downloadAllBtn.classList.remove("hidden");

  if (listEl) {
    listEl.innerHTML = files.map(f => {
      const ext = f.name.split('.').pop()?.toUpperCase() || "FILE";
      const sizeMb = f.size >= 1024 * 1024
        ? `${(f.size / 1024 / 1024).toFixed(1)} MB`
        : f.size >= 1024
          ? `${(f.size / 1024).toFixed(0)} KB`
          : `${f.size} B`;

      let dotColor = "var(--colors-success)";
      let textVisual = "DOC";

      if (f.size > 100 * 1024 * 1024) dotColor = "var(--colors-sale)";
      else if (f.size > 10 * 1024 * 1024) dotColor = "var(--colors-info)";

      const extLower = ext.toLowerCase();
      if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(extLower)) {
        textVisual = "IMG";
      } else if (["mp3", "wav", "flac", "ogg", "m4a"].includes(extLower)) {
        textVisual = "AUD";
      } else if (["mp4", "mkv", "avi", "mov", "webm"].includes(extLower)) {
        textVisual = "VID";
      } else if (["zip", "rar", "7z", "tar", "gz"].includes(extLower)) {
        textVisual = "ZIP";
      } else if (f.isDirectory) {
        textVisual = "DIR";
      }

      return `
        <li class="flex items-center justify-between p-3.5 hover:bg-soft-cloud transition-colors duration-150 gap-3">
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="w-8 h-8 bg-soft-cloud border border-hairline flex items-center justify-center shrink-0 relative rounded-lg">
              <span class="w-1.5 h-1.5 rounded-full absolute top-1.5 left-1.5 bg-success" style="background-color: ${dotColor}"></span>
              <span class="text-[9px] font-bold opacity-40">${textVisual}</span>
            </div>
            <div class="flex flex-col min-w-0">
              <span class="text-xs font-bold uppercase tracking-wider text-ink truncate" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
              <span class="text-[9px] text-mute uppercase font-semibold">${sizeMb} · .${ext}</span>
            </div>
          </div>
          <button class="btn-download-remote-file h-7 px-3 bg-ink text-canvas font-semibold rounded-full text-[9px] uppercase tracking-wider btn-tap-collapse shrink-0" data-id="${f.id}" data-name="${escapeHtml(f.name)}" data-size="${f.size}">
            Get
          </button>
        </li>
      `;
    }).join("");

    // Wire up download buttons
    document.querySelectorAll(".btn-download-remote-file").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const el = e.currentTarget as HTMLButtonElement;
        const fileId = el.getAttribute("data-id") || "";
        const fileName = el.getAttribute("data-name") || "";
        const fileSize = parseInt(el.getAttribute("data-size") || "0");

        el.textContent = "...";
        el.disabled = true;

        showToast(`Downloading ${fileName}...`, "info");

        try {
          await invoke("download_remote_file", {
            senderIp: device.ip,
            senderPort: device.port,
            fileId,
            fileName,
            fileSize,
            pin: activeRemotePin || null
          });
          showToast(`Downloaded ${fileName} successfully!`, "success");
        } catch (err: any) {
          console.error("Download failed:", err);
          showToast(`Download failed: ${err.message || err}`, "error");
        } finally {
          el.textContent = "Get";
          el.disabled = false;
        }
      });
    });
  }
}

async function downloadAllRemoteFiles() {
  if (!activeRemoteDevice || activeRemoteFiles.length === 0) return;

  const downloadAllBtn = document.getElementById("btn-remote-download-all") as HTMLButtonElement | null;
  if (downloadAllBtn) {
    downloadAllBtn.textContent = "...";
    downloadAllBtn.disabled = true;
  }

  showToast(`Downloading all ${activeRemoteFiles.length} files...`, "info");

  let successCount = 0;
  for (const f of activeRemoteFiles) {
    try {
      await invoke("download_remote_file", {
        senderIp: activeRemoteDevice.ip,
        senderPort: activeRemoteDevice.port,
        fileId: f.id,
        fileName: f.name,
        fileSize: f.size,
        pin: activeRemotePin || null
      });
      successCount++;
    } catch (err) {
      console.error(`Failed to download ${f.name}:`, err);
    }
  }

  showToast(`Downloaded ${successCount}/${activeRemoteFiles.length} files successfully!`, "success");

  if (downloadAllBtn) {
    downloadAllBtn.textContent = "Download All";
    downloadAllBtn.disabled = false;
  }
}

async function scanDevices() {
  if (scanning) return;
  scanning = true;

  const listEl = document.getElementById("discovery-list");
  const emptyEl = document.getElementById("discovery-empty");
  const refreshBtn = document.getElementById("btn-refresh-discovery");

  if (refreshBtn) {
    refreshBtn.textContent = "...";
    refreshBtn.classList.add("opacity-60");
  }

  try {
    const devices: any = await invoke("discover_devices");
    scannedDevicesList = devices;

    if (devices.length === 0) {
      if (emptyEl) {
        emptyEl.textContent = "No active Shairee devices found on this network.";
        emptyEl.classList.remove("hidden");
      }
      listEl?.classList.add("hidden");
    } else {
      emptyEl?.classList.add("hidden");
      listEl?.classList.remove("hidden");

      if (listEl) {
        const hasFiles = sharedFilesList.length > 0;
        listEl.innerHTML = devices.map((d: any, index: number) => `
          <li class="flex items-center justify-between p-3.5 hover:bg-soft-cloud transition-colors duration-150 select-none gap-3">
            <div class="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer btn-row-connect" data-index="${index}">
              <div class="w-8 h-8 rounded-full bg-soft-cloud border border-hairline flex items-center justify-center shrink-0">
                <svg class="w-4 h-4 text-ink" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <div class="flex flex-col min-w-0">
                <span class="text-xs font-bold uppercase tracking-wider text-ink truncate">${escapeHtml(d.name)}</span>
                <span class="text-[10px] font-mono text-mute">${escapeHtml(d.ips.join(", "))}:${d.port}${d.requirePin ? ' 🔒' : ''}</span>
              </div>
            </div>
            <div class="flex gap-1.5 shrink-0">
              ${hasFiles ? `
              <button class="btn-send-to h-7 px-2.5 bg-ink text-canvas font-semibold rounded-full text-[9px] uppercase tracking-wider btn-tap-collapse" data-index="${index}" title="Push my files to this device">
                Send→
              </button>` : ''}
              <button class="btn-connect-device h-7 px-2.5 bg-soft-cloud text-ink font-semibold rounded-full text-[9px] uppercase tracking-wider btn-tap-collapse border border-hairline" data-index="${index}" title="Connect to this device">
                Connect
              </button>
            </div>
          </li>
        `).join('');

        // Wire Connect
        document.querySelectorAll(".btn-connect-device, .btn-row-connect").forEach(el => {
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            const target = e.currentTarget as HTMLElement;
            const index = parseInt(target.getAttribute("data-index") || "0");
            const device = scannedDevicesList[index];
            if (device) {
              connectToDevice(device);
            }
          });
        });

        // Wire Send To
        document.querySelectorAll(".btn-send-to").forEach(btn => {
          btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const el = e.currentTarget as HTMLButtonElement;
            const index = parseInt(el.getAttribute("data-index") || "0");
            const device = scannedDevicesList[index];
            if (!device) return;

            if (sharedFilesList.length === 0) {
              showToast("Add files to share first!", "error");
              return;
            }

            el.textContent = "...";
            (el as HTMLButtonElement).disabled = true;
            showToast(`Requesting connection to ${device.name}...`, "info");

            try {
              const res: any = await invoke("send_files_to_device", { targetIps: device.ips, targetPort: device.port });
              if (res.status === "accepted") {
                showToast("Accepted! Sending files now...", "success");
                closeDiscovery();
              } else if (res.status === "declined") {
                showToast("Transfer declined by remote device.", "error");
              } else if (res.status === "timeout") {
                showToast("Request timed out — no response.", "error");
              }
            } catch (err) {
              showToast("Connection failed", "error");
            } finally {
              el.textContent = "Send→";
              (el as HTMLButtonElement).disabled = false;
            }
          });
        });
      }
    }
  } catch (err) {
    console.error("Scan error:", err);
    if (emptyEl) emptyEl.textContent = "Failed to scan network.";
  } finally {
    scanning = false;
    if (refreshBtn) {
      refreshBtn.textContent = "Scan Now";
      refreshBtn.classList.remove("opacity-60");
    }
  }
}

// ─── Incoming Transfer Prompt ─────────────────────────────────────────

function openIncomingTransferPrompt(senderName: string, senderIp: string, fileCount: number) {
  incomingSenderIp = senderIp;

  const senderNameEl = document.getElementById("accept-sender-name");
  const fileCountEl = document.getElementById("accept-file-count");

  if (senderNameEl) senderNameEl.textContent = senderName;
  if (fileCountEl) fileCountEl.textContent = `${fileCount} file${fileCount !== 1 ? 's' : ''}`;

  // Close discovery modal if open and show accept modal
  if (discoveryModalOpen) closeDiscovery();
  openModal("accept-modal");
}

function closeIncomingTransferPrompt() {
  closeModal("accept-modal");
}

async function respondIncomingTransfer(accept: boolean) {
  closeIncomingTransferPrompt();

  try {
    await invoke("respond_to_receive_request", { senderIp: incomingSenderIp, accept });
    if (accept) {
      showToast("Transfer accepted! Check Activity log for progress.", "success");
    } else {
      showToast("Incoming transfer declined.", "info");
    }
  } catch (e) {
    console.error("Respond error:", e);
  }
}

// ─── Transfer Logs ────────────────────────────────────────────────────

async function refreshTransferLog() {
  try {
    const records: any[] = await invoke("get_transfer_log");
    const logList = document.getElementById("transfer-log");
    const logEmpty = document.getElementById("log-empty");

    if (!records || records.length === 0) {
      logEmpty?.classList.remove("hidden");
      logList?.classList.add("hidden");
      return;
    }

    logEmpty?.classList.add("hidden");
    logList?.classList.remove("hidden");

    if (logList) {
      const sortedRecords = [...records].reverse().slice(0, 20);
      logList.innerHTML = sortedRecords.map(item => {
        const sizeMb = item.fileSize >= 1024 * 1024
          ? `${(item.fileSize / 1024 / 1024).toFixed(1)} MB`
          : `${(item.fileSize / 1024).toFixed(0)} KB`;

        let statusText = "Done";
        let statusClass = "text-success";

        if (item.status === "failed") {
          statusText = "Failed";
          statusClass = "text-sale";
        } else if (item.status === "inProgress") {
          const pct = ((item.bytesSent / item.fileSize) * 100).toFixed(0);
          statusText = `${pct}%`;
          statusClass = "text-info animate-pulse-soft";
        }

        const directionIcon = item.isDownload
          ? `<svg class="w-3 h-3 text-success shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>`
          : `<svg class="w-3 h-3 text-info shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0l-4 4m4-4v12"/></svg>`;

        return `
          <li class="flex items-center gap-2.5 py-2.5 px-3 select-none">
            ${directionIcon}
            <div class="flex-1 min-w-0">
              <div class="text-[11px] font-bold text-ink truncate" title="${escapeHtml(item.fileName)}">${escapeHtml(item.fileName)}</div>
              <div class="text-[10px] text-mute font-medium">${escapeHtml(item.remoteAddr)} · ${sizeMb}</div>
            </div>
            <span class="text-[10px] font-bold uppercase tracking-wide ${statusClass} shrink-0">${statusText}</span>
          </li>
        `;
      }).join('');
    }
  } catch (err) {
    console.error("Failed to fetch transfer log:", err);
  }
}

// ─── Toggle Server ────────────────────────────────────────────────────

let toggleServerPending = false;

async function toggleServer() {
  if (toggleServerPending) return;
  if (!serverRunning && sharedFilesList.length === 0) {
    showToast("Add files before starting the portal", "error");
    return;
  }

  toggleServerPending = true;
  try {
    if (serverRunning) {
      await invoke("stop_server");
      showToast("Portal stopped", "info");
    } else {
      await invoke("start_server");
      showToast("Portal started! Broadcasting presence...", "success");
    }
    await updateServerStatus();
  } catch (e) {
    console.error("Toggle server error:", e);
    showToast("Failed to toggle portal", "error");
  } finally {
    toggleServerPending = false;
  }
}

// ─── Event Listeners & Init ───────────────────────────────────────────

window.addEventListener("DOMContentLoaded", () => {
  initTheme();

  // Add Files button
  document.getElementById("btn-add-files")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      const selected = await open({ multiple: true, title: "Select files to share" });
      console.log("Selected files (raw):", selected);
      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        const stringPaths = paths.map((p: any) => {
          if (typeof p === "string") return p;
          if (p.path) return p.path;
          if (p.uri) return p.uri; // Handle Android's content URI
          return p;
        });
        console.log("Selected paths processed:", stringPaths);
        if (stringPaths.length > 0) {
          showFileLoading(true);
          await invoke("add_files", { paths: stringPaths });
          showToast(`${stringPaths.length} file(s) added`, "success");
          await loadFiles();
        }
      }
    } catch (err) {
      console.error("File selection error:", err);
      showToast("File selection failed", "error");
    } finally {
      showFileLoading(false);
    }
  });

  // Add Folder button
  document.getElementById("btn-add-folder")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      const selected = await open({ directory: true, title: "Select a folder to share" });
      console.log("Selected folder (raw):", selected);
      if (selected) {
        const path = typeof selected === "string" 
          ? selected 
          : ((selected as any).path || (selected as any).uri); // Handle Android's content URI
        console.log("Selected folder path processed:", path);
        if (path) {
          showFileLoading(true);
          await invoke("add_folder", { path });
          showToast("Folder added", "success");
          await loadFiles();
        }
      }
    } catch (err) {
      console.error("Folder selection error:", err);
      showToast("Folder selection failed", "error");
    } finally {
      showFileLoading(false);
    }
  });

  // Search bar (desktop)
  document.getElementById("search-bar")?.addEventListener("input", (e) => {
    searchQuery = (e.target as HTMLInputElement).value;
    renderFiles();
  });

  // Search bar (mobile)
  document.getElementById("search-bar-mobile")?.addEventListener("input", (e) => {
    searchQuery = (e.target as HTMLInputElement).value;
    renderFiles();
  });

  // Mobile search toggle
  document.getElementById("btn-mobile-search")?.addEventListener("click", () => {
    const bar = document.getElementById("mobile-search-bar");
    if (bar) {
      const isHidden = bar.classList.contains("hidden");
      bar.classList.toggle("hidden", !isHidden);
      if (isHidden) {
        document.getElementById("search-bar-mobile")?.focus();
      }
    }
  });

  // Drop zone click
  document.getElementById("drop-zone")?.addEventListener("click", () => {
    document.getElementById("btn-add-files")?.click();
  });

  // Portal toggle buttons
  document.getElementById("btn-start-server-large")?.addEventListener("click", toggleServer);
  document.getElementById("btn-start-server-large-aux")?.addEventListener("click", toggleServer);
  document.getElementById("btn-toggle-server")?.addEventListener("click", toggleServer);
  document.getElementById("btn-stop-server")?.addEventListener("click", toggleServer);

  // Cycle IPs
  const cycleIpHandler = () => {
    if (activeIpList.length > 1) {
      activeIpIndex = (activeIpIndex + 1) % activeIpList.length;
      updateServerStatus();
      showToast(`Switched to ${activeIpList[activeIpIndex]}`, "info");
      const urlEl = document.getElementById("access-url");
      if (urlEl) {
        urlEl.classList.add("text-info");
        setTimeout(() => urlEl.classList.remove("text-info"), 800);
      }
    }
  };

  document.getElementById("access-url")?.addEventListener("click", cycleIpHandler);
  document.getElementById("btn-cycle-ip")?.addEventListener("click", (e) => {
    e.stopPropagation();
    cycleIpHandler();
  });

  // Copy URL
  document.getElementById("btn-copy-url")?.addEventListener("click", async () => {
    const accessUrl = document.getElementById("access-url")?.textContent;
    if (accessUrl) {
      try {
        await navigator.clipboard.writeText(accessUrl);
        showToast("URL copied to clipboard", "success");
        const btn = document.getElementById("btn-copy-url");
        const showCopy = btn?.querySelector(".show-copy");
        const showCheck = btn?.querySelector(".show-check");
        if (showCopy && showCheck) {
          showCopy.classList.add("hidden");
          showCheck.classList.remove("hidden");
          setTimeout(() => {
            showCopy.classList.remove("hidden");
            showCheck.classList.add("hidden");
          }, 2000);
        }
      } catch (err) {
        console.error("Copy failed:", err);
      }
    }
  });

  // Settings
  document.getElementById("btn-settings")?.addEventListener("click", openSettings);
  document.getElementById("btn-close-settings")?.addEventListener("click", closeSettings);
  document.getElementById("btn-save-settings")?.addEventListener("click", saveSettings);

  document.getElementById("setting-password-toggle")?.addEventListener("click", () => {
    requirePin = !requirePin;
    updatePasswordToggleUI();
  });

  // Auto-detect IP toggle
  document.getElementById("setting-auto-detect-ip")?.addEventListener("click", (e) => {
    const toggle = e.currentTarget as HTMLElement;
    const knob = toggle.querySelector("span");
    const isOn = toggle.classList.contains("bg-ink");
    if (isOn) {
      toggle.classList.replace("bg-ink", "bg-hairline");
      knob?.classList.replace("translate-x-6", "translate-x-1");
      toggle.setAttribute("aria-checked", "false");
    } else {
      toggle.classList.replace("bg-hairline", "bg-ink");
      knob?.classList.replace("translate-x-1", "translate-x-6");
      toggle.setAttribute("aria-checked", "true");
    }
  });

  // Clear files
  document.getElementById("btn-clear-files")?.addEventListener("click", openClearConfirm);
  document.getElementById("btn-cancel-clear")?.addEventListener("click", fnCloseClearConfirm);
  document.getElementById("btn-confirm-clear")?.addEventListener("click", async () => {
    try {
      await invoke("clear_files");
      showToast("All files cleared", "success");
      await loadFiles();
    } catch (err) {
      showToast("Failed to clear files", "error");
    } finally {
      fnCloseClearConfirm();
    }
  });

  // Discovery / receive buttons
  document.getElementById("btn-header-receive")?.addEventListener("click", openDiscovery);
  document.getElementById("btn-find-devices")?.addEventListener("click", openDiscovery);
  document.getElementById("btn-close-discovery")?.addEventListener("click", closeDiscovery);
  document.getElementById("btn-refresh-discovery")?.addEventListener("click", () => scanDevices());

  // Connected remote device actions
  document.getElementById("btn-remote-pin-back")?.addEventListener("click", () => {
    showDiscoverySubView('devices');
  });
  document.getElementById("btn-remote-files-back")?.addEventListener("click", () => {
    showDiscoverySubView('devices');
  });
  document.getElementById("btn-remote-download-all")?.addEventListener("click", downloadAllRemoteFiles);
  document.getElementById("btn-remote-pin-submit")?.addEventListener("click", () => {
    const pinVal = (document.getElementById("remote-pin-input") as HTMLInputElement)?.value;
    if (activeRemoteDevice) {
      connectToDevice(activeRemoteDevice, pinVal);
    }
  });

  // Submit PIN on Enter key
  document.getElementById("remote-pin-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const pinVal = (e.target as HTMLInputElement).value;
      if (activeRemoteDevice) {
        connectToDevice(activeRemoteDevice, pinVal);
      }
    }
  });

  // Incoming transfer
  document.getElementById("btn-accept-transfer")?.addEventListener("click", () => respondIncomingTransfer(true));
  document.getElementById("btn-decline-transfer")?.addEventListener("click", () => respondIncomingTransfer(false));

  // Overlay click to close
  document.getElementById("modal-overlay")?.addEventListener("click", (e) => {
    if (e.target === document.getElementById("modal-overlay")) {
      const settings = document.getElementById("settings-modal");
      const confirm = document.getElementById("confirm-modal");
      const discovery = document.getElementById("discovery-modal");
      const accept = document.getElementById("accept-modal");

      if (settings && !settings.classList.contains("hidden")) closeSettings();
      if (confirm && !confirm.classList.contains("hidden")) fnCloseClearConfirm();
      if (discovery && !discovery.classList.contains("hidden")) closeDiscovery();
      if (accept && !accept.classList.contains("hidden")) closeIncomingTransferPrompt();
    }
  });

  // Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const settings = document.getElementById("settings-modal");
      const confirm = document.getElementById("confirm-modal");
      const discovery = document.getElementById("discovery-modal");
      const accept = document.getElementById("accept-modal");

      if (settings && !settings.classList.contains("hidden")) { closeSettings(); return; }
      if (confirm && !confirm.classList.contains("hidden")) { fnCloseClearConfirm(); return; }
      if (discovery && !discovery.classList.contains("hidden")) { closeDiscovery(); return; }
      if (accept && !accept.classList.contains("hidden")) { closeIncomingTransferPrompt(); return; }
    }
  });

  // Native drag & drop
  try {
    const webview = getCurrentWebview();
    webview.onDragDropEvent((event) => {
      const dropZone = document.getElementById("drop-zone");
      if (event.payload.type === "enter" || event.payload.type === "over") {
        dropZone?.classList.add("bg-info/5", "border-info");
        dropZone?.classList.remove("border-hairline");
      } else if (event.payload.type === "drop") {
        dropZone?.classList.remove("bg-info/5", "border-info");
        dropZone?.classList.add("border-hairline");
        const paths = event.payload.paths;
        if (paths && paths.length > 0) {
          showFileLoading(true);
          invoke("add_files", { paths })
            .then(async () => {
              showToast(`${paths.length} item(s) added!`, "success");
              await loadFiles();
            })
            .catch(() => showToast("Failed to add dropped files", "error"))
            .finally(() => showFileLoading(false));
        }
      } else if (event.payload.type === "leave") {
        dropZone?.classList.remove("bg-info/5", "border-info");
        dropZone?.classList.add("border-hairline");
      }
    });
  } catch (e) {
    console.error("Drag & drop init error:", e);
  }

  // Initial load
  updateServerStatus();
  loadFiles();
  refreshTransferLog();
  checkForUpdates();

  // Prompt username if default or not set
  setTimeout(async () => {
    try {
      const config: any = await invoke("get_config");
      const isDefault = !config.username || config.username === "Shairee Device";
      const hasPrompted = localStorage.getItem("shairee-username-prompted");
      if (isDefault && !hasPrompted) {
        localStorage.setItem("shairee-username-prompted", "true");
        showToast("Please set a username so other devices recognize you.", "info");
        openSettings();
      }
    } catch (e) {
      console.error("Failed to check username on startup:", e);
    }
  }, 1500);

  // Polling interval while server runs
  setInterval(() => {
    if (serverRunning) {
      updateServerStatus();
      refreshTransferLog();
    }
  }, 2500);
});

// ─── Tauri Event Listeners ────────────────────────────────────────────

listen("server-started", () => {
  updateServerStatus();
  // If discovery modal is open when our own server starts, trigger a rescan
  // (so others can see us and vice versa)
  if (discoveryModalOpen) scanDevices();
});

listen("server-stopped", () => updateServerStatus());
listen("files-changed", () => loadFiles());
listen("transfer-progress", () => refreshTransferLog());

listen("transfer-complete", (event: any) => {
  const payload = event.payload;
  showToast(`Transfer complete: ${payload.fileName || "file"}`, "success");
  refreshTransferLog();
});

listen("incoming-transfer-request", (event: any) => {
  const payload = event.payload;
  openIncomingTransferPrompt(payload.senderName, payload.senderIp, payload.files.length);
});

async function checkForUpdates() {
  try {
    const currentVersion = await getVersion();
    const response = await fetch("https://api.github.com/repos/thesubh213/Shairee/releases/latest");
    if (!response.ok) throw new Error("GitHub Releases API unavailable");
    const latestRelease = await response.json();
    
    let latestVersion = latestRelease.tag_name;
    if (latestVersion.startsWith("v")) {
      latestVersion = latestVersion.substring(1);
    }

    if (isNewerVersion(latestVersion, currentVersion)) {
      const banner = document.getElementById("update-banner");
      const textEl = document.getElementById("update-banner-text");
      const linkEl = document.getElementById("update-banner-link") as HTMLAnchorElement | null;
      
      if (banner && textEl && linkEl) {
        textEl.textContent = `New Update Available: Version v${latestVersion} is now available!`;
        
        let downloadUrl = latestRelease.html_url;
        const userAgent = navigator.userAgent.toLowerCase();
        const isAndroid = userAgent.includes("android");
        
        const assets = latestRelease.assets || [];
        const targetExtension = isAndroid ? ".apk" : ".exe";
        const matchingAsset = assets.find((a: any) => a.name.toLowerCase().endsWith(targetExtension));
        
        if (matchingAsset) {
          downloadUrl = matchingAsset.browser_download_url;
        }

        linkEl.href = downloadUrl;
        banner.classList.remove("hidden");
        banner.classList.add("flex");
      }
    }
  } catch (err) {
    console.error("Failed to check for updates:", err);
  }
}

function isNewerVersion(latest: string, current: string): boolean {
  const latestParts = latest.split('.').map(Number);
  const currentParts = current.split('.').map(Number);
  
  for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
    const l = latestParts[i] || 0;
    const c = currentParts[i] || 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}
