# Hytale Server Manager

A desktop application for Windows, and Linux to simplify the creation, management, and monitoring of Hytale game servers.

![Server Manager Screenshot](https://i.imgur.com/8GIVdnC.png) 

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Getting Started](#getting-started)
- [Building From Source](#building-from-source)
- [License](#license)

## Features

- **Multi-Server Management**: Create and manage multiple server instances from a single interface.
- **Easy Installation**:
    - **One-Click CLI Downloader**: Utilizes a companion CLI tool to download and set up server files automatically.
    - **URL Downloader**: Install or update a server directly from a `.jar` or `.zip` URL.
    - **Official Launcher Import**: Copies necessary game files from an existing official Hytale installation.
- **Server Control**:
    - Start, stop, and restart your server with a single click.
    - View the live server console and send commands directly.
- **Configuration & Backups**:
    - Built-in editor for `server.properties`, `whitelist.json`, and other configuration files.
    - Create on-demand backups of your server world and configuration.
- **Monitoring & Alerts**:
    - **Discord Webhook Integration**: Get real-time notifications when your server starts or stops, and when players join or leave.
    - **Player Activity Log**: Tracks player join/leave history.
- **Hytale API Integration**:
    - Look up player UUIDs directly within the manager.
    - Report players to Hytale services.

## Installation

You can download the latest pre-built version for Windows and Linux from the official releases page.

**[➡️ Download Latest Release (v1.1.0)](https://github.com/Danger0101/Hytale_Server_Manager_Windows_JH_Motic_ltd/releases/tag/V1.1.0)**

1.  Navigate to the link above.
2.  Under the **Assets** section, download the appropriate file for your system:
    -   For **Windows**: Download `Hytale.Server.Manager.Setup.1.1.0.exe` and run the installer.
    -   For **Linux**: Download the `.deb`, `.rpm`, or `.zip` file.

## Getting Started

1.  **Launch the Application**: After installation, run the Hytale Server Manager.
2.  **Add Your First Server**:
    - Click the "Add New Server" button.
    - Give your server a name (e.g., "My Hytale World").
    - Choose a path where the server files will be stored.
    - Click "Save Server".
3.  **Install the Server Files**:
    - A new "Install" tab will appear for your created server.
    - You have three main options:
        - **Install via CLI Downloader (Recommended)**: This is the easiest method. Simply click "Run Installer" and the manager will download and configure the necessary files for you. It may require you to authenticate with your Hytale account through a device code prompt in the logs.
        - **Install from URL**: If you have a direct download link to a server `.jar` or `.zip` file, paste it here and click "Download & Install".
        - **Import from Launcher**: If you have the official Hytale game installed, this will attempt to copy the required server files from the installation directory.
4.  **Start the Server**:
    - Once installed, navigate to the "Console" tab.
    - Click the "Start Server" button. The live console output will appear, and you can now connect to your server in-game!

## Building From Source

If you prefer to build the application yourself, you will need Node.js and npm installed.

```bash
# 1. Clone the repository
git clone https://github.com/Danger0101/Hytale_Server_Manager_Windows_JH_Motic_ltd.git
cd Hytale_Server_Manager_Windows_JH_Motic_ltd/hytale-manager

# 2. Install dependencies
npm install

# 3. Run the application in development mode
npm start

# 4. To build the application for your platform (creates installers/packages in the 'out' folder)
npm run make
```

## License

This project is licensed under the ISC License.
