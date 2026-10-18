# notalk 💬

> A modern, serverless, zero-backend peer-to-peer web chat with an Instagram DM-inspired interface and cryptographic identity ownership.

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Zero Backend](https://img.shields.io/badge/Backend-0%20Servers%20($0)-brightgreen.svg)
![WebAssembly](https://img.shields.io/badge/WASM-Rust%20Dalek%20Ed25519-orange.svg)
![Architecture](https://img.shields.io/badge/P2P-WebRTC%20Mesh-purple.svg)

---

## ✨ Features

* **Zero Backend Required ($0 / Free Forever)**: 
  * No centralized server or database.
  * Runs 100% client-side in the browser. Deploy on GitHub Pages, Cloudflare Pages, Netlify, or a 5MB Docker Nginx container.
* **Instagram DM-Inspired Aesthetic**:
  * Rounded message bubbles with gradient accents.
  * Capsule chat input pill with circular send button.
  * Story ring avatars and theme support (Dark / Midnight, Slate, Clean Light, Neon Cyber).
  * **Zero ugly scrollbars**: Completely hidden scrollbars globally for a sleek native app feel.
* **Public vs. Private Identity**:
  * **Public Identity (`pub_<hex>`)**: Visible to all members; verifies message signatures. Copy any member's Public ID from the chat.
  * **Private Identity (`priv_<hex>`)**: Secret key stored locally in browser storage. Export your Private Identity to impersonate or restore your account on any device.
  * **Identity-Based Alignment**: Your messages are always anchored to the **right side**, even if you change your username.
* **Right-Click Context Menu**:
  * No annoying hover popups. Right-click (or long-press on mobile) any message to reveal sender details, copy their Public Identity, pin the message to the top banner, or copy text.
* **IndexedDB Message Retention & Pinning**:
  * Configurable auto-purge: **Session Only**, **1 Hour**, **24 Hours**, or **7 Days (Max)**.
  * Pinned messages stay preserved at the top of the chat and bypass the retention purge.
* **Native Rust WebAssembly Engine**:
  * Self-contained compiled Rust Dalek Ed25519 WebAssembly module (`p0_engine_bg.wasm`) with transparent browser WebCrypto fallback.
* **Instant Multi-Tab & Global Connectivity**:
  * 0ms local cross-tab communication via `BroadcastChannel` and storage events.
  * WebRTC peer connection mesh with public STUN and WebTorrent trackers for cross-network chatting.

---

## 🚀 Quick Start

### 1. Using Python (Zero Dependencies)
Run the included development server:
```bash
python3 serve.py
```
Open **[http://localhost:5500](http://localhost:5500)** in two or more tabs or browser windows.

### 2. Using VSCode Live Server
1. Open this folder in VSCode.
2. Right-click `index.html` and select **"Open with Live Server"**.
3. Open the link in multiple browser tabs to chat immediately.

### 3. Using Docker & Nginx
```bash
docker compose up -d
```
Access at **[http://localhost:8081](http://localhost:8081)**.

---

## 🌐 1-Click Free Deployment

### GitHub Pages
1. Push this repository to GitHub.
2. Go to **Settings > Pages**.
3. Under **Build and deployment > Source**, choose `Deploy from a branch`.
4. Select `main` branch, root `/` folder, and click **Save**.
5. Your chat is instantly live worldwide at `https://<your-username>.github.io/<repo>/`!

### Cloudflare Pages / Vercel / Netlify
* Framework preset: `None / Static HTML`
* Build command: *(leave empty)*
* Output directory: `.`

---

## 🔒 Identity & Impersonation Mechanics

1. **Changing Your Username**:
   * Click your user pill in the top header.
   * Edit your handle and click **"Update"**. Your Public Identity remains the same, and your sent messages remain on the right side.
2. **Exporting Your Account Key**:
   * Click your user pill $\rightarrow$ click **"👁️ Reveal"** or **"📋 Copy Secret"** under Private Identity.
   * Store this key safely.
3. **Impersonating / Switching Identity**:
   * Paste any Private Identity (`priv_...`) into the **"Impersonate / Switch Account"** field and click **"Switch"**.
   * All historical messages belonging to that identity will immediately align to the right side (`is-me`).

---

## 🛠️ Project Structure

```
notalk/
├── index.html           # Main chat interface & modal markup
├── style.css            # Instagram DM styles, themes, and scrollbar removal
├── app.js               # Application state, identity logic, and right-click context menu
├── db.js                # IndexedDB auto-retention manager (1h / 24h / 7d)
├── p0_crypto.js         # Rust WASM / WebCrypto bridge & identity serialization
├── p0_engine_bg.wasm    # Native Rust Dalek Ed25519 WebAssembly module (621 KB)
├── p2p_swarm.js         # Multi-channel WebRTC gossip mesh & local signaling
├── serve.py             # Zero-dependency Python server with proper WASM MIME type
├── nginx.conf           # Production Nginx configuration
├── Dockerfile           # 5MB Alpine container image
├── docker-compose.yml   # 1-command container deployment
└── README.md            # Documentation
```

---

## 📄 License

MIT License © 2026 Protocol Zero Contributors
