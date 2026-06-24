# HL-MCK Automation Antidetect Browser

An Electron + React application for managing browser profiles with advanced antidetect capabilities. This tool allows users to create, manage, and launch browser profiles with customized fingerprints to avoid browser detection.

## Features

- 🎨 **Profile Management**: Create, edit, and delete browser profiles
- 🔒 **Antidetect Technology**: Customize browser fingerprints including:
  - Operating System spoofing (Windows, macOS, Linux)
  - Browser type and version
  - Custom User Agent strings
  - Screen resolution settings
  - Language and timezone configuration
  - WebGL, Canvas, and Audio Context control
- 🚀 **Profile Launcher**: Launch isolated browser instances with custom profiles
- 💾 **Persistent Storage**: Profiles are saved locally in JSON format
- 🎯 **Modern UI**: Clean and intuitive React-based interface

## Technology Stack

- **Electron**: Desktop application framework
- **React**: UI library
- **Vite**: Build tool and development server
- **Node.js**: Backend runtime

## Installation

1. Clone the repository:
```bash


2. Install dependencies:
```bash
npm install
```

## Development

Run the application in development mode:

```bash
npm run dev
```

This will start both the Vite development server (for React hot reload) and the Electron application.

## Building

Build the application for production:

```bash
npm run build
```

This will:
1. Build the React application using Vite
2. Package the Electron application using electron-builder

The built application will be available in the `release` directory.

## Usage

### Creating a Profile

1. Click the "Create New Profile" button
2. Fill in the profile details:
   - **Profile Name**: A unique name for your profile
   - **Description**: Optional description
   - **Start URL**: The URL to open when launching the profile
3. Configure the browser fingerprint:
   - Select Operating System
   - Choose Browser type
   - Set Browser Version
   - Customize User Agent (auto-generated based on OS)
   - Configure Language and Timezone
   - Set Screen Resolution
   - Enable/disable WebGL, Canvas, and Audio features
4. Click "Create Profile" to save

### Editing a Profile

1. Click the "Edit" button on any profile card
2. Modify the desired settings
3. Click "Update Profile" to save changes

### Launching a Profile

Click the "Launch" button on any profile card to open a new browser window with the configured fingerprint settings.

### Deleting a Profile

Click the "Delete" button on any profile card and confirm the deletion.

## Profile Storage & Data

- Runtime data stored under `data/` (git-ignored): profiles.json, settings.json, logs, storage state, CDP user-data
- When deleting a profile, its storage state and `data/cdp-user-data/<id>/` are removed automatically

## Architecture

```
├── src/
│   ├── main/
│   │   ├── bootstrap.js        # Main entry; composes window, IPC, REST, heartbeat
│   │   ├── api/                # REST server + OpenAPI
│   │   ├── controllers/        # Profile lifecycle & browser control
│   │   ├── engine/             # CDP helpers & overrides, health checks
│   │   ├── ipc/                # Centralized IPC handlers
│   │   ├── logging/            # File logger
│   │   ├── state/              # In-memory running profiles map
│   │   ├── storage/            # paths, settings, profiles
│   │   └── window/             # BrowserWindow setup
│   ├── preload/                # contextBridge exposing electronAPI
│   └── renderer/               # React UI
├── data/                       # Runtime data (git-ignored)
├── vendor/                     # Portable Chrome/Chromium (optional)
└── package.json
```

## Engines: Playwright vs CDP

- Playwright engine: launches a Playwright server; applies fingerprint via context options and init scripts
- CDP (real Chrome) engine: launches real Chrome with `--remote-debugging-port`; applies fingerprint via CDP Emulation + init scripts
- Parity achieved:
   - UA, locale, timezone, DPR, languages, WebGL vendor/renderer, plugins, maxTouchPoints, DNT
   - Viewport applied (PW: viewport/deviceScaleFactor, CDP: DeviceMetricsOverride)
   - Geolocation (both)
   - WebRTC proxy-only (both via flags)

## Security Considerations

This tool is designed for legitimate testing and automation purposes. Users are responsible for ensuring their use of this software complies with applicable laws and terms of service.

## License

ISC

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
