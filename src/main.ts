import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";

function escapeHtml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// State variables
let serverPort = 8384;
let requirePin = false;
let configPin = "";
let serverRunning = false;
let activeIpList: string[] = [];
let activeIpIndex = 0;
let searchQuery = "";
let sharedFilesList: any[] = [];
let currentTheme = localStorage.getItem("shairee-theme") || "light";

// ─── Theme Switcher ──────────────────────────────────────────────────

function initTheme() {
  const toggleBtn = document.getElementById("btn-theme-toggle");
  
  // Apply initial state
  document.documentElement.setAttribute("data-theme", currentTheme);
  if (currentTheme === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }

  toggleBtn?.addEventListener("click", () => {
    currentTheme = currentTheme === "light" ? "dark" : "light";
    localStorage.setItem("shairee-theme", currentTheme);
    document.documentElement.setAttribute("data-theme", currentTheme);
    if (currentTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    showToast(`Switched to ${currentTheme} mode`, "info");
  });
}

// ─── Toast System ────────────────────────────────────────────────────

function showToast(message: string, type: "success" | "error" | "info" = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  // Basic Nike classes: flat, pill/oval border, canvas background, ink text, no shadow
  toast.className = "px-6 py-3 border text-xs font-semibold uppercase tracking-wider transition-all duration-300 transform translate-y-4 opacity-0 pointer-events-auto flex items-center gap-2 max-w-sm rounded-full bg-canvas text-ink border-ink";
  
  let icon = "⚡";
  if (type === "success") {
    toast.className += " border-success text-success bg-success/5";
    icon = "✓";
  } else if (type === "error") {
    toast.className += " border-sale text-sale bg-sale/5";
    icon = "✕";
  } else {
    toast.className += " border-info text-info bg-info/5";
  }
  
  toast.innerHTML = `<span class="text-sm font-bold shrink-0">${icon}</span> <span class="flex-1">${message}</span>`;
  
  container.appendChild(toast);
  
  // Trigger transition
  setTimeout(() => {
    toast.classList.remove("translate-y-4", "opacity-0");
    toast.classList.add("translate-y-0", "opacity-100");
  }, 10);

  // Fade out and remove
  setTimeout(() => {
    toast.classList.remove("translate-y-0", "opacity-100");
    toast.classList.add("translate-y-4", "opacity-0");
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 3500);
}

// ─── Loading Overlay Toggler ─────────────────────────────────────────

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

// ─── Status Updates ──────────────────────────────────────────────────

async function updateServerStatus() {
  try {
    const status: any = await invoke("get_server_status");
    serverRunning = status.serverRunning;
    serverPort = status.port;

    // Refresh the available IP addresses
    if (status.localIps && status.localIps.length > 0) {
      activeIpList = status.localIps;
      if (activeIpIndex >= activeIpList.length) {
        activeIpIndex = 0;
      }
    }

    const indicator = document.getElementById("header-status-indicator");
    const text = document.getElementById("header-status-text");
    const ping = document.getElementById("status-ping");
    const dot = document.getElementById("status-dot");
    
    const offlineState = document.getElementById("server-offline-state");
    const onlineState = document.getElementById("server-online-state");
    const toggleKnob = document.getElementById("server-toggle-knob");
    
    // Toggle cycle IP button based on IP list length
    const cycleBtn = document.getElementById("btn-cycle-ip");
    if (serverRunning && activeIpList.length > 1) {
      cycleBtn?.classList.remove("hidden");
    } else {
      cycleBtn?.classList.add("hidden");
    }

    const startBtnLarge = document.getElementById("btn-start-server-large");
    if (startBtnLarge) {
      startBtnLarge.textContent = serverRunning ? "Stop Sharing Portal" : "Start Sharing Portal";
    }

    if (serverRunning) {
      indicator?.classList.replace("bg-soft-cloud", "bg-success/5");
      indicator?.classList.replace("border-hairline-soft", "border-success");
      if (text) {
        text.textContent = "Running";
        text.classList.add("text-success");
      }
      ping?.classList.replace("bg-red-400", "bg-success");
      dot?.classList.replace("bg-red-500", "bg-success");
      
      offlineState?.classList.add("hidden");
      onlineState?.classList.remove("hidden");
      onlineState?.classList.add("flex");
      
      toggleKnob?.parentElement?.classList.replace("bg-hairline", "bg-ink");
      toggleKnob?.classList.replace("translate-x-1", "translate-x-6");
      
      const currentIp = activeIpList[activeIpIndex] || "localhost";
      const displayUrl = `http://${currentIp}:${serverPort}`;

      const urlEl = document.getElementById("access-url");
      if (urlEl) {
        urlEl.textContent = displayUrl;
        if (activeIpList.length > 1) {
          urlEl.title = "Multiple IPs detected! Click cycle icon to cycle adapters.";
          urlEl.style.cursor = "pointer";
        } else {
          urlEl.title = "";
          urlEl.style.cursor = "default";
        }
      }
      
      const connectionsEl = document.getElementById("active-connections");
      if (connectionsEl) connectionsEl.textContent = (status.activeConnections || 0).toString();

      const pinEl = document.getElementById("active-pin-info");
      if (pinEl) {
        pinEl.textContent = requirePin ? (configPin || "Active") : "None Set";
      }
      
      // Fetch QR Code specifically for the displayed IP
      try {
        const qrBase64 = await invoke("get_qr_code", { url: displayUrl });
        const qrImg = document.getElementById("qr-code-img") as HTMLImageElement;
        if (qrImg) qrImg.src = qrBase64 as string;
      } catch (e) {
        console.error("No QR available yet:", e);
      }
    } else {
      indicator?.classList.replace("bg-success/5", "bg-soft-cloud");
      indicator?.classList.replace("border-success", "border-hairline-soft");
      if (text) {
        text.textContent = "Stopped";
        text.classList.remove("text-success");
      }
      ping?.classList.replace("bg-success", "bg-red-400");
      dot?.classList.replace("bg-success", "bg-red-500");
      
      offlineState?.classList.remove("hidden");
      onlineState?.classList.add("hidden");
      onlineState?.classList.remove("flex");
      
      toggleKnob?.parentElement?.classList.replace("bg-ink", "bg-hairline");
      toggleKnob?.classList.replace("translate-x-6", "translate-x-1");
    }
  } catch (error) {
    console.error("Failed to fetch server status:", error);
  }
}

// ─── File Management & Product Card Rendering ─────────────────────────

async function loadFiles() {
  try {
    sharedFilesList = await invoke("get_shared_files");
    renderFiles();
  } catch (error) {
    console.error("Failed to load files:", error);
  }
}

function renderFiles() {
  const fileList = document.getElementById("file-list");
  const emptyState = document.getElementById("file-list-empty");
  const fileCount = document.getElementById("file-count");
  const clearBtn = document.getElementById("btn-clear-files");
  
  // Filter list based on search bar text
  const filtered = sharedFilesList.filter(f => 
    f.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (fileCount) fileCount.textContent = `${filtered.length} file${filtered.length !== 1 ? "s" : ""}`;
  
  if (filtered.length === 0) {
    emptyState?.classList.remove("hidden");
    fileList?.classList.add("hidden");
    clearBtn?.classList.add("hidden");
    return;
  }
  
  emptyState?.classList.add("hidden");
  fileList?.classList.remove("hidden");
  
  if (sharedFilesList.length > 0) {
    clearBtn?.classList.remove("hidden");
  } else {
    clearBtn?.classList.add("hidden");
  }
  
  if (fileList) {
    fileList.innerHTML = filtered.map(f => {
      const isDir = f.isDirectory;
      const sizeMb = (f.size / 1024 / 1024).toFixed(2);
      const ext = escapeHtml(f.name.split(".").pop()?.toUpperCase() || "FILE");
      
      // Nike Swatch Dots Color logic: size indicator + type indicator + state
      // Dot 1: File size group (Small: green, Med: orange, Large: red)
      let dot1Color = "bg-success";
      if (f.size > 100 * 1024 * 1024) {
        dot1Color = "bg-sale";
      } else if (f.size > 10 * 1024 * 1024) {
        dot1Color = "bg-amber-500";
      }
      
      // Dot 2: File type group
      let dot2Color = "bg-ink";
      let textVisual = escapeHtml(ext.substring(0, 3));
      let stageBg = "bg-soft-cloud";
      let typeLabel = "Standard Document";
      
      if (isDir) {
        dot2Color = "bg-info";
        textVisual = "DIR";
        stageBg = "bg-soft-cloud border border-hairline";
        typeLabel = "Directory Folder";
      } else {
        const extLower = ext.toLowerCase();
        if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(extLower)) {
          dot2Color = "bg-pink-500";
          textVisual = "IMG";
          stageBg = "bg-pink-100 dark:bg-pink-900/10";
          typeLabel = "Image Media";
        } else if (["mp3", "wav", "flac", "ogg", "m4a"].includes(extLower)) {
          dot2Color = "bg-emerald-500";
          textVisual = "AUD";
          stageBg = "bg-teal-50 dark:bg-teal-950/10";
          typeLabel = "Audio File";
        } else if (["mp4", "mkv", "avi", "mov", "webm"].includes(extLower)) {
          dot2Color = "bg-purple-500";
          textVisual = "VID";
          stageBg = "bg-purple-50 dark:bg-purple-950/10";
          typeLabel = "Video Stream";
        } else if (["zip", "rar", "7z", "tar", "gz"].includes(extLower)) {
          dot2Color = "bg-amber-600";
          textVisual = "ZIP";
          stageBg = "bg-amber-50 dark:bg-amber-950/10";
          typeLabel = "Archive File";
        }
      }

      return `
        <li id="file-${f.id}" class="group relative flex flex-col bg-canvas border border-transparent select-none animate-fade-in">
          <!-- 1:1 Product Stage Photograph Backdrop -->
          <div class="aspect-square w-full ${stageBg} flex flex-col items-center justify-center relative select-none">
            
            <!-- Category typography overlay -->
            <span class="font-display text-5xl opacity-40 font-bold tracking-widest text-ink select-none">${textVisual}</span>
            
            <!-- Top-left file extension badge (Nike Promo style) -->
            <div class="absolute top-3 left-3 bg-canvas border border-hairline text-ink text-[9px] uppercase tracking-wider font-bold px-2 py-0.5 select-none">
              .${ext}
            </div>

            <!-- Absolute overlay circular delete button (Icon Circular CTA) -->
            <button class="btn-delete-file absolute top-3 right-3 w-8 h-8 rounded-full bg-canvas border border-hairline text-ink flex items-center justify-center btn-tap-collapse opacity-80 hover:opacity-100 hover:text-sale hover:border-sale shadow-none" data-id="${f.id}" title="Remove file">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>
          
          <!-- Metadata rows with 8px base grid spacing -->
          <div class="flex flex-col pt-3 gap-1 px-1">
            <!-- Nike Swatch Color Dots row -->
            <div class="flex gap-2 mb-1 items-center">
              <span class="w-3.5 h-3.5 rounded-full ${dot1Color} border border-canvas ring-1 ring-hairline" title="Size Indicator"></span>
              <span class="w-3.5 h-3.5 rounded-full ${dot2Color} border border-canvas ring-1 ring-hairline" title="Type Indicator"></span>
              <span class="w-3.5 h-3.5 rounded-full bg-hairline border border-canvas ring-1 ring-hairline" title="Local Device"></span>
            </div>

            <!-- Product name -->
            <span class="text-xs font-bold uppercase tracking-wider text-ink truncate max-w-full" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
            
            <!-- Subtitle -->
            <span class="text-[10px] font-semibold text-mute uppercase tracking-wider">${typeLabel}</span>
            
            <!-- Price Row (Size) -->
            <span class="text-xs font-bold text-ink mt-0.5">${sizeMb} MB</span>
          </div>
        </li>
      `;
    }).join('');

    // Wire delete events
    document.querySelectorAll(".btn-delete-file").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const target = e.currentTarget as HTMLButtonElement;
        const id = target.getAttribute("data-id");
        if (id) {
          try {
            await invoke("remove_file", { id });
            showToast("Item severed from sharing index", "info");
            loadFiles();
          } catch (err) {
            console.error("Failed to delete file:", err);
            showToast("Failed to sever sharing index", "error");
          }
        }
      });
    });
  }
}

