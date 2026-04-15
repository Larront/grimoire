# 📜 Grimoire

**A spellbook of record for Tabletop RPG worldbuilders.**

Grimoire is a modern desktop application designed for Game Masters to manage lore, NPCs, and session prep. It is built to feel like a well-crafted creative instrument—restrained, purposeful, and focused on the world you are building.

## ✨ Key Features

- **Local-First Vaults:** Your data belongs to you. Grimoire operates on a local directory ("Vault"). Because all paths are relative to the vault root, your campaign is fully portable—move it between drives or computers without breaking a single link.
- **Rich Text Notes:** A distraction-free Markdown editor for capturing lore. Notes are stored as raw `.md` files, ensuring your data is never locked in a proprietary format.
- **Ambient Audio Scenes:** Create immersive soundscapes by layering local audio files and Spotify tracks into custom scene slots.
- **Interactive Maps:** (Planned) Annotate world maps with pins and categories to track geography and points of interest.
- **Arcane Clarity:** A cool-toned interface designed for high scannability and "GM clarity under pressure" during live sessions.

## 🚀 Getting Started

### Installation

1.  Download the latest version for your operating system from the **Releases** page.
2.  Install the application:
    - **Windows:** Run the `.msi` or `.exe` installer.
    - **macOS:** Drag the `.app` to your Applications folder.
    - **Linux:** Use the `.deb` or `AppImage`.

### Opening a Vault

When you first launch Grimoire, you will be prompted to open a directory. This directory is your **Vault**. Grimoire will create a hidden `.grimoire` folder inside to manage its campaign database and metadata.

## ❓ FAQ

**What do I need for Spotify integration?**
You simply need a **Spotify Premium** account. You can connect your account in the app settings to start adding tracks and playlists to your scenes.

**Can I use other Markdown editors?**
Yes. Your notes are stored as standard Markdown files. You can open and edit them in tools like Obsidian or VS Code without breaking your Grimoire vault.

---

## 🛠 Development

If you wish to contribute or build Grimoire from source, follow the instructions below.

### Prerequisites

Ensure you have the following installed:

1.  **Node.js** (LTS) & **Bun**
2.  **Rust** (via rustup)
3.  **System Dependencies** for Tauri: Windows | macOS | Linux

### Setup

```bash
bun install
```

### Commands

```bash
# Start full desktop app (Tauri + Vite)
bun run tauri dev

# Frontend only (Vite)
bun run dev

# Run type-checking
bun run check

# Build production bundle
bun run tauri build
```

### 🛠 Tech Stack

- **Framework:** Tauri v2, Svelte 5 (Runes), SvelteKit
- **Database:** SQLite via Diesel ORM
- **Styling:** Tailwind CSS 4, shadcn-svelte

### 📝 Recommended IDE Setup

- VS Code + Svelte + Tauri + rust-analyzer
