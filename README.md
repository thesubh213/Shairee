# Shairee - Local File Sharing

Shairee is a lightweight, high-performance local file transfer desktop application inspired by Mi Share WebShare, AirDroid, and Nearby Share. It is designed to saturate local Wi-Fi bandwidth while remaining completely offline, secure, and lightweight. The desktop app runs natively on Windows and shares files with Android (or any device with a modern web browser).

---

## Core Features

### Native Desktop Experience (Tauri v2)
* Minimalist, high-contrast user interface with light and dark mode support.
* Windows dialog integration for selecting multiple files or entire directories.
* Drag-and-drop zone to quickly import files or folders.
* System tray integration for background operation.

### Direct LAN Transfer & Peer Discovery (Rust)
* **UDP Beacon Discovery (Port 8389):** Senders broadcast `SHAIREE_DISCOVER` packets on the local subnet to dynamically find active receivers without needing to manually input IP addresses.
* **Consent-Based Transfers:** Sending files to a receiver triggers an "Incoming Transfer" prompt. Senders block until the receiver explicitly accepts or declines.
* **Low-Memory Pull Stream:** Files are fetched from sender HTTP endpoints in chunks and saved directly inside the system Downloads directory with live progress indicators.

### High-Throughput Sharing (Rust + Actix Web)
* **Zero-Copy Streaming:** File downloads leverage high-throughput streaming with HTTP Range header support for resumable downloads.
* **On-the-Fly ZIP Compression:**
  * **Folder Sharing:** Compresses directories on-the-fly into a standard `.zip` format as it streams, removing prep/waiting times.
  * **Download All:** Bundles all shared files and folders into a single `shairee_all.zip` archive on the fly.
* **Offline Operation:** Operates entirely within your Local Area Network (LAN). No cloud accounts or internet access required.

### Smart Networking
* **Windows Hotspot Integration:** Automatically detects the default Windows Mobile Hotspot adapter (`192.168.137.x`) and binds to the gateway IP `192.168.137.1` when active.
* **Dynamic IP Cycling:** In multi-adapter systems, clicking the displayed Access URL cycles through available IP addresses and regenerates the connection QR code.
* **PIN Protection:** Configurable access PIN code to secure shared files.
* **WebSocket Control Channel:** Mobile pages connect to the desktop app via WebSockets to automatically refresh the files list when items are added or removed, handling disconnections gracefully.

---

## Technical Stack