// ─── Settings Modal ──────────────────────────────────────────────────

async function loadConfig() {
  try {
    const config: any = await invoke("get_config");
    serverPort = config.port;
    requirePin = !!config.password;
    configPin = config.password || "";
    
    const portInput = document.getElementById("setting-port") as HTMLInputElement;
    if (portInput) portInput.value = serverPort.toString();
    
    const passwordInput = document.getElementById("setting-password") as HTMLInputElement;
    if (passwordInput) passwordInput.value = configPin;
    
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
    passwordInputContainer?.classList.remove("hidden");
  } else {
    passwordToggle?.classList.replace("bg-ink", "bg-hairline");
    passwordToggleKnob?.classList.replace("translate-x-6", "translate-x-1");
    passwordInputContainer?.classList.add("hidden");
  }
}

function openSettings() {
  loadConfig();
  const errorMsgEl = document.getElementById("settings-error-msg");
  if (errorMsgEl) {
    errorMsgEl.textContent = "";
    errorMsgEl.classList.add("hidden");
  }

  const overlay = document.getElementById("modal-overlay");
  const modal = document.getElementById("settings-modal");
  
  overlay?.classList.remove("opacity-0", "pointer-events-none");
  overlay?.classList.add("opacity-100", "pointer-events-auto");
  
  modal?.classList.remove("hidden", "opacity-0", "scale-95");
  modal?.classList.add("block", "opacity-100", "scale-100");
}

