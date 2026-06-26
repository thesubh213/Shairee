# 📁 Shairee — Ultra-Fast Local File Sharing

**Shairee** is a premium, lightweight, and ultra-fast local file transfer desktop application inspired by Mi Share WebShare, AirDroid, and Nearby Share. It is designed to saturate modern local Wi-Fi bandwidth while remaining completely offline, secure, and lightweight, running natively on **Windows** and sharing files seamlessly to **Android** (or any device with a modern web browser).

---

## 🌟 Core Features

### 🖥️ Native Desktop Experience (Tauri v2)
*   **Premium Nike-Style Editorial UI**: Designed around a minimal, high-contrast grid system using flat hairline borders (`border-hairline`), clean typography (`Bebas Neue` campaign displays + `Inter` UI font), Soft Cloud backdrops, and strict pill/circle button geometry.
*   **Dynamic Light & Dark Modes**: Native theme toggler that swaps CSS properties instantly and remembers user preferences in browser `localStorage`.
*   **Hotspot-Zap Brand Mark**: Custom vector brand icon embedded directly in the window resources, favicon, and key UI loading/broadcasting modules.
*   **Dual Selectors**: Direct buttons for picking multiple files or sharing entire directories using native Windows dialogs.
*   **Native Drag & Drop**: Drag files or folders anywhere onto the drop zone to watch it glow and instantly import paths.

### ⚡ Direct LAN Transfer & Peer Discovery (Rust)
*   **UDP Beacon Scanner (Port 8389)**: Senders broadcast `SHAIREE_DISCOVER` packets on the local subnet to dynamically find active receivers without typing IP addresses.
*   **Consent-Based Push Protocol**: Pushing files to a receiver prompts a secure **Incoming Transfer** modal. Senders block on a oneshot channel until the receiver explicitly clicks **Accept** or **Decline**.
*   **Low-Memory Background Pull Stream**: Files are fetched from sender HTTP endpoints in chunks and saved directly inside the system `Downloads` directory, updating live progress indicators.

### ⚡ Ultra-Fast Local Sharing (Rust + Actix Web)
*   **Zero-Copy Streaming**: Regular file downloads leverage low-memory, high-throughput streaming with HTTP Range header support for resumable downloads.
*   **On-the-Fly ZIP Compression**: 
    *   **Folder Sharing**: Sharing a directory compresses its contents on-the-fly into a standard `.zip` format as it streams, eliminating wait times.
    *   **Download All**: Bundles all currently shared files and folders into a single unified `shairee_all.zip` archive on the fly.
*   **Zero Cloud Dependency**: Operates entirely within your Local Area Network (LAN). No internet connection or cloud accounts required.

### 📡 Smart Networking & Connectivity
*   **Self-Healing Hotspot Support**: Prioritizes the default Windows Mobile Hotspot adapter (`192.168.137.x`) automatically. If your hotspot is active, it binds directly to the phone-reachable gateway IP `192.168.137.1`!
*   **Dynamic IP cycling**: In multi-adapter systems, click on the displayed Access URL inside the app to cycle through all available IP addresses and dynamically regenerate the QR code on-the-fly.
*   **PIN Protection**: Enable **Require Password** in settings to secure your shared files with a custom access PIN code.
*   **Resilient WebSocket Connection**: The mobile page connects back to your PC via WebSockets to automatically refresh the files list when you add or remove files. If the connection drops, it reconnects silently in the background without annoying infinite page reloads.

---

## 🛠️ Technology Stack

