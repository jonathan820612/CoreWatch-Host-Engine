using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

namespace CoreWatchLauncher {
    internal static class Program {
        [STAThread]
        private static int Main(string[] args) {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string scriptPath = Path.Combine(baseDir, "Start-NodeWatch.ps1");

            if (!File.Exists(scriptPath)) {
                MessageBox.Show(
                    "CoreWatch could not locate Start-NodeWatch.ps1 in:\n" + baseDir +
                    "\n\nPlease reinstall or extract the full CoreWatch folder before launching.",
                    "CoreWatch - Missing Component",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return 1;
            }

            string pwshPath = FindPowerShell7();
            if (string.IsNullOrEmpty(pwshPath)) {
                DialogResult res = MessageBox.Show(
                    "CoreWatch requires PowerShell 7 (pwsh.exe), which was not found on this PC.\n\n" +
                    "Click YES to automatically install PowerShell 7 (MSIX via WinGet, with official GitHub .MSI fallback), or NO to open the GitHub Releases page.\n\n" +
                    "Note: The MSIX version installs inside C:\\Program Files\\WindowsApps where Windows restricts direct browsing or manual edits to the install directory.",
                    "CoreWatch - PowerShell 7 Required",
                    MessageBoxButtons.YesNoCancel,
                    MessageBoxIcon.Information
                );

                if (res == DialogResult.Yes) {
                    try {
                        string installCmd =
                            "Write-Host 'No PowerShell Core 7 found — installing MSIX version via WinGet...' -ForegroundColor Cyan; " +
                            "Write-Host 'NOTE: MSIX installs into C:\\Program Files\\WindowsApps (Windows restricts direct access to the install folder).' -ForegroundColor Yellow; " +
                            "$ok=$false; " +
                            "if(Get-Command winget -EA 0){ & winget install --id Microsoft.PowerShell -e --source winget --accept-package-agreements --accept-source-agreements; if($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq -1978335189){$ok=$true} }; " +
                            "if(-not $ok){ Write-Host 'WinGet unavailable/failed — falling back to latest official .MSI...' -ForegroundColor Yellow; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; " +
                            "$arch=if($env:PROCESSOR_ARCHITECTURE -match 'ARM64'){'arm64'}elseif([Environment]::Is64BitOperatingSystem){'x64'}else{'x86'}; " +
                            "$rels=Invoke-RestMethod 'https://api.github.com/repos/PowerShell/PowerShell/releases?per_page=30' -Headers @{'User-Agent'='CoreWatch'}; " +
                            "$best=$null; $bv=[version]'0.0.0'; " +
                            "foreach($r in $rels){if($r.prerelease -or $r.draft){continue}; if($r.tag_name -notmatch '^v(\\d+\\.\\d+\\.\\d+)$'){continue}; $v=[version]$Matches[1]; $a=$r.assets|Where-Object{$_.name -match ('^PowerShell-.*-win-'+$arch+'\\.msi$')}|Select-Object -First 1; if($a -and $v -gt $bv){$bv=$v;$best=$a}}; " +
                            "if($best){$p=Join-Path $env:TEMP $best.name; Write-Host ('Downloading '+$best.name+'...'); Invoke-WebRequest $best.browser_download_url -OutFile $p -UseBasicParsing; Start-Process msiexec.exe -ArgumentList '/i',('\"'+$p+'\"'),'/qb','ADD_PATH=1','REGISTER_MANIFEST=1' -Wait; Remove-Item $p -Force -EA 0; $ok=$true} else {Start-Process 'https://github.com/PowerShell/PowerShell/releases'} }; " +
                            "if($ok){ Write-Host 'PowerShell 7 installed! Re-launch CoreWatch.' -ForegroundColor Green }; Read-Host 'Press Enter to close'";
                        Process.Start(new ProcessStartInfo {
                            FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe"),
                            Arguments = "-NoProfile -ExecutionPolicy Bypass -Command \"" + installCmd.Replace("\"", "\\\"") + "\"",
                            UseShellExecute = true
                        });
                    } catch {
                        OpenUrl("https://github.com/PowerShell/PowerShell/releases");
                    }
                } else if (res == DialogResult.No) {
                    OpenUrl("https://github.com/PowerShell/PowerShell/releases");
                }
                return 2;
            }

            var argParts = new List<string> {
                "-NoProfile",
                "-WindowStyle", "Hidden",
                "-ExecutionPolicy", "Bypass",
                "-File", "\"" + scriptPath + "\"",
                "-Release"
            };

            if (args != null) {
                foreach (string a in args) {
                    if (!string.IsNullOrWhiteSpace(a)) {
                        argParts.Add(a.Contains(" ") ? "\"" + a.Replace("\"", "\\\"") + "\"" : a);
                    }
                }
            }

            try {
                var psi = new ProcessStartInfo {
                    FileName = pwshPath,
                    Arguments = string.Join(" ", argParts),
                    WorkingDirectory = baseDir,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                Process.Start(psi);
                return 0;
            } catch (Exception ex) {
                MessageBox.Show(
                    "Failed to launch CoreWatch Host Engine:\n\n" + ex.Message,
                    "CoreWatch Launch Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return 3;
            }
        }

        private static string FindPowerShell7() {
            string[] knownPaths = new[] {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "PowerShell", "7", "pwsh.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "PowerShell", "7", "pwsh.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "WindowsApps", "pwsh.exe")
            };

            foreach (string p in knownPaths) {
                if (!string.IsNullOrEmpty(p) && File.Exists(p)) return p;
            }

            string pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (string dir in pathEnv.Split(';')) {
                try {
                    string trimmed = dir.Trim().Trim('"');
                    if (string.IsNullOrEmpty(trimmed)) continue;
                    string candidate = Path.Combine(trimmed, "pwsh.exe");
                    if (File.Exists(candidate)) return candidate;
                } catch { }
            }

            return null;
        }

        private static void OpenUrl(string url) {
            try {
                Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
            } catch { }
        }
    }
}