function closeSettings() {
  const overlay = document.getElementById("modal-overlay");
  const modal = document.getElementById("settings-modal");
  
  overlay?.classList.remove("opacity-100", "pointer-events-auto");
  overlay?.classList.add("opacity-0", "pointer-events-none");
  
  modal?.classList.remove("opacity-100", "scale-100");
  modal?.classList.add("opacity-0", "scale-95");
  
  setTimeout(() => {
    modal?.classList.add("hidden");
    modal?.classList.remove("block");
  }, 200);
}

async function saveSettings() {
  const portInput = document.getElementById("setting-port") as HTMLInputElement;
  const passwordInput = document.getElementById("setting-password") as HTMLInputElement;
  const errorMsgEl = document.getElementById("settings-error-msg");
  
  if (errorMsgEl) {
    errorMsgEl.textContent = "";
    errorMsgEl.classList.add("hidden");
  }

  const nextPort = parseInt(portInput?.value) || 8384;
  const nextPassword = requirePin ? passwordInput?.value.trim() : "";
  
  // Validation checks
  if (isNaN(nextPort) || nextPort < 1 || nextPort > 65535) {
    if (errorMsgEl) {
      errorMsgEl.textContent = "Port must be a valid integer between 1 and 65535.";
      errorMsgEl.classList.remove("hidden");
    }
    showToast("Invalid custom port value", "error");
    return;
  }

  if (requirePin) {
    if (nextPassword.length < 4 || nextPassword.length > 8 || !/^\d+$/.test(nextPassword)) {
      if (errorMsgEl) {
        errorMsgEl.textContent = "PIN must be between 4 and 8 numeric digits.";
        errorMsgEl.classList.remove("hidden");
      }
      showToast("PIN format error", "error");
      return;
    }
  }

  try {
    const status: any = await invoke("get_server_status");
    const wasRunning = status.serverRunning;
    const oldPort = status.port;
    
    await invoke("update_config", {
      config: {
        port: nextPort,
        password: nextPassword || null,
        autoStart: false,
        showNotifications: true
      }
    });
    
    showToast("Portal configuration updated", "success");
    closeSettings();
    
    // Automatically restart server if running on a different port
    if (wasRunning && nextPort !== oldPort) {
      showToast("Rebinding server to new port...", "info");
      await invoke("stop_server");
      await invoke("start_server");
    }
    
    updateServerStatus();
  } catch (e: any) {
    console.error("Failed to save settings:", e);
    if (errorMsgEl) {
      errorMsgEl.textContent = e?.message || e || "Failed to update configuration.";
      errorMsgEl.classList.remove("hidden");
    }
    showToast("Configuration sync failed", "error");
  }
}

