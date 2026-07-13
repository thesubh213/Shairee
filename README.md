# Shairee - Local File Sharing

Shairee is a lightweight, high-performance local file transfer application inspired by Mi Share, AirDroid, and Nearby Share. It is designed to saturate local Wi-Fi bandwidth while remaining completely offline, secure, and lightweight.

It runs natively on **Windows** as a desktop app and natively on **Android** as a mobile app, enabling seamless high-speed transfers between Android-to-Android and Android-to-PC in any direction, as well as sharing with any device that has a modern web browser.

---

## Core Features

### Cross-Platform Experience (Tauri v2)
* **Native Desktop & Mobile Apps:** Runs natively on Windows and Android using Tauri v2.
* **Minimalist UI:** Clean, responsive user interface with light and dark mode support.
* **Easy File Selection:** Drag-and-drop support, native file/folder selection dialogs on Windows, and Android native file picker integration.
* **System Tray integration:** Allows Windows desktop app to run in the background.

### Direct LAN Transfer & Peer Discovery (Rust)
* **UDP Beacon Discovery (Port 8389):** Senders broadcast `SHAIREE_DISCOVER` packets on the local subnet to dynamically find active receivers without needing to manually input IP addresses.
* **Consent-Based Transfers:** Sending files to a receiver triggers an "Incoming Transfer" prompt. Senders block until the receiver explicitly accepts or declines.
* **Low-Memory Pull Stream:** Files are fetched from sender HTTP endpoints in chunks and saved directly into the target device.

### Android Integration & Scoped Storage Support
* **MediaStore Public Downloads:** Downloads on Android are saved to the app's cache first and then copied to the public `Downloads` folder using Android's native `MediaStore` API. This fully supports Android Scoped Storage (up to target SDK 36) without file access permission prompts.
* **Cleartext HTTP Support:** Explicitly permits cleartext traffic in release builds, enabling WebView components to communicate with local plaintext HTTP sharing portals on Android 9+.

### Smart Networking & Adapter Prioritization
* **Adapter Prioritization:** Auto-detects and prioritizes high-speed physical network interfaces (Mobile Hotspots, USB tethering, and Wi-Fi: `ap`, `swlan`, `softap`, `rndis`, `bridge`, `wlan`) over cellular (`rmnet`) and virtual/dummy interfaces (WSL, Docker, VirtualBox).
* **Dynamic IP Cycling:** In multi-adapter systems, clicking the displayed Access URL cycles through available IP addresses and regenerates the connection QR code.
* **PIN Protection:** Configurable access PIN code to secure shared files.
* **WebSocket Control Channel:** Mobile pages connect to the desktop app via WebSockets to automatically refresh the files list when items are added or removed, handling disconnections gracefully.

### High-Throughput Sharing (Rust + Actix Web)
* **Zero-Copy Streaming:** File downloads leverage high-throughput streaming with HTTP Range header support for resumable downloads.
* **On-the-Fly ZIP Compression:**
  * **Folder Sharing:** Compresses directories on-the-fly into a standard `.zip` format as it streams, removing prep/waiting times.
  * **Download All:** Bundles all shared files and folders into a single `shairee_all.zip` archive on the fly.
* **Offline Operation:** Operates entirely within your Local Area Network (LAN). No cloud accounts or internet access required.

---

## Technical Stack

* **Desktop/Mobile Shell:** [Tauri v2](https://v2.tauri.app/) (Rust core + system integration)
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
4. **Android SDK & JDK 21** (Required to compile Android targets)

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

### 3. Build Production Windows Bundle
To compile and package the application into an optimized, standalone Windows `.exe` installer (saved under `src-tauri/target/release/bundle/nsis/`):
```bash
npm run build
npm run tauri build
```

### 4. Build Android APK Target
1. **Configure Environment Variables:**
   Add these variables to your system environment (remove any double quotes from paths to prevent Gradle execution issues):
   * `ANDROID_HOME` = `C:\Users\<Your-Username>\AppData\Local\Android\Sdk`
   * `NDK_HOME` = `C:\Users\<Your-Username>\AppData\Local\Android\Sdk\ndk\<NDK-Version>`
2. **Compile the APK:**
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

---

## Code Utilities

### Cleaning Comments and Logs
The project includes a robust in-place comment and log cleaner script (`scripts/clean_code.cjs`) that parses JavaScript/TypeScript, Rust, HTML, CSS, and Kotlin source files. It removes single-line/block comments and logging statements (`console.log`, `println!`, etc.) without breaking URLs or string content.

To run the cleaner utility:
```bash
node scripts/clean_code.cjs
```

---

## Security & Privacy
* **100% Local:** Files are streamed directly between your devices over your local network adapters. No data ever touches the cloud, third-party servers, or the internet.
* **Path Traversal Prevention:** Strict path sanitization on all Actix HTTP endpoints ensures that mobile clients can only access files that have been explicitly added to the share list, protecting your host system directories.

---

## License
This project is open-source and available under the [MIT License](LICENSE).