* **Desktop Shell:** [Tauri v2](https://v2.tauri.app/) (Rust core + system integration)
* **HTTP & WebSocket Server:** [Actix Web 4](https://actix.rs/) & [Tokio](https://tokio.rs/) async runtime
* **Frontend:** [TypeScript](https://www.typescriptlang.org/), [TailwindCSS 3](https://tailwindcss.com/), and [Vite](https://vite.dev/)
* **ZIP Streaming:** [zip-rs](https://github.com/zip-rs/zip-rs) & [walkdir](https://github.com/BurntSushi/walkdir)
* **QR Generation:** [qrcode-rust](https://github.com/habono/qrcode-rust)

---

## Setup & Installation

### Prerequisites
Make sure your development machine has the following:

1. **Node.js & npm** (Node 18+ recommended)
2. **Rust Toolchain & Cargo** (Stable rustup installation)
3. **Tauri Windows Build Tools** (Visual Studio Build Tools with C++ desktop development package)

### 1. Clone & Install Dependencies
Install the frontend dependencies from the root directory:
```bash
npm install
```

### 2. Launch Development Mode
Run the hot-reloading development server. This compiles and launches the native Windows window and starts the frontend dev server:
```bash
npm run tauri dev
```
*(If Cargo is not globally recognized in your terminal, run: `& "$env:USERPROFILE\.cargo\bin\cargo" tauri dev`)*

### 3. Build Production Windows Bundle
To compile and package the application into an optimized, standalone Windows `.exe` installer (saved under `src-tauri/target/release/bundle/nsis/`):
```bash
npm run build
npx tauri build
```

### 4. Build Android APK Target
Compiling for Android requires the Android SDK, NDK, and Java build tools.

1. **Java SDK Setup (JDK 21):**
   Ensure Java 21 is installed and the `JAVA_HOME` environment variable is configured. The Gradle wrapper requires JDK 21 to avoid compilation version mismatches.
2. **Android SDK & NDK Setup:**
   Open the SDK Manager in Android Studio and ensure the following are installed:
   * Android SDK Platform-Tools
   * Android SDK Build-Tools
   * NDK (Side-by-side)
3. **Configure Environment Variables:**
   Add these variables to your system environment (remove any double quotes from paths to prevent Gradle execution issues):
   * `ANDROID_HOME` = `C:\Users\<Your-Username>\AppData\Local\Android\Sdk`
   * `NDK_HOME` = `C:\Users\<Your-Username>\AppData\Local\Android\Sdk\ndk\<NDK-Version>`
4. **Compile the APK:**
   Run the following commands:
   ```bash
   # Add Android target architectures
   rustup target add aarch64-linux-android armv7-linux-androideabi

   # Initialize Android platform in Tauri project (run once)
   npm run tauri android init --ci

   # Build the release APK
   npm run tauri android build --apk
   ```
   The generated APK will be saved at:
   `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk`

> **Note:** The release APK is signed automatically in CI. For local builds, place your keystore at `src-tauri/gen/android/app/release.keystore` (this path is git-ignored) and configure the `SHAIREE_KEYSTORE_PASSWORD`, `SHAIREE_KEY_ALIAS`, and `SHAIREE_KEY_PASSWORD` environment variables before building. If no keystore is present, the release build falls back to the debug signing key.

### Android Release Signing (CI Secrets)
Release APKs published from the `Release Build` workflow are signed with a dedicated keystore that is not stored in the repository. Configure these repository secrets before tagging a release:

| Secret | Description |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | The `.keystore` file, base64-encoded. The workflow decodes it at build time. |
| `SHAIREE_KEYSTORE_PASSWORD` | Keystore (store) password. |
| `SHAIREE_KEY_ALIAS` | Alias of the signing key inside the keystore. |
| `SHAIREE_KEY_PASSWORD` | Password for the signing key. |

If any secret is missing, the workflow emits a warning and the APK is signed with the debug key.

### Android Studio Development
To debug the application on a real device or emulator using Android Studio, you must boot the Tauri development daemon in a background terminal before running the app in Android Studio:
1. In your project root terminal, run:
   ```powershell
   # Cleans environment path and starts the dev server:
   $env:PATH = $env:PATH.Replace('"', ''); $env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot"; npm run tauri android dev
   ```
2. Wait for the dev server to start and launch Android Studio.
3. In Android Studio, select your device/emulator and click **Run**. This connects to the running Tauri daemon to sync settings, build the Rust binary, and deploy the application.

---

## How It Works

### Step 1: Start the Network Portal
Launch Shairee and click the **Start Sharing** button. The server will start and bind to your LAN IP.

### Step 2: Connect Your Android Device
* **Hotspot Sharing (Recommended for Max Speed):**
  1. Turn on **Mobile Hotspot** on your Windows laptop.
  2. Connect your Android phone to the laptop's hotspot Wi-Fi.
  3. The app will automatically bind to the hotspot gateway `http://192.168.137.1:8384`. If it doesn't, click the displayed Access URL in the desktop window to cycle to the `192.168.137.1` interface.
  4. Scan the generated QR code with your phone or open the URL in Chrome.
* **Standard Wi-Fi LAN Sharing:**
  1. Ensure both your PC and phone are connected to the same home/office Wi-Fi router.
  2. The app will bind to your Wi-Fi LAN IP (e.g. `http://192.168.1.15:8384`).
  3. Scan the QR code or type the URL into your phone's browser.

### Step 3: Share and Download Files
* **Add Files:** Drag & drop files onto the drop card on your PC, or click **Add Files** / **Add Folder** to browse. The files will instantly show up on the phone's web UI.
* **Download:** Tap **Download** next to any file on your phone.
  * Directories will automatically download as standard `.zip` files.
  * Tap **Download All (ZIP)** at the top of the mobile screen to bundle all shared items into a single download.
* **Activity Log:** View real-time completed transfers inside the **Live Activity** log on your PC.

### Step 4: Configure Security PIN & Port
Click the **Gear** icon in the app header to open the Settings panel:
* Toggle **Require Password** and type in an access PIN (e.g., `1234`). Mobile clients will be prompted to enter this PIN before browsing or downloading files.
* Input a custom port (e.g., `9090`) and click **Save & Restart** to automatically reboot the sharing server on the new configuration.

---

## Security & Privacy
* **100% Local:** Files are streamed directly from your laptop to your phone over your local network adapters. No data ever touches the cloud, third-party servers, or the internet.
* **Path Traversal Prevention:** Strict path sanitization on all Actix HTTP endpoints ensures that mobile clients can only access files that have been explicitly added to the share list, protecting your host system directories.

---

## License
This project is open-source and available under the [MIT License](LICENSE).