// ─── Clear Confirmation Dialog ───────────────────────────────────────

function openClearConfirm() {
  const overlay = document.getElementById("modal-overlay");
  const confirmModal = document.getElementById("confirm-modal");
  
  overlay?.classList.remove("opacity-0", "pointer-events-none");
  overlay?.classList.add("opacity-100", "pointer-events-auto");
  
  confirmModal?.classList.remove("hidden", "opacity-0", "scale-95");
  confirmModal?.classList.add("block", "opacity-100", "scale-100");
}

function fnCloseClearConfirm() {
  const overlay = document.getElementById("modal-overlay");
  const confirmModal = document.getElementById("confirm-modal");
  
  overlay?.classList.remove("opacity-100", "pointer-events-auto");
  overlay?.classList.add("opacity-0", "pointer-events-none");
  
  confirmModal?.classList.remove("opacity-100", "scale-100");
  confirmModal?.classList.add("opacity-0", "scale-95");
  
  setTimeout(() => {
    confirmModal?.classList.add("hidden");
    confirmModal?.classList.remove("block");
  }, 200);
}

// ─── Local Network Discovery & Receive Modes ─────────────────────────

let scanning = false;
let incomingSenderIp = "";

function openDiscovery() {
  const overlay = document.getElementById("modal-overlay");
  const discoveryModal = document.getElementById("discovery-modal");
  
  overlay?.classList.remove("opacity-0", "pointer-events-none");
  overlay?.classList.add("opacity-100", "pointer-events-auto");
  
  discoveryModal?.classList.remove("hidden", "opacity-0", "scale-95");
  discoveryModal?.classList.add("block", "opacity-100", "scale-100");
  
  scanDevices();
}

