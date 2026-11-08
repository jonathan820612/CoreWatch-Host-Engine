[CmdletBinding()]
param()

<#
    Compiles a flat data mesh of all active Windows Startup registrations.
#>
function Get-StartupAppsMesh {
    [CmdletBinding()]
    param()

    $Results = New-Object System.Collections.Generic.List[PSCustomObject]

    # 1. Expanded Registry Paths
    $RegPaths = @(
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run",
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run"
    )

    foreach ($Path in $RegPaths) {
        if (Test-Path $Path) {
            $Props = Get-ItemProperty -Path $Path -ErrorAction SilentlyContinue
            $Props.PSObject.Properties | Where-Object { $_.Name -notmatch "PSPath|PSChildName|PSDrive|PSProvider|PSParentPath" } | ForEach-Object {
                $Results.Add([PSCustomObject]@{
                    Name     = [string]$_.Name
                    Command  = [string]$_.Value
                    Location = [string]$Path
                    Type     = "Registry"
                    Status   = "Enabled"
                })
            }
        }
    }

    # 2. Expanded Startup Folders
    $Folders = @(
        "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup",
        "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Startup"
    )

    $Shell = New-Object -ComObject WScript.Shell
    foreach ($Folder in $Folders) {
        if (Test-Path $Folder) {
            Get-ChildItem $Folder -Filter "*.lnk" -ErrorAction SilentlyContinue | ForEach-Object {
                try {
                    $Shortcut = $Shell.CreateShortcut($_.FullName)
                    $Results.Add([PSCustomObject]@{
                        Name     = [string]$_.BaseName
                        Command  = [string]$Shortcut.TargetPath
                        Location = [string]$Folder
                        Type     = "Folder"
                        Status   = "Enabled"
                    })
                } catch {
                    $Results.Add([PSCustomObject]@{ 
                        Name = [string]$_.BaseName; 
                        Command = [string]$_.FullName; 
                        Location = [string]$Folder; 
                        Type = "Folder"; 
                        Status = "Enabled" 
                    })
                }
            }
        }
    }

    return [PSCustomObject]@{
        type = "REFRESH_STARTUP_APPS"
        apps = @($Results) # Explicitly return as a flat array
    }
}

<#
    Removes a startup entry from either the registry or the startup folder.
#>
function Remove-StartupApp {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)] [string]$Name,
        [Parameter(Mandatory=$true)] [string]$Location,
        [Parameter(Mandatory=$true)] [string]$Type
    )
    try {
        if ($Type -eq "Registry") {
            Remove-ItemProperty -Path $Location -Name $Name -Force -Confirm:$false
        } else {
            $TargetPath = Join-Path $Location "$Name.lnk"
            if (Test-Path $TargetPath) { Remove-Item -Path $TargetPath -Force -Confirm:$false }
        }
        return $true
    } catch { 
        return $false 
    }
}