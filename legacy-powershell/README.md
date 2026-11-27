# CoreWatch — Legacy PowerShell Edition (End-of-Life)

> [!WARNING]
> **End-of-Life (EoL) — Maintenance Mode Only**
>
> The PowerShell + WinForms + WebView2 edition reached its **final feature release at [`v0.9.3`](https://github.com/jonathan820612/CoreWatch-Host-Engine/releases/tag/v0.9.3)**.
> Going forward, files inside `legacy-powershell/` will **only receive critical bug fixes — no new features**.
>
> Active development has moved to **RustCoreWatch** at the [repository root](../README.md).

## Download Final Legacy Release (`v0.9.3`)
Grab the compiled installer or portable package from **[GitHub Releases (`v0.9.3`)](https://github.com/jonathan820612/CoreWatch-Host-Engine/releases/tag/v0.9.3)**:
- `CoreWatch-0.9.3-Setup.exe` — Modular Inno Setup installer (23 tabs + optional PawnIO driver)
- `CoreWatch-0.9.3-Portable.zip` — Zero-install portable archive
- `CoreWatch-0.9.3-SHA256SUMS.txt` — SHA-256 verification checksums

## Running or Building Bug-Fix Releases Locally

```powershell
Set-Location d:\GitHub\CoreWatch-Host-Engine\legacy-powershell

# Launch from source with PowerShell 7:
pwsh -NoProfile -ExecutionPolicy Bypass -File .\Start-NodeWatch.ps1

# Local test build into .\testBuild\:
.\build\Build-Test.ps1

# Versioned bug-fix release build (requires Inno Setup 6 for Setup.exe):
.\build\Build-Beta.ps1 -Bump patch -Prerelease "" -RequireAdmin
```

Runtime user data is stored under `%LOCALAPPDATA%\CoreWatch\` (and can be imported directly into **RustCoreWatch** via **Settings → Import from PowerShell version**).
