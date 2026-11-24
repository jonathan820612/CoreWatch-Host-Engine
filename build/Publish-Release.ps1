<#
.SYNOPSIS
    One-command release endpoint for CoreWatch:
    1. Auto-increments single-digit rollover version in version.json (never .10)
    2. Compiles CoreWatch.exe, CoreWatchSensorHelper.exe, Portable ZIP, Inno Setup .exe & SHA256SUMS.txt
    3. Generates categorized commit changelog between previous Git tag and HEAD
    4. Commits version.json + BUILD-HISTORY.md, creates an annotated tag with full overview, and pushes to GitHub
    5. Publishes the GitHub Release (marked Pre-release for beta/alpha/rc) with all binary assets attached

.EXAMPLE
    .\build\Publish-Release.ps1
    .\build\Publish-Release.ps1 -ReleaseTitle "Test Beta 12"
    .\build\Publish-Release.ps1 -Bump patch -Draft
    .\build\Publish-Release.ps1 -Bump minor -Prerelease ""   # Full stable release
#>
[CmdletBinding()]
param(
    [ValidateSet("build", "patch", "minor", "major", "none")]
    [string]$Bump = "build",
    [string]$Prerelease = $null,
    [string]$ReleaseTitle = "",
    [switch]$Draft,
    [switch]$NoAdmin
)

$ErrorActionPreference = "Stop"

$buildScript = Join-Path $PSScriptRoot "Build-Beta.ps1"
$params = @{
    Bump          = $Bump
    PublishGitHub = $true
}
if (-not $NoAdmin) { $params["RequireAdmin"] = $true }
if ($PSBoundParameters.ContainsKey("Prerelease")) { $params["Prerelease"] = $Prerelease }
if ($ReleaseTitle) { $params["ReleaseTitle"] = $ReleaseTitle }
if ($Draft) { $params["Draft"] = $true }

& $buildScript @params