function closeDiscovery() {
  const overlay = document.getElementById("modal-overlay");
  const discoveryModal = document.getElementById("discovery-modal");
  
  overlay?.classList.remove("opacity-100", "pointer-events-auto");
  overlay?.classList.add("opacity-0", "pointer-events-none");
  
  discoveryModal?.classList.remove("opacity-100", "scale-100");
  discoveryModal?.classList.add("opacity-0", "scale-95");
  
  setTimeout(() => {
    discoveryModal?.classList.add("hidden");
    discoveryModal?.classList.remove("block");
  }, 200);
}

async function scanDevices() {
  if (scanning) return;
  scanning = true;
  
  const listEl = document.getElementById("discovery-list");
  const emptyEl = document.getElementById("discovery-empty");
  const refreshBtn = document.getElementById("btn-refresh-discovery");
  
  if (refreshBtn) {
    refreshBtn.textContent = "Scanning...";
    refreshBtn.classList.add("animate-pulse-soft");
  }
  
  if (emptyEl) {
    emptyEl.textContent = "Scanning local subnet for active portals...";
    emptyEl.classList.remove("hidden");
  }
  listEl?.classList.add("hidden");

  try {
    const devices: any = await invoke("discover_devices");
    
    if (devices.length === 0) {
      if (emptyEl) {
        emptyEl.textContent = "No active portals discovered on this network segment.";
        emptyEl.classList.remove("hidden");
      }
      listEl?.classList.add("hidden");
    } else {
      emptyEl?.classList.add("hidden");
      listEl?.classList.remove("hidden");
      
      if (listEl) {
        listEl.innerHTML = devices.map((d: any) => `
          <li class="flex items-center justify-between p-3.5 hover:bg-soft-cloud transition-colors duration-150 select-none">
            <div class="flex flex-col gap-0.5">
              <span class="text-xs font-bold uppercase tracking-wider text-ink">${escapeHtml(d.name)}</span>
              <span class="text-[10px] font-mono text-mute">${escapeHtml(d.ip)}:${d.port} ${d.requirePin ? '🔒' : ''}</span>
            </div>
            <button class="btn-send-to h-7 px-4 bg-ink text-canvas font-semibold rounded-full text-[9px] uppercase tracking-wider btn-tap-collapse border border-transparent" data-ip="${escapeHtml(d.ip)}" data-port="${d.port}">
              Send Files
            </button>
          </li>
        `).join('');
        
        // Wire send action
        document.querySelectorAll(".btn-send-to").forEach(btn => {
          btn.addEventListener("click", async (e) => {
            const el = e.currentTarget as HTMLButtonElement;
            const ip = el.getAttribute("data-ip") || "";
            const port = parseInt(el.getAttribute("data-port") || "8384");
            
            if (sharedFilesList.length === 0) {
              showToast("Add files to your shared list first!", "error");
              return;
            }

            el.textContent = "Connecting...";
            el.disabled = true;
            
            showToast(`Requesting transfer to ${ip}:${port}...`, "info");
            
            try {
              const res: any = await invoke("send_files_to_device", { targetIp: ip, targetPort: port });
              if (res.status === "accepted") {
                showToast("Connection accepted! Sending files...", "success");
                closeDiscovery();
              } else if (res.status === "declined") {
                showToast("Connection declined by remote device.", "error");
              } else if (res.status === "timeout") {
                showToast("Transfer request timed out.", "error");
              }
            } catch (err) {
              console.error("Transfer error:", err);
              showToast("Direct transfer failed to connect", "error");
            } finally {
              el.textContent = "Send Files";
              el.disabled = false;
            }
          });
        });
      }
    }
  } catch (err) {
    console.error("Scan error:", err);
    if (emptyEl) emptyEl.textContent = "Failed to scan network adapter.";
  } finally {
    scanning = false;
    if (refreshBtn) {
      refreshBtn.textContent = "Scan";
      refreshBtn.classList.remove("animate-pulse-soft");
    }
  }
}

