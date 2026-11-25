# CoreWatch Persistence Schemas, IPC Contract & Frontend Bridge

Preserve exact file paths and JSON keys inside `%LOCALAPPDATA%\CoreWatch\` so existing CoreWatch users can upgrade seamlessly from PowerShell 7 → Rust without losing settings, themes, custom profiles, or encrypted tokens.

---

## 1. `%LOCALAPPDATA%\CoreWatch\` File Schemas

### `settings.json`
```json
{
  "schemaVersion": 1,
  "general": {
    "startWithWindows": false,
    "startMinimized": false,
    "minimizeToTrayOnClose": false,
    "confirmDestructiveActions": true,
    "autoCheckCoreWatchUpdates": true
  },
  "telemetry": {
    "pollingProfile": "balanced",
    "temperatureUnit": "C"
  },
  "directories": {
    "projectsRoot": "D:\\GitHub",
    "exportsRoot": "C:\\Users\\User\\Documents\\CoreWatch Exports",
    "wslInstallRoot": "C:\\WSL",
    "organizerDestRoot": "C:\\Users\\User\\Organized",
    "editorPath": "C:\\Users\\User\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe"
  },
  "modules": {
    "disabled": []
  }
}
```

### `ui-settings.json`
```json
{
  "windowBounds": { "x": 100, "y": 50, "width": 1080, "height": 1920 },
  "alwaysOnTop": false,
  "opacity": 1.0,
  "windowLockMode": "none",
  "layout": {
    "order": ["hardware", "display", "storage", "network", "infra", "console"],
    "wide": ["network", "console"],
    "hidden": [],
    "collapsed": [],
    "docked": [],
    "hiddenMetrics": []
  },
  "diagxDismissed": {},
  "theme": {
    "presetId": "classic",
    "bgApp": "#1a202c",
    "bgSurface": "#212936",
    "bgInset": "#141923",
    "bgControl": "#2d3748",
    "border": "#323c4b",
    "borderStrong": "#4a5568",
    "accent": "#3182ce",
    "accentLight": "#4299e1",
    "accentSoft": "#63b3ed",
    "textPrimary": "#f7fafc",
    "textSecondary": "#cbd5e0",
    "textMuted": "#a0aec0",
    "surfaceOpacity": 100,
    "cardBlur": 0,
    "bgImageFile": "custom-bg.jpg",
    "bgImageName": "wallpaper.jpg",
    "bgFit": "cover",
    "bgOpacity": 45,
    "bgBlur": 0,
    "bgFadeMode": "vignette",
    "bgFadeStrength": 35
  }
}
```
> **Wallpaper Serving**: Copy selected local images to `%LOCALAPPDATA%\CoreWatch\custom-bg.<ext>` and expose `%LOCALAPPDATA%\CoreWatch\` via a Tauri custom protocol (or WebView2 virtual host `https://corewatch-local.assets`) so large 4K wallpapers never bloat JSON/IPC as Base64.

### `profiles.json`
```json
{
  "schemaVersion": 1,
  "activeProfileId": "normal",
  "baseline": {
    "capturedAtUtc": "2026-11-25T00:00:00Z",
    "powerPlanGuid": "381b4222-f694-41f0-9685-ff5bb260df2e",
    "dndMode": "off",
    "keepAwake": false,
    "nightLight": "off",
    "nightLightStrength": 50,
    "monitors": []
  },
  "profiles": [
    {
      "id": "gaming",
      "name": "Gaming",
      "icon": "🎮",
      "accent": "#9f7aea",
      "description": "High Performance power plan, Do Not Disturb on, max refresh rate.",
      "isBuiltIn": true,
      "settings": {
        "powerPlan": "high",
        "dndMode": "priority",
        "keepAwake": "on",
        "nightLight": "off",
        "nightLightStrength": -1,
        "displays": [
          { "target": "primary", "friendlyName": "Primary Monitor", "hdr": "unchanged", "refreshMode": "max", "refreshHz": 0, "scalePct": 0 }
        ]
      }
    }
  ]
}
```

