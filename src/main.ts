import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";

// State variables
let serverPort = 8384;
let requirePin = false;
let configPin = "";
let serverRunning = false;
let activeIpList: string[] = [];
let activeIpIndex = 0;

// ─── Toast System ────────────────────────────────────────────────────

function showToast(message: string, type: "success" | "error" | "info" = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  // Basic classes
  toast.className = "px-4 py-3 rounded-xl border text-sm font-medium text-white shadow-2xl transition-all duration-300 transform translate-y-4 opacity-0 pointer-events-auto backdrop-blur-md flex items-center gap-2 max-w-xs";
  
  let colorClasses = "";
  let icon = "🔔";
  if (type === "success") {
    colorClasses = "bg-emerald-500/10 border-emerald-500/20 text-emerald-400";
    icon = "✓";
  } else if (type === "error") {
    colorClasses = "bg-red-500/10 border-red-500/20 text-red-400";
    icon = "✗";
  } else {
    colorClasses = "bg-blue-500/10 border-blue-500/20 text-blue-400";
    icon = "ℹ";
  }
  
  toast.className += ` ${colorClasses}`;
  toast.innerHTML = `<span class="text-base font-bold">${icon}</span> <span class="flex-1">${message}</span>`;
  
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
    const glow = document.getElementById("server-glow");
    const toggleKnob = document.getElementById("server-toggle-knob");
    
    // Toggle cycle IP button based on IP list length
    const cycleBtn = document.getElementById("btn-cycle-ip");
    if (serverRunning && activeIpList.length > 1) {
      cycleBtn?.classList.remove("hidden");
    } else {
      cycleBtn?.classList.add("hidden");
    }

    if (serverRunning) {
      indicator?.classList.replace("bg-white/5", "bg-green-500/10");
      indicator?.classList.replace("border-white/10", "border-green-500/20");
      if (text) {
        text.textContent = "Running";
        text.classList.replace("text-gray-300", "text-green-400");
      }
      ping?.classList.replace("bg-red-400", "bg-green-400");
      dot?.classList.replace("bg-red-500", "bg-green-500");
      
      offlineState?.classList.add("hidden");
      onlineState?.classList.remove("hidden");
      onlineState?.classList.add("flex");
      
      glow?.classList.replace("opacity-0", "opacity-100");
      toggleKnob?.parentElement?.classList.replace("bg-gray-600", "bg-blue-600");
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
      
      // Fetch QR Code specifically for the displayed IP
      try {
        const qrBase64 = await invoke("get_qr_code", { url: displayUrl });
        const qrImg = document.getElementById("qr-code-img") as HTMLImageElement;
        if (qrImg) qrImg.src = qrBase64 as string;
      } catch (e) {
        console.error("No QR available yet:", e);
      }
    } else {
      indicator?.classList.replace("bg-green-500/10", "bg-white/5");
      indicator?.classList.replace("border-green-500/20", "border-white/10");
      if (text) {
        text.textContent = "Stopped";
        text.classList.replace("text-green-400", "text-gray-300");
      }
      ping?.classList.replace("bg-green-400", "bg-red-400");
      dot?.classList.replace("bg-green-500", "bg-red-500");
      
      offlineState?.classList.remove("hidden");
      onlineState?.classList.add("hidden");
      onlineState?.classList.remove("flex");
      
      glow?.classList.replace("opacity-100", "opacity-0");
      toggleKnob?.parentElement?.classList.replace("bg-blue-600", "bg-gray-600");
      toggleKnob?.classList.replace("translate-x-6", "translate-x-1");
    }
  } catch (error) {
    console.error("Failed to fetch server status:", error);
  }
}

// ─── File Management ──────────────────────────────────────────────────