*   **Desktop Shell**: [Tauri v2](https://v2.tauri.app/) (Rust core + system integration)
*   **HTTP & WebSocket Server**: [Actix Web 4](https://actix.rs/) & [Tokio](https://tokio.rs/) async runtime (spawned in an isolated thread)
*   **Frontend**: [TypeScript](https://www.typescriptlang.org/), [TailwindCSS 3](https://tailwindcss.com/), and [Vite](https://vite.dev/)
*   **ZIP Streaming**: [zip-rs](https://github.com/zip-rs/zip-rs) & [walkdir](https://github.com/BurntSushi/walkdir)
*   **QR Generation**: [qrcode-rust](https://github.com/habono/qrcode-rust)

---

## 🚀 Setup & Installation

### Prerequisites
Ensure your development machine has the following dependencies installed:

1.  **Node.js & npm** (Node 18+ recommended)
2.  **Rust Toolchain & Cargo** (Stable rustup installation)
3.  **Tauri Windows Build Tools** (Visual Studio Build Tools with C++ desktop development package)

### 1. Clone & Install Dependencies
First, open your terminal (PowerShell or Command Prompt) and install the frontend dependencies:
```bash
# Install package dependencies
npm install
```

### 2. Launch Development Mode
Run the hot-reloading development server. This compiles and launches the native Windows window while providing hot-reloading support for the frontend:
```bash
npm run tauri dev
```
*(If Cargo is not globally recognized in your terminal, run: `& "$env:USERPROFILE\.cargo\bin\cargo" tauri dev`)*

### 3. Build Production Windows Bundle
To compile and package the application into a highly optimized, single standalone Windows `.exe` installer (saved under `src-tauri/target/release/bundle/nsis/`):
```bash
npm run build
npx tauri build
```

### 4. Build Android APK Target
Compiling for Android requires the Android SDK, NDK, and Java build tools. 

1. **Setup Java SDK (JDK 21):**
   Ensure **Java 21** (e.g., Eclipse Adoptium Temurin 21) is installed and the `JAVA_HOME` environment variable is configured. The Gradle wrapper requires JDK 21 to avoid compilation version mismatches.
2. **Install Android SDK & NDK:**
   Open SDK Manager in Android Studio and ensure the following are installed:
   - Android SDK Platform-Tools
   - Android SDK Build-Tools
   - NDK (Side-by-side)
3. **Configure Environment Variables:**
   Add the following variables to your environment (clean up any double quotes in your `PATH` variable if you encounter Gradle build execution issues):
   - `ANDROID_HOME` = `C:\Users\<Your-Username>\AppData\Local\Android\Sdk`
   - `NDK_HOME` = `C:\Users\<Your-Username>\AppData\Local\Android\Sdk\ndk\<NDK-Version>`
4. **Compile the APK:**
   Run the following commands:
   ```bash
   # Add Android target architectures
   rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android

   # Initialize android platform in Tauri project (run once)
   npm run tauri android init --ci

   # Build the release APK
   npm run tauri android build --apk
   ```
   The generated APK will be output at:
   `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk`

> **⚠️ Keystore Note:** The release APK is signed automatically in CI (see below). For local builds, place your keystore at `src-tauri/gen/android/app/release.keystore` (this path is git-ignored) and set the `SHAIREE_KEYSTORE_PASSWORD`, `SHAIREE_KEY_ALIAS`, and `SHAIREE_KEY_PASSWORD` environment variables before running the build. If no keystore is present, the release build falls back to the debug signing key.

### 🔒 Android Release Signing (CI Secrets)
Release APKs published from the `Release Build` workflow are signed with a dedicated keystore that is **never** stored in the repository. Configure these repository secrets before tagging a release:

| Secret | Description |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Your `.keystore` file, base64-encoded (`base64 release.keystore -w 0`). The workflow decodes it at build time. |
| `SHAIREE_KEYSTORE_PASSWORD` | Keystore (store) password. |
| `SHAIREE_KEY_ALIAS` | Alias of the signing key inside the keystore. |
| `SHAIREE_KEY_PASSWORD` | Password for the signing key itself. |

If any secret is missing, the workflow emits a warning and the APK is signed with the debug key (fine for testing, not for distribution).

**Rotate immediately if a keystore was ever committed.** A keystore (and its passwords) that has appeared in git history must be considered compromised — anyone can use it to sign APKs that Android will treat as authentic Shairee updates. Generate a brand-new keystore with `keytool`, upload it as the `ANDROID_KEYSTORE_BASE64` secret above, and remove the old one from history (e.g. with `git filter-repo`) if feasible.

### 🛠️ Android Studio Development (Run / Debug)
When debugging the application on a real device or emulator using Android Studio, you must boot the Tauri development daemon in a background terminal before clicking the **Run** (green play) button:
1. In your project root terminal, run:
   ```powershell
   # Cleans environment path and starts the dev server:
   $env:PATH = $env:PATH.Replace('"', ''); $env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot"; npm run tauri android dev
   ```
2. Wait for the dev server to start and launch Android Studio automatically.
3. In Android Studio, select your emulator and click **Run**. This connects to the running WebSocket daemon to sync CLI settings, build the Rust binary, and deploy the application.


---

## 📖 User Manual & How It Works

### Step 1: Start the Network Portal
Launch **Shairee** and click the blue **Start Sharing** button. The server will start and bind to your LAN IP.

### Step 2: Connect Your Android Device
*   **Hotspot Sharing (Recommended for Max Speed)**: 
    1. Turn on **Mobile Hotspot** on your Windows laptop.
    2. Connect your Android phone to the laptop's hotspot Wi-Fi.
    3. The app will automatically bind to the hotspot gateway `http://192.168.137.1:8384`. If it doesn't, simply **click on the displayed Access URL** in the desktop window to cycle to the `192.168.137.1` interface.
    4. Scan the generated QR code with your phone or open the URL in Chrome.
*   **Standard Wi-Fi LAN Sharing**: 
    1. Ensure both your PC and phone are connected to the same home/office Wi-Fi router.
    2. The app will bind to your Wi-Fi LAN IP (e.g. `http://192.168.1.15:8384`). 
    3. Scan the QR code or type the URL into your phone's browser.

### Step 3: Share and Download Files
*   **Add Files**: Drag & drop files onto the dotted drop card on your PC, or click **Add Files** / **Add Folder** to browse. The files will instantly show up on the phone's web UI.
*   **Download**: Tap **Download** next to any file on your phone.
    *   Directories will automatically download as standard `.zip` files.
    *   Tap **Download All (ZIP)** at the top of the mobile screen to bundle all shared items into a single download!
*   **Activity Log**: View real-time completed transfers inside the **Live Activity** log on your PC.

### Step 4: Configure Security PIN & Port
Click the **Gear** icon in the app header to open the Settings panel:
*   Toggle **Require Password** and type in an access PIN (e.g. `1234`). Mobile clients will now be prompted to enter this PIN before browsing or downloading files.
*   Input a custom port (e.g. `9090`) and click **Save & Restart** to automatically reboot the sharing server on the new configuration!

---

## 🔒 Security & Privacy
*   **100% Local**: Files are streamed directly from your laptop to your phone over your local network adapters. No data ever touches the cloud, third-party servers, or the internet.
*   **Path Traversal Prevention**: Strict path sanitization on all Actix HTTP endpoints ensures that mobile clients can only access files that have been explicitly added to the share list, completely protecting your host system directories.

---

## 📄 License
This project is open-source and available under the [MIT License](LICENSE).