### `jira-config.json` & `secrets.dat.json`
```json
// jira-config.json (NO secrets)
{
  "siteUrl": "https://yourorg.atlassian.net",
  "email": "you@company.com",
  "authMode": "cloud_basic",
  "defaultProject": "CORE",
  "lastPreset": "assigned",
  "lastJql": ""
}
```
```json
// secrets.dat.json (DPAPI CurrentUser Base64 ciphertext)
{
  "github_pat": "AQAAANCMnd8BFdERjHoAwE/Cl+sB...",
  "jira_api_token": "AQAAANCMnd8BFdERjHoAwE/Cl+sB..."
}
```

### `<AppRoot>\installed-modules.json` (Written by Modular Inno Setup Installer)
```json
{
  "schemaVersion": 1,
  "installType": "full",
  "installedModules": [
    "netmanager", "tasksports", "diagx", "github", "jira", "wsl",
    "profiles", "security", "startup", "sharing", "apps",
    "appstore", "diskmap", "devices", "organizer"
  ]
}
```

---

## 2. Theme Engine CSS Variable Invariants

The complete frontend stylesheet (`modules/layouts/style.css`) exposes 12 live CSS variables:
`--cw-bg-app`, `--cw-bg-surface`, `--cw-bg-inset`, `--cw-bg-control` (+ auto hover), `--cw-border`, `--cw-border-strong`, `--cw-accent` (+ auto `--cw-on-accent` WCAG luminance contrast), `--cw-accent-light`, `--cw-accent-soft`, `--cw-text-primary`, `--cw-text-secondary`, `--cw-text-muted`, plus `--cw-surface-alpha`, `--cw-inset-alpha`, `--cw-card-blur`, and wallpaper variables (`--cw-bg-image`, `--cw-bg-size`, `--cw-bg-position`, `--cw-bg-repeat`, `--cw-bg-opacity`, `--cw-bg-blur`, `--cw-bg-scale`, `--cw-bg-fade-overlay`).

**Protected Functional Colors (NEVER override with user theme)**:
- Thermal badges: `.therm-cool`, `.therm-warm`, `.therm-hot`
- Diagnostic grades & badges: `.diag-ok`, `.diag-warn`, `.diag-crit`, `.grade-healthy/advisory/degraded/critical`
- Status & version badges: `.badge-success`, `.badge-danger`, `.badge-purple`, `.badge-info`, `.ver-uptodate`, `.ver-update`
- Network RX/TX & VRAM indicators: `.rx-*`, `.tx-*`, `.vram-fill`, `.adapter-status-badge` (`.status-on`, `.status-dc`, `.status-off`)
- Window lock / pin / exit / destructive actions: `.lock-pos`, `.lock-all`, `.nav-pin-btn.active`, `.exit-system-btn`, `.wsl-btn-danger`, `.sharing-danger`, `.sharing-error`

---

## 3. Day-1 Frontend Reuse Shim (`tauri-bridge.js`)

If reusing the full `modules/layouts/{index.html,style.css,app.js}` SPA directly inside Tauri v2, inject this lightweight shim before `app.js` loads so all 182 UI handlers work unchanged while Rust commands are implemented module-by-module:

```js
// Inject before app.js in Tauri v2 to bridge legacy WebView2 postMessage <-> Tauri invoke/events
if (window.__TAURI__ && !window.chrome?.webview) {
    const listeners = [];
    window.chrome = window.chrome || {};
    window.chrome.webview = {
        postMessage(msg) {
            const raw = typeof msg === 'string' ? msg : JSON.stringify(msg);
            window.__TAURI__.core.invoke('corewatch_ipc', { raw }).catch(err => {
                console.error('[CoreWatch IPC Error]', err);
            });
        },
        addEventListener(type, fn) {
            if (type === 'message' && typeof fn === 'function') listeners.push(fn);
        }
    };
    window.__TAURI__.event.listen('corewatch:message', (evt) => {
        const b64 = typeof evt.payload === 'string'
            ? evt.payload
            : btoa(unescape(encodeURIComponent(JSON.stringify(evt.payload))));
        listeners.forEach(fn => fn({ data: b64 }));
    });
}
```