// ─── Incoming Receive Request Prompts ────────────────────────────────

function openIncomingTransferPrompt(senderName: string, senderIp: string, fileCount: number) {
  incomingSenderIp = senderIp;
  
  const acceptModal = document.getElementById("accept-modal");
  const overlay = document.getElementById("modal-overlay");
  
  const senderNameEl = document.getElementById("accept-sender-name");
  const fileCountEl = document.getElementById("accept-file-count");
  
  if (senderNameEl) senderNameEl.textContent = senderName;
  if (fileCountEl) fileCountEl.textContent = `${fileCount} file${fileCount !== 1 ? 's' : ''}`;
  
  overlay?.classList.remove("opacity-0", "pointer-events-none");
  overlay?.classList.add("opacity-100", "pointer-events-auto");
  
  acceptModal?.classList.remove("hidden", "opacity-0", "scale-95");
  acceptModal?.classList.add("block", "opacity-100", "scale-100");
}

function closeIncomingTransferPrompt() {
  const overlay = document.getElementById("modal-overlay");
  const acceptModal = document.getElementById("accept-modal");
  
  overlay?.classList.remove("opacity-100", "pointer-events-auto");
  overlay?.classList.add("opacity-0", "pointer-events-none");
  
  acceptModal?.classList.remove("opacity-100", "scale-100");
  acceptModal?.classList.add("opacity-0", "scale-95");
  
  setTimeout(() => {
    acceptModal?.classList.add("hidden");
    acceptModal?.classList.remove("block");
  }, 200);
}

async function respondIncomingTransfer(accept: boolean) {
  closeIncomingTransferPrompt();
  
  try {
    await invoke("respond_to_receive_request", { senderIp: incomingSenderIp, accept });
    if (accept) {
      showToast("Incoming transfer accepted! Check Live Activity log.", "success");
    } else {
      showToast("Incoming transfer declined.", "info");
    }
  } catch (e) {
    console.error("Respond error:", e);
  }
}

// ─── Transfer Logs / Live Activity ────────────────────────────────────

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
      // Show top 25 records, newest first
      const sortedRecords = [...records].reverse().slice(0, 25);
      logList.innerHTML = sortedRecords.map(item => {
        const sizeMb = (item.fileSize / 1024 / 1024).toFixed(2);
        
        let statusText = "Completed";
        let statusClass = "text-success bg-success/5 border border-success";
        
        if (item.status === "failed") {
          statusText = "Failed";
          statusClass = "text-sale bg-sale/5 border border-sale";
        } else if (item.status === "inProgress") {
          const progressPct = ((item.bytesSent / item.fileSize) * 100).toFixed(0);
          statusText = `Sharing ${progressPct}%`;
          statusClass = "text-info bg-info/5 border border-info animate-pulse-soft";
        }

        const directionLabel = item.isDownload ? "PULL" : "PUSH";
        const directionClass = item.isDownload ? "text-success" : "text-info";

        return `
          <li class="flex flex-col py-3 border-b border-hairline select-none">
            <div class="flex items-center justify-between gap-3">
              <span class="text-xs font-bold uppercase tracking-wider text-ink truncate max-w-[200px]" title="${escapeHtml(item.fileName)}">${escapeHtml(item.fileName)}</span>
              <span class="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 ${statusClass}">${escapeHtml(statusText)}</span>
            </div>
            <div class="flex items-center justify-between text-[10px] font-semibold text-mute uppercase mt-1">
              <span>Client: ${escapeHtml(item.remoteAddr)} <span class="ml-1 font-bold ${directionClass}">[${directionLabel}]</span></span>
              <span>${sizeMb} MB</span>
            </div>
          </li>
        `;
      }).join('');
    }
  } catch (err) {
    console.error("Failed to fetch transfer log:", err);
  }
}

// ─── Event Handlers & Initialisation ─────────────────────────────────

