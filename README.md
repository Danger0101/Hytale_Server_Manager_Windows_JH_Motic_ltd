# Hytale Server Manager (Windows)

The Hytale Server Manager is a desktop application built with Electron, designed to simplify the management of Hytale game servers, particularly for Windows users. It provides a graphical user interface (GUI) to handle server lifecycle, configuration, player management, and integration with Hytale's cloud services and APIs.

This manager aims to automate common server administration tasks, including:
- Starting and stopping server instances
- Viewing server console output in real-time
- Sending commands to the server
- Managing server configurations (server.properties, JSON configs)
- Managing player lists (whitelist, banned players, operators)
- Backing up server data
- Downloading and updating server JARs
- Integrating with Hytale's official APIs for player lookups, reporting, and payment features.
- Basic Discord webhook integration for server status notifications.

## Table of Contents

1.  [Features](#features)
2.  [Installation](#installation)
    *   [Pre-requisites](#pre-requisites)
    *   [From Release](#from-release)
    *   [From Source](#from-source)
3.  [Getting Started](#getting-started)
    *   [Adding a New Server](#adding-a-new-server)
    *   [Importing Server Files](#importing-server-files)
    *   [Starting Your Server](#starting-your-server)
4.  [Server Management](#server-management)
    *   [Server Console](#server-console)
    *   [Configuration Editor](#configuration-editor)
    *   [Player Management](#player-management)
    *   [Backup & Restore](#backup--restore)
    *   [Updating the Server JAR](#updating-the-server-jar)
    *   [Hytale Cloud Services](#hytale-cloud-services)
5.  [Troubleshooting](#troubleshooting)
6.  [Contributing](#contributing)
7.  [License](#license)

## 1. Features

*   **Multi-Server Management:** Add, edit, and manage multiple Hytale server instances from a single interface.
*   **Intuitive GUI:** A user-friendly graphical interface for all server operations.
*   **Real-time Console:** View live server console output and send commands directly.
*   **Server Lifecycle Control:** Start, stop, and gracefully shut down your Hytale servers.
*   **Configuration Editor:** Edit `server.properties` and other JSON configuration files directly within the app, with both GUI and text modes.
*   **Player Management:** Administer player whitelists, banned players, and operators lists. Includes player history tracking and Hytale API integration for UUID lookups and reporting.
*   **Backup System:** Create manual backups of your server worlds and configurations.
*   **Automated Updates:** Download the latest Hytale server JARs via custom URLs or the integrated Hytale Downloader CLI tool.
*   **Hytale API Integration:** Connect to Hytale's official APIs for advanced features like player profile lookups, reporting, and payment integration.
*   **Discord Webhooks:** Receive server start/stop and player join/leave notifications in your Discord channels.
*   **Bundled Java Runtime:** Includes a Java Runtime Environment (JRE) to ensure compatibility, or allows you to specify your own.

## 2. Installation

### Pre-requisites

*   **Operating System:** Windows 10/11 (The application is designed for Windows, but some core functions may work on Linux with corresponding binaries).
*   **Internet Connection:** Required for downloading server files, updates, and Hytale API interactions.

### From Release

The easiest way to get started is to download the latest stable release from the GitHub Releases page:

1.  Go to the [Releases Page](https://github.com/Danger0101/Hytale_Server_Manager_Windows_JH_Motic_ltd/releases).
2.  Download the latest `Hytale.Server.Manager.Setup.exe` file (e.g., `Hytale.Server.Manager.Setup.V1.1.0.exe`).
3.  Run the installer and follow the on-screen instructions.

### From Source (for Developers)

If you want to run the application from source or contribute to its development, follow these steps:

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/Danger0101/Hytale_Server_Manager_Windows_JH_Motic_ltd.git
    cd Hytale_Server_Manager_Windows_JH_Motic_ltd
    ```
2.  **Navigate to the Application Directory:**
    ```bash
    cd hytale-manager
    ```
3.  **Install Dependencies:**
    ```bash
    npm install
    ```
4.  **Run the Application:**
    ```bash
    npm start
    ```
    This will launch the Electron application in development mode.

## 3. Getting Started

Upon first launch, you'll see a welcome screen.

### Adding a New Server

1.  Click on the "Add Your First Server" button or the `+` button in the sidebar.
2.  Fill in the "Server Name" (e.g., "My Hytale World").
3.  Specify the "Server Path" – this is where all your server files (JAR, world data, configs) will be stored. You can use the "Browse..." button to select a folder.
4.  Optionally, you can configure "Java Arguments", "Java Executable Path", "Discord Webhook URL", and "Hytale Cloud Services" settings.
5.  Click the "Save Server" button.

### Importing Server Files

After saving your server, you can then import or download the Hytale server files.
To do this, select your newly added server from the sidebar, then click "Edit Settings" to re-open the modal.

You have several options:

*   **📥 Import from Hytale Launcher (Recommended for existing installations):** This will attempt to locate and copy server files (like `hytale-server.jar` and `Assets.zip`) from your local Hytale game installation (usually `C:\Users\<username>\AppData\Roaming\Hytale\install\release\package\game\latest`).
*   **☁️ Hytale Downloader (CLI):** This utilizes a bundled command-line tool to download the latest Hytale server files. **Important:** When using this, keep an eye on the main server console! You might be prompted to authenticate your Hytale account through a web browser using a device code.
*   **Custom Download URL:** If you have a direct download link for a `hytale-server.jar` or a ZIP archive containing it, you can enter it in the "Custom Download URL" field. After saving the server, use the "Update Server" button on the main screen to initiate the download. The manager will automatically unzip `.zip` files if detected.

### Starting Your Server

1.  Once your server files are in place (verified by the "Install Server" button changing to "Update Server"), click the "Start Server" button.
2.  The console will display the server's startup process.
3.  If prompted for Hytale account authentication, follow the instructions in the console.

## 4. Server Management

### Server Console

The main area of the application displays the real-time console output of your selected server.
*   Type commands into the input field at the bottom and press Enter to send them to the server.

### Configuration Editor

1.  Click the "Server Config" button.
2.  Select a configuration file (e.g., `server.properties`, `config.json`) from the dropdown.
3.  The editor will attempt to present a GUI form for common key-value pairs.
4.  You can switch to "Text Mode" to directly edit the raw file content.
5.  Click "Save Changes" to apply your modifications.

### Player Management

1.  Click the "Player Lists" button.
2.  Browse different lists: Whitelist, Banned Players, Operators, and Player History.
3.  Add new players by entering their name and clicking "Add". The manager will attempt to resolve their Hytale UUID via the API if an API key is configured.
4.  Remove players from lists using the `&times;` button.
5.  (For Hytale API enabled) You can report players directly from this interface.

### Backup & Restore

*   **Backup World:** Click the "Backup World" button to create a timestamped backup of your server's core files (excluding the server JAR and previous backups) within a `backups` folder inside your server directory.
*   **Open Backups:** Click "Open Backups" to quickly access the `backups` folder.

### Updating the Server JAR

*   The "Check for Updates" button (which becomes "Update Server" once installed) will download the latest server JAR based on the "Custom Download URL" you configured in the server settings.
*   It will automatically back up your old JAR before downloading the new one.

### Hytale Cloud Services

In the "Edit Server" modal, you can configure:

*   **Server API Key:** Essential for interacting with Hytale's official APIs for features like player UUID lookups, player reporting, and telemetry.
*   **Integrated Payments:** If enabled and configured with a Merchant ID, this integrates your server with Hytale's payment gateway.
*   **Advanced Authentication (Method C):** For advanced users or automated deployments, you can directly inject Session and Identity Tokens for server authentication, bypassing the interactive console authentication.

## 5. Troubleshooting

*   **"Please save server first" error:** Ensure you have saved your server configuration before attempting to use the "Import from Hytale Launcher" or "Hytale Downloader" features. These are only enabled when editing an existing, saved server.
*   **Server not starting:**
    *   Check the console for error messages.
    *   Ensure `hytale-server.jar` exists in your specified "Server Path".
    *   Verify your "Java Executable Path" if you're not using the bundled Java.
    *   Confirm your "Java Arguments" are correct.
*   **Hytale Downloader CLI Authentication:** If the downloader asks for a device code, check the main server console for instructions and open the provided URL in your web browser to authenticate.
*   **API Key issues:** Ensure your Hytale Server API Key is correctly entered in the server settings.

## 6. Contributing

Contributions are welcome! Please feel free to fork the repository, make changes, and submit pull requests. For major changes, please open an issue first to discuss what you would like to change.

## 7. License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.