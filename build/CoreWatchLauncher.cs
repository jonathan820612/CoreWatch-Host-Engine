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
                    "Click YES to install PowerShell 7 automatically using winget, or NO to open the download page.",
                    "CoreWatch - PowerShell 7 Required",
                    MessageBoxButtons.YesNoCancel,
                    MessageBoxIcon.Information
                );

                if (res == DialogResult.Yes) {
                    try {
                        Process.Start(new ProcessStartInfo {
                            FileName = "cmd.exe",
                            Arguments = "/k winget install --id Microsoft.PowerShell --source winget --accept-package-agreements --accept-source-agreements",
                            UseShellExecute = true
                        });
                    } catch {
                        OpenUrl("https://aka.ms/powershell-release?tag=stable");
                    }
                } else if (res == DialogResult.No) {
                    OpenUrl("https://aka.ms/powershell-release?tag=stable");
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