async function loadFiles() {
  try {
    const files: any[] = await invoke("get_shared_files");
    const fileList = document.getElementById("file-list");
    const emptyState = document.getElementById("file-list-empty");
    const fileCount = document.getElementById("file-count");
    const clearBtn = document.getElementById("btn-clear-files");
    
    if (fileCount) fileCount.textContent = `${files.length} file${files.length !== 1 ? "s" : ""}`;
    
    if (files.length === 0) {
      emptyState?.classList.remove("hidden");
      emptyState?.classList.add("flex");
      fileList?.classList.add("hidden");
      clearBtn?.classList.add("hidden");
      return;
    }
    
    emptyState?.classList.add("hidden");
    emptyState?.classList.remove("flex");
    fileList?.classList.remove("hidden");
    clearBtn?.classList.remove("hidden");
    
    if (fileList) {
      fileList.innerHTML = files.map(f => {
        const isDir = f.isDirectory;
        const sizeMb = (f.size / 1024 / 1024).toFixed(2);
        let emoji = "📄";
        if (isDir) emoji = "📁";
        else {
          const ext = f.name.split(".").pop()?.toLowerCase() || "";
          if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext)) emoji = "📷";
          else if (["mp3", "wav", "flac", "ogg", "m4a"].includes(ext)) emoji = "🎵";
          else if (["mp4", "mkv", "avi", "mov", "webm"].includes(ext)) emoji = "🎬";
          else if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) emoji = "📦";
        }

        return `
          <li id="file-${f.id}" class="flex items-center justify-between p-3 border rounded-lg bg-white/5 border-white/5 hover:bg-white/10 transition-colors">
            <div class="flex items-center gap-3 overflow-hidden">
              <span class="text-2xl">${emoji}</span>
              <div class="flex flex-col overflow-hidden">
                <span class="text-sm font-medium text-white truncate max-w-[240px]" title="${f.name}">${f.name}</span>
                <span class="text-xs text-gray-400">${sizeMb} MB ${isDir ? "• Folder" : ""}</span>
              </div>
            </div>
            <button class="btn-delete-file p-1 text-gray-500 hover:text-red-400 rounded transition-colors" data-id="${f.id}">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </li>
        `;
      }).join('');

      // Wire delete events
      document.querySelectorAll(".btn-delete-file").forEach(btn => {
        btn.addEventListener("click", async (e) => {
          const target = e.currentTarget as HTMLButtonElement;
          const id = target.getAttribute("data-id");
          if (id) {
            try {
              await invoke("remove_file", { id });
              showToast("File removed from sharing list", "info");
              loadFiles();
            } catch (err) {
              console.error("Failed to delete file:", err);
              showToast("Failed to remove file", "error");
            }
          }
        });
      });
    }
  } catch (error) {
    console.error("Failed to load files:", error);
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
    passwordToggle?.classList.replace("bg-gray-600", "bg-blue-600");
    passwordToggleKnob?.classList.replace("translate-x-1", "translate-x-6");
    passwordInputContainer?.classList.remove("hidden");
  } else {
    passwordToggle?.classList.replace("bg-blue-600", "bg-gray-600");
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
  }, 300);
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
    
    showToast("Settings saved successfully!", "success");
    closeSettings();
    
    // Automatically restart server if running on a different port
    if (wasRunning && nextPort !== oldPort) {
      showToast("Restarting server on new port...", "info");
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
    showToast("Failed to save configuration", "error");
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

function closeClearConfirm() {
  const overlay = document.getElementById("modal-overlay");
  const confirmModal = document.getElementById("confirm-modal");
  
  overlay?.classList.remove("opacity-100", "pointer-events-auto");
  overlay?.classList.add("opacity-0", "pointer-events-none");
  
  confirmModal?.classList.remove("opacity-100", "scale-100");
  confirmModal?.classList.add("opacity-0", "scale-95");
  
  setTimeout(() => {
    confirmModal?.classList.add("hidden");
    confirmModal?.classList.remove("block");
  }, 300);
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
        let statusClass = "text-green-400 bg-green-500/10";
        if (item.status === "failed") {
          statusText = "Failed";
          statusClass = "text-red-400 bg-red-500/10";
        } else if (item.status === "inProgress") {
          const progressPct = ((item.bytesSent / item.fileSize) * 100).toFixed(0);
          statusText = `Sharing ${progressPct}%`;
          statusClass = "text-cyan-400 bg-cyan-500/10 animate-pulse";
        }

        return `
          <li class="flex flex-col p-2.5 rounded-lg bg-white/5 border border-white/5 transition-all">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-medium text-white truncate max-w-[220px]" title="${item.fileName}">${item.fileName}</span>
              <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded ${statusClass}">${statusText}</span>
            </div>
            <div class="flex items-center justify-between text-[10px] text-gray-400 mt-1">
              <span>Client: ${item.remoteAddr}</span>
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
  // Wire up file and folder pickers immediately to isolate from startup errors
  document.getElementById("btn-add-files")?.addEventListener("click", async (e) => {
    e.stopPropagation(); // Prevent bubbling up to drop-zone click trigger!
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
          showToast("Added files successfully!", "success");
          loadFiles();
        }
      }
    } catch (err: any) {
      console.error("Browse files error:", err);
      showToast("Failed to import files", "error");
    } finally {
      showFileLoading(false);
    }
  });

  document.getElementById("btn-add-folder")?.addEventListener("click", async (e) => {
    e.stopPropagation(); // Prevent bubbling up to drop-zone click trigger!
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
          showToast("Imported folder successfully!", "success");
          loadFiles();
        }
      }
    } catch (err: any) {
      console.error("Browse folder error:", err);
      showToast("Failed to import folder", "error");
    } finally {
      showFileLoading(false);
    }
  });

  // Clicking anywhere on the drop-zone (except on the buttons themselves) will trigger browse files!
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

  // Large start button on offline panel
  document.getElementById("btn-start-server-large")?.addEventListener("click", async () => {
    try {
      await invoke("start_server");
      showToast("Server started!", "success");
      updateServerStatus();
    } catch (e) {
      console.error("Start server error:", e);
      showToast("Failed to start server", "error");
    }
  });
  
  // Toggle server switch
  document.getElementById("btn-toggle-server")?.addEventListener("click", async () => {
    try {
      const status: any = await invoke("get_server_status");
      if (status.serverRunning) {
        await invoke("stop_server");
        showToast("Server stopped", "info");
      } else {
        await invoke("start_server");
        showToast("Server started!", "success");
      }
      updateServerStatus();
    } catch (e) {
      console.error("Toggle server error:", e);
      showToast("Failed to toggle server state", "error");
    }
  });

  // Cycle active IP address when clicking access-url or the cycle button
  const cycleIpHandler = () => {
    if (activeIpList.length > 1) {
      activeIpIndex = (activeIpIndex + 1) % activeIpList.length;
      updateServerStatus();
      showToast(`Switched network adapter to ${activeIpList[activeIpIndex]}`, "info");
      
      const urlEl = document.getElementById("access-url");
      if (urlEl) {
        urlEl.classList.add("text-green-400");
        setTimeout(() => urlEl.classList.remove("text-green-400"), 800);
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
        showToast("Access URL copied to clipboard!", "success");
        // Show success animation
        const btn = document.getElementById("btn-copy-url");
        const svgIcons = btn?.querySelectorAll("svg");
        if (svgIcons && svgIcons.length === 2) {
          svgIcons[0].classList.add("hidden"); 
          svgIcons[1].classList.remove("hidden"); 
          
          setTimeout(() => {
            svgIcons[0].classList.remove("hidden");
            svgIcons[1].classList.add("hidden");
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
  document.getElementById("modal-overlay")?.addEventListener("click", () => {
    const modal = document.getElementById("settings-modal");
    if (modal && !modal.classList.contains("hidden")) {
      closeSettings();
    }
    const confirmModal = document.getElementById("confirm-modal");
    if (confirmModal && !confirmModal.classList.contains("hidden")) {
      closeClearConfirm();
    }
  });
  document.getElementById("btn-save-settings")?.addEventListener("click", saveSettings);
  
  // Password Pin Toggle switch
  document.getElementById("setting-password-toggle")?.addEventListener("click", () => {
    requirePin = !requirePin;
    updatePasswordToggleUI();
  });

  // Clear All files (Confirmation trigger)
  document.getElementById("btn-clear-files")?.addEventListener("click", openClearConfirm);
  document.getElementById("btn-cancel-clear")?.addEventListener("click", closeClearConfirm);
  document.getElementById("btn-confirm-clear")?.addEventListener("click", async () => {
    try {
      await invoke("clear_files");
      showToast("All shared files cleared successfully", "success");
      loadFiles();
    } catch (err) {
      console.error("Clear files error:", err);
      showToast("Failed to clear shared files", "error");
    } finally {
      closeClearConfirm();
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
        closeClearConfirm();
      }
    }
  });

  // ─── Native Webview Drag-and-Drop ───────────────────────────────────
  try {
    const webview = getCurrentWebview();
    webview.onDragDropEvent((event) => {
      const dropZone = document.getElementById("drop-zone");
      if (event.payload.type === "enter" || event.payload.type === "over") {
        dropZone?.classList.add("border-blue-500", "bg-white/[0.06]");
      } else if (event.payload.type === "drop") {
        dropZone?.classList.remove("border-blue-500", "bg-white/[0.06]");
        const paths = event.payload.paths;
        if (paths && paths.length > 0) {
          showFileLoading(true);
          invoke("add_files", { paths })
            .then(() => {
              showToast("Dropped files added successfully!", "success");
              loadFiles();
            })
            .catch(err => {
              console.error("Drop import error:", err);
              showToast("Failed to import dropped files", "error");
            })
            .finally(() => {
              showFileLoading(false);
            });
        }
      } else if (event.payload.type === "leave") {
        dropZone?.classList.remove("border-blue-500", "bg-white/[0.06]");
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
  showToast(`Successfully transferred ${payload.fileName || "file"}!`, "success");
  refreshTransferLog();
});