window.addEventListener("DOMContentLoaded", () => {
  // Wire up theme toggle
  initTheme();
  
  // Wire up file and folder pickers
  document.getElementById("btn-add-files")?.addEventListener("click", async (e) => {
    e.stopPropagation(); // Prevent dropzone click
    try {
      const selected = await open({
        multiple: true,
        title: "Select files to share"
      });
      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        const stringPaths = paths.map((p: any) => typeof p === "string" ? p : p.path);
        if (stringPaths.length > 0) {
          showFileLoading(true);
          await invoke("add_files", { paths: stringPaths });
          showToast("Items indexed for sharing", "success");
          loadFiles();
        }
      }
    } catch (err: any) {
      console.error("Browse files error:", err);
      showToast("Files selection failed", "error");
    } finally {
      showFileLoading(false);
    }
  });

  document.getElementById("btn-add-folder")?.addEventListener("click", async (e) => {
    e.stopPropagation(); // Prevent dropzone click
    try {
      const selected = await open({
        directory: true,
        title: "Select a folder to share"
      });
      if (selected) {
        const path = typeof selected === "string" ? selected : (selected as any).path;
        if (path) {
          showFileLoading(true);
          await invoke("add_folder", { path });
          showToast("Directory indexed for sharing", "success");
          loadFiles();
        }
      }
    } catch (err: any) {
      console.error("Browse folder error:", err);
      showToast("Directory selection failed", "error");
    } finally {
      showFileLoading(false);
    }
  });

  // Wire search bar input for real-time local search
  document.getElementById("search-bar")?.addEventListener("input", (e) => {
    const input = e.target as HTMLInputElement;
    searchQuery = input.value;
    renderFiles();
  });

  // Clicking anywhere on the drop-zone (except on the buttons themselves) triggers browse
  document.getElementById("drop-zone")?.addEventListener("click", () => {
    document.getElementById("btn-add-files")?.click();
  });

  updateServerStatus();
  loadFiles();
  refreshTransferLog();
  
  // Set intervals for live activity polling
  setInterval(() => {
    if (serverRunning) {
      updateServerStatus();
      refreshTransferLog();
    }
  }, 2000);

  // Large start buttons
  document.getElementById("btn-start-server-large")?.addEventListener("click", async () => {
    try {
      if (serverRunning) {
        await invoke("stop_server");
        showToast("Sharing Portal deactivated", "info");
      } else {
        await invoke("start_server");
        showToast("Sharing Portal activated!", "success");
      }
      updateServerStatus();
    } catch (e) {
      console.error("Toggle server error:", e);
      showToast("Failed to toggle portal state", "error");
    }
  });

  document.getElementById("btn-start-server-large-aux")?.addEventListener("click", () => {
    document.getElementById("btn-start-server-large")?.click();
  });
  
  // Toggle server switch knob
  document.getElementById("btn-toggle-server")?.addEventListener("click", () => {
    document.getElementById("btn-start-server-large")?.click();
  });

  // Cycle active IP address when clicking access-url or the cycle button
  const cycleIpHandler = () => {
    if (activeIpList.length > 1) {
      activeIpIndex = (activeIpIndex + 1) % activeIpList.length;
      updateServerStatus();
      showToast(`Switched portal adapter interface to ${activeIpList[activeIpIndex]}`, "info");
      
      const urlEl = document.getElementById("access-url");
      if (urlEl) {
        urlEl.classList.add("text-info");
        setTimeout(() => urlEl.classList.remove("text-info"), 800);
      }
    }
  };

  document.getElementById("access-url")?.addEventListener("click", cycleIpHandler);
  document.getElementById("btn-cycle-ip")?.addEventListener("click", (e) => {
    e.stopPropagation(); // Avoid double cycle
    cycleIpHandler();
  });

  // Copy Access URL with click feedback animation
  document.getElementById("btn-copy-url")?.addEventListener("click", async () => {
    const accessUrl = document.getElementById("access-url")?.textContent;
    if (accessUrl) {
      try {
        await navigator.clipboard.writeText(accessUrl);
        showToast("Access URL copied", "success");
        // Show success animation
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

  // Settings Modal wiring
  document.getElementById("btn-settings")?.addEventListener("click", openSettings);
  document.getElementById("btn-close-settings")?.addEventListener("click", closeSettings);
  document.getElementById("btn-save-settings")?.addEventListener("click", saveSettings);
  
  // Password Pin Toggle switch
  document.getElementById("setting-password-toggle")?.addEventListener("click", () => {
    requirePin = !requirePin;
    updatePasswordToggleUI();
  });

  // Clear All files (Confirmation trigger)
  document.getElementById("btn-clear-files")?.addEventListener("click", openClearConfirm);
  document.getElementById("btn-cancel-clear")?.addEventListener("click", fnCloseClearConfirm);
  document.getElementById("btn-confirm-clear")?.addEventListener("click", async () => {
    try {
      await invoke("clear_files");
      showToast("Index cleared successfully", "success");
      loadFiles();
    } catch (err) {
      console.error("Clear files error:", err);
      showToast("Failed to clear shared index", "error");
    } finally {
      fnCloseClearConfirm();
    }
  });

  // Wire network receive mode discovery dialog
  document.getElementById("btn-nav-receive")?.addEventListener("click", openDiscovery);
  document.getElementById("btn-header-receive")?.addEventListener("click", openDiscovery);
  document.getElementById("btn-close-discovery")?.addEventListener("click", closeDiscovery);
  document.getElementById("btn-refresh-discovery")?.addEventListener("click", scanDevices);

  // Wire incoming request consent options
  document.getElementById("btn-accept-transfer")?.addEventListener("click", () => respondIncomingTransfer(true));
  document.getElementById("btn-decline-transfer")?.addEventListener("click", () => respondIncomingTransfer(false));

  // Overlay background click closes open modal
  document.getElementById("modal-overlay")?.addEventListener("click", (e) => {
    if (e.target === document.getElementById("modal-overlay")) {
      const modal = document.getElementById("settings-modal");
      if (modal && !modal.classList.contains("hidden")) {
        closeSettings();
      }
      const confirmModal = document.getElementById("confirm-modal");
      if (confirmModal && !confirmModal.classList.contains("hidden")) {
        fnCloseClearConfirm();
      }
      const discoveryModal = document.getElementById("discovery-modal");
      if (discoveryModal && !discoveryModal.classList.contains("hidden")) {
        closeDiscovery();
      }
    }
  });

  // Escape closes active overlay
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const modal = document.getElementById("settings-modal");
      if (modal && !modal.classList.contains("hidden")) {
        closeSettings();
      }
      const confirmModal = document.getElementById("confirm-modal");
      if (confirmModal && !confirmModal.classList.contains("hidden")) {
        fnCloseClearConfirm();
      }
      const discoveryModal = document.getElementById("discovery-modal");
      if (discoveryModal && !discoveryModal.classList.contains("hidden")) {
        closeDiscovery();
      }
    }
  });

  // ─── Native Webview Drag-and-Drop ───────────────────────────────────
  try {
    const webview = getCurrentWebview();
    webview.onDragDropEvent((event) => {
      const dropZone = document.getElementById("drop-zone");
      if (event.payload.type === "enter" || event.payload.type === "over") {
        dropZone?.classList.add("bg-soft-cloud", "border-ink");
      } else if (event.payload.type === "drop") {
        dropZone?.classList.remove("bg-soft-cloud", "border-ink");
        const paths = event.payload.paths;
        if (paths && paths.length > 0) {
          showFileLoading(true);
          invoke("add_files", { paths })
            .then(() => {
              showToast("Dropped items successfully indexed!", "success");
              loadFiles();
            })
            .catch(err => {
              console.error("Drop import error:", err);
              showToast("Failed to index dropped files", "error");
            })
            .finally(() => {
              showFileLoading(false);
            });
        }
      } else if (event.payload.type === "leave") {
        dropZone?.classList.remove("bg-soft-cloud", "border-ink");
      }
    });
  } catch (e) {
    console.error("Failed to init native webview drag & drop:", e);
  }
});

// Setup Tauri event listeners for instant updates
listen("server-started", () => updateServerStatus());
listen("server-stopped", () => updateServerStatus());
listen("files-changed", () => loadFiles());
listen("transfer-progress", () => refreshTransferLog());
listen("transfer-complete", (event: any) => {
  const payload = event.payload;
  showToast(`Direct transfer of ${payload.fileName || "file"} completed!`, "success");
  refreshTransferLog();
});
listen("incoming-transfer-request", (event: any) => {
  const payload = event.payload;
  openIncomingTransferPrompt(payload.senderName, payload.senderIp, payload.files.length);
});
