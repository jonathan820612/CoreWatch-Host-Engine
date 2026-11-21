[CmdletBinding()]
param()

<#
    Compiles a rich data mesh of Windows Startup registrations with native Task Manager status.
#>
function Get-StartupAppsMesh {
    [CmdletBinding()]
    param()

    try {
        $Results = New-Object System.Collections.Generic.List[PSCustomObject]

        # 1. Read Native Windows StartupApproved registries (HKCU & HKLM)
        $ApprovedRun = @{}
        foreach ($approvedPath in @(
            "HKLM:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run",
            "HKLM:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run32",
            "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
        )) {
            if (Test-Path -LiteralPath $approvedPath -ErrorAction SilentlyContinue) {
                $itemProps = Get-ItemProperty -LiteralPath $approvedPath -ErrorAction SilentlyContinue
                if ($itemProps) {
                    $itemProps.PSObject.Properties | Where-Object { $_.Name -notmatch "^(PSPath|PSParentPath|PSChildName|PSDrive|PSProvider)$" } | ForEach-Object {
                        $ApprovedRun[$_.Name] = if ($_.Value -and $_.Value.Length -gt 0 -and $_.Value[0] -eq 3) { "Disabled" } else { "Enabled" }
                    }
                }
            }
        }

        $ApprovedFolder = @{}
        foreach ($approvedFolderPath in @(
            "HKLM:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder",
            "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder"
        )) {
            if (Test-Path -LiteralPath $approvedFolderPath -ErrorAction SilentlyContinue) {
                $itemProps = Get-ItemProperty -LiteralPath $approvedFolderPath -ErrorAction SilentlyContinue
                if ($itemProps) {
                    $itemProps.PSObject.Properties | Where-Object { $_.Name -notmatch "^(PSPath|PSParentPath|PSChildName|PSDrive|PSProvider)$" } | ForEach-Object {
                        $ApprovedFolder[$_.Name] = if ($_.Value -and $_.Value.Length -gt 0 -and $_.Value[0] -eq 3) { "Disabled" } else { "Enabled" }
                    }
                }
            }
        }

        # 2. Registry Run Keys
        $RegPaths = @(
            @{ Path = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"; Scope = "Current User" },
            @{ Path = "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run"; Scope = "All Users" },
            @{ Path = "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run"; Scope = "All Users (32-bit)" }
        )

        foreach ($r in $RegPaths) {
            if (Test-Path -LiteralPath $r.Path -ErrorAction SilentlyContinue) {
                $Props = Get-ItemProperty -LiteralPath $r.Path -ErrorAction SilentlyContinue
                if ($Props) {
                    $Props.PSObject.Properties | Where-Object { $_.Name -notmatch "^(PSPath|PSChildName|PSDrive|PSProvider|PSParentPath)$" } | ForEach-Object {
                        $cmd = [string]$_.Value
                        $exe = if ($cmd -match "^`"([^`"]+)`"") { $Matches[1] } elseif ($cmd -match "^([^\s]+)") { $Matches[1] } else { $cmd }
                        $exeExpanded = if ($exe) { [System.Environment]::ExpandEnvironmentVariables($exe) } else { "" }
                        $exists = if ($exeExpanded -and (Test-Path -LiteralPath $exeExpanded -PathType Leaf -ErrorAction SilentlyContinue)) { $true } else { $false }
                        $pub = "Unavailable"
                        $prod = "Unavailable"
                        if ($exists) {
                            try {
                                $vi = (Get-Item -LiteralPath $exeExpanded -ErrorAction SilentlyContinue).VersionInfo
                                if ($vi.CompanyName) { $pub = $vi.CompanyName }
                                if ($vi.ProductName) { $prod = $vi.ProductName }
                            } catch {}
                        }
                        $status = if ($ApprovedRun.ContainsKey($_.Name)) { $ApprovedRun[$_.Name] } else { "Enabled" }

                        $Results.Add([PSCustomObject]@{
                            Name        = [string]$_.Name
                            Command     = $cmd
                            TargetExe   = $exeExpanded
                            Location    = [string]$r.Path
                            Type        = "Registry"
                            Scope       = [string]$r.Scope
                            Status      = $status
                            FileExists  = $exists
                            Publisher   = $pub
                            ProductName = $prod
                        })
                    }
                }
            }
        }

        # 3. Startup Folders
        $Folders = @(
            @{ Path = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup"; Scope = "Current User Folder" },
            @{ Path = "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Startup"; Scope = "All Users Folder" }
        )

        $Shell = $null
        try { $Shell = New-Object -ComObject WScript.Shell } catch {}
        foreach ($f in $Folders) {
            if (Test-Path -LiteralPath $f.Path -ErrorAction SilentlyContinue) {
                Get-ChildItem -LiteralPath $f.Path -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne "desktop.ini" } | ForEach-Object {
                    $item = $_
                    $targetPath = $item.FullName
                    if ($item.Extension -eq ".lnk" -and $null -ne $Shell) {
                        try {
                            $Shortcut = $Shell.CreateShortcut($item.FullName)
                            if ($Shortcut.TargetPath) { $targetPath = $Shortcut.TargetPath }
                        } catch {}
                    }

                    $targetExpanded = if ($targetPath) { [System.Environment]::ExpandEnvironmentVariables($targetPath) } else { "" }
                    $exists = if ($targetExpanded -and (Test-Path -LiteralPath $targetExpanded -PathType Leaf -ErrorAction SilentlyContinue)) { $true } else { $false }
                    $pub = "Unavailable"
                    $prod = "Unavailable"
                    if ($exists) {
                        try {
                            $vi = (Get-Item -LiteralPath $targetExpanded -ErrorAction SilentlyContinue).VersionInfo
                            if ($vi.CompanyName) { $pub = $vi.CompanyName }
                            if ($vi.ProductName) { $prod = $vi.ProductName }
                        } catch {}
                    }
                    $status = if ($ApprovedFolder.ContainsKey($item.Name)) { $ApprovedFolder[$item.Name] } else { "Enabled" }

                    $Results.Add([PSCustomObject]@{
                        Name        = [string]$item.BaseName
                        Command     = $targetExpanded
                        TargetExe   = $targetExpanded
                        Location    = [string]$f.Path
                        Type        = "Folder"
                        Scope       = [string]$f.Scope
                        Status      = $status
                        FileExists  = $exists
                        Publisher   = $pub
                        ProductName = $prod
                    })
                }
            }
        }

        return @{
            type  = "REFRESH_STARTUP_APPS"
            apps  = $Results.ToArray()
            error = $null
        }
    } catch {
        return @{
            type  = "REFRESH_STARTUP_APPS"
            apps  = @()
            error = $_.Exception.Message
        }
    }
}

function Invoke-StartupAppAction {
    param(
        [Parameter(Mandatory=$true)]
        $Payload
    )

    if ($Payload -is [string]) {
        $Payload = $Payload | ConvertFrom-Json
    }

    if ($null -eq $Payload -or $null -eq $Payload.command) { return $null }

    $msg = "Startup action completed."
    try {
        if ($Payload.command -eq "CREATE_STARTUP_APP") {
            $name = ([string]$Payload.name).Trim()
            $cmd  = ([string]$Payload.commandLine).Trim()
            $scope = if ($Payload.scope) { [string]$Payload.scope } else { "HKCU" }

            if (-not $name -or -not $cmd) { throw "Enter a valid application name and target path." }

            if ($scope -eq "StartupFolder") {
                $dir = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup"
                if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
                $lnkPath = Join-Path $dir "$name.lnk"
                $Shell = New-Object -ComObject WScript.Shell
                $Shortcut = $Shell.CreateShortcut($lnkPath)
                $Shortcut.TargetPath = $cmd
                $Shortcut.WorkingDirectory = [System.IO.Path]::GetDirectoryName($cmd)
                $Shortcut.Save()
                $msg = "Created startup shortcut for [$name]."
            } elseif ($scope -eq "HKLM") {
                Set-ItemProperty -Path "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run" -Name $name -Value $cmd -Force -ErrorAction Stop
                $msg = "Registered [$name] in System Run key (All Users)."
            } else {
                Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name $name -Value $cmd -Force -ErrorAction Stop
                $msg = "Registered [$name] in User Run key (Current User)."
            }
        }
        elseif ($Payload.command -eq "TOGGLE_STARTUP_APP") {
            $name = [string]$Payload.name
            $type = [string]$Payload.type
            $enable = [bool]$Payload.enable

            $targetVal = if ($enable) { 
                [byte[]]@(0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00)
            } else { 
                [byte[]]@(0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00)
            }

            $regKey = if ($type -eq "Folder") {
                "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder"
            } else {
                "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
            }

            if (-not (Test-Path $regKey)) {
                New-Item -Path $regKey -Force -ErrorAction SilentlyContinue | Out-Null
            }
            $entryName = if ($type -eq "Folder" -and $name -notmatch "\.lnk$") { "$name.lnk" } else { $name }
            Set-ItemProperty -Path $regKey -Name $entryName -Value $targetVal -Type Binary -Force -ErrorAction Stop
            $msg = if ($enable) { "Enabled [$name] at startup." } else { "Disabled [$name] at startup." }
        }
        elseif ($Payload.command -eq "REMOVE_STARTUP_APP") {
            $name     = [string]$Payload.name
            $location = [string]$Payload.location
            $type     = [string]$Payload.type

            if ($type -eq "Registry") {
                Remove-ItemProperty -Path $location -Name $name -Force -Confirm:$false -ErrorAction Stop
            } else {
                $targetPath = Join-Path $location "$name.lnk"
                if (Test-Path $targetPath) {
                    Remove-Item -Path $targetPath -Force -Confirm:$false -ErrorAction Stop
                }
            }

            # Clean up StartupApproved entry if present
            $runApprove = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
            if (Test-Path $runApprove) { Remove-ItemProperty -Path $runApprove -Name $name -ErrorAction SilentlyContinue }
            $folderApprove = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder"
            if (Test-Path $folderApprove) { Remove-ItemProperty -Path $folderApprove -Name "$name.lnk" -ErrorAction SilentlyContinue }

            $msg = "Removed [$name] permanently from startup boot entries."
        }
        elseif ($Payload.command -eq "OPEN_FILE_LOCATION") {
            $target = [string]$Payload.targetExe
            if ($target -and (Test-Path $target)) {
                Start-Process "explorer.exe" -ArgumentList "/select,`"$target`""
                $msg = "Revealed [$target] in Windows Explorer."
            } else {
                throw "Target executable not found on disk."
            }
        }
    } catch {
        $state = Get-StartupAppsMesh
        $state.error = $_.Exception.Message
        return $state
    }

    $result = Get-StartupAppsMesh
    $result.message = $msg
    return $result
}
