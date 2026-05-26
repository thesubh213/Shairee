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
          urlEl.title = "Multiple IPs detected! Click to cycle adapters.";
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
              loadFiles();
            } catch (err) {
              console.error("Failed to delete file:", err);
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
  
  overlay?.classList.replace("opacity-100", "opacity-0");
  overlay?.classList.replace("pointer-events-auto", "pointer-events-none");
  
  modal?.classList.replace("opacity-100", "opacity-0");
  modal?.classList.replace("scale-100", "scale-95");
  setTimeout(() => {
    modal?.classList.replace("block", "hidden");
  }, 300);
}

async function saveSettings() {
  const portInput = document.getElementById("setting-port") as HTMLInputElement;
  const passwordInput = document.getElementById("setting-password") as HTMLInputElement;
  
  const nextPort = parseInt(portInput?.value) || 8384;
  const nextPassword = requirePin ? passwordInput?.value.trim() : "";
  
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
    
    closeSettings();
    
    // Automatically restart server if running on a different port
    if (wasRunning && nextPort !== oldPort) {
      await invoke("stop_server");
      await invoke("start_server");
    }
    
    updateServerStatus();
  } catch (e) {
    console.error("Failed to save settings:", e);
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
        return `
          <li class="flex flex-col p-2.5 rounded-lg bg-white/5 border border-white/5">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-medium text-white truncate max-w-[220px]" title="${item.fileName}">${item.fileName}</span>
              <span class="text-[10px] text-green-400 font-semibold px-1.5 py-0.5 rounded bg-green-500/10">Completed</span>
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
  document.getElementById("btn-add-files")?.addEventListener("click", async () => {
    try {
      const selected = await open({
        multiple: true,
        title: "Select files to share"
      });
      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        const stringPaths = paths.map((p: any) => typeof p === "string" ? p : p.path);
        if (stringPaths.length > 0) {
          await invoke("add_files", { paths: stringPaths });
          loadFiles();
        }
      }
    } catch (err: any) {
      console.error("Browse files error:", err);
      alert("Error opening file dialog: " + (err?.message || err || "Unknown error"));
    }
  });

  document.getElementById("btn-add-folder")?.addEventListener("click", async () => {
    try {
      const selected = await open({
        directory: true,
        title: "Select a folder to share"
      });
      if (selected) {
        const path = typeof selected === "string" ? selected : (selected as any).path;
        if (path) {
          await invoke("add_folder", { path });
          loadFiles();
        }
      }
    } catch (err: any) {
      console.error("Browse folder error:", err);
      alert("Error opening folder dialog: " + (err?.message || err || "Unknown error"));
    }
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
      updateServerStatus();
    } catch (e) {
      console.error("Start server error:", e);
    }
  });
  
  // Toggle server switch
  document.getElementById("btn-toggle-server")?.addEventListener("click", async () => {
    try {
      const status: any = await invoke("get_server_status");
      if (status.serverRunning) {
        await invoke("stop_server");
      } else {
        await invoke("start_server");
      }
      updateServerStatus();
    } catch (e) {
      console.error("Toggle server error:", e);
    }
  });

  // Cycle active IP address when clicking access-url
  document.getElementById("access-url")?.addEventListener("click", () => {
    if (activeIpList.length > 1) {
      activeIpIndex = (activeIpIndex + 1) % activeIpList.length;
      updateServerStatus();
      
      const urlEl = document.getElementById("access-url");
      if (urlEl) {
        urlEl.classList.add("text-green-400");
        setTimeout(() => urlEl.classList.remove("text-green-400"), 800);
      }
    }
  });

  // Copy Access URL with click feedback animation
  document.getElementById("btn-copy-url")?.addEventListener("click", async () => {
    const accessUrl = document.getElementById("access-url")?.textContent;
    if (accessUrl) {
      try {
        await navigator.clipboard.writeText(accessUrl);
        // Show success animation
        const btn = document.getElementById("btn-copy-url");
        const svgIcons = btn?.querySelectorAll("svg");
        if (svgIcons && svgIcons.length === 2) {
          svgIcons[0].classList.add("hidden"); // Copy icon
          svgIcons[1].classList.remove("hidden"); // Checkmark icon
          
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
  document.getElementById("modal-overlay")?.addEventListener("click", closeSettings);
  document.getElementById("btn-save-settings")?.addEventListener("click", saveSettings);
  
  // Password Pin Toggle switch
  document.getElementById("setting-password-toggle")?.addEventListener("click", () => {
    requirePin = !requirePin;
    updatePasswordToggleUI();
  });

  // File pickers moved to the top of DOMContentLoaded block

  // Clear All files
  document.getElementById("btn-clear-files")?.addEventListener("click", async () => {
    try {
      await invoke("clear_files");
      loadFiles();
    } catch (err) {
      console.error("Clear files error:", err);
    }
  });

  // Escape closes settings modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const modal = document.getElementById("settings-modal");
      if (modal && !modal.classList.contains("hidden")) {
        closeSettings();
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
          invoke("add_files", { paths })
            .then(() => loadFiles())
            .catch(err => console.error("Drop import error:", err));
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
