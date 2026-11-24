[CmdletBinding()]
param()

function Resolve-KnownUserFolder {
    param(
        [string]$ShellKey,
        [string]$FallbackRelative
    )
    $resolved = ""
    try {
        $regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders"
        $val = Get-ItemPropertyValue -Path $regPath -Name $ShellKey -ErrorAction SilentlyContinue
        if ($val) {
            $expanded = [System.Environment]::ExpandEnvironmentVariables([string]$val)
            if ($expanded -and (Test-Path -LiteralPath $expanded -PathType Container -ErrorAction SilentlyContinue)) {
                $resolved = $expanded
            }
        }
    } catch {}

    if (-not $resolved -and $FallbackRelative) {
        $fallback = Join-Path $env:USERPROFILE $FallbackRelative
        $resolved = $fallback
    }
    return $resolved.TrimEnd('\')
}

function Test-IsProtectedOrganizerPath {
    param([string]$FolderPath)
    if (-not $FolderPath -or -not [System.IO.Path]::IsPathRooted($FolderPath)) { return $true }
    try {
        $full = [System.IO.Path]::GetFullPath($FolderPath.Trim()).TrimEnd('\')
        $root = [System.IO.Path]::GetPathRoot($full).TrimEnd('\')
        if ($full -ieq $root) { return $true }
        if ($full -match '^[A-Za-z]:\\(Windows|Program Files|Program Files \(x86\)|ProgramData|System Volume Information|\$Recycle\.Bin)(\\|$)') { return $true }
        return $false
    } catch {
        return $true
    }
}

function Get-UndoManifestPath {
    param([string]$RootPath)
    $appDataDir = Join-Path $env:LOCALAPPDATA "CoreWatch"
    if (-not (Test-Path -LiteralPath $appDataDir)) {
        $null = New-Item -ItemType Directory -Path $appDataDir -Force -ErrorAction SilentlyContinue
    }
    return (Join-Path $appDataDir "FileOrganizerLastUndo.json")
}

function Get-DefaultMediaRules {
    return @(
        [PSCustomObject]@{
            id         = "pictures"
            label      = "Pictures"
            folderName = "Pictures"
            enabled    = $true
            extensions = ".jpg, .jpeg, .png, .gif, .bmp, .webp, .svg, .tif, .tiff, .ico, .heic, .heif, .avif, .raw, .cr2, .nef, .psd"
        },
        [PSCustomObject]@{
            id         = "videos"
            label      = "Videos"
            folderName = "Videos"
            enabled    = $true
            extensions = ".mp4, .mkv, .avi, .mov, .wmv, .flv, .webm, .m4v, .mpg, .mpeg, .3gp, .ts"
        },
        [PSCustomObject]@{
            id         = "audio"
            label      = "Audio"
            folderName = "Audio"
            enabled    = $true
            extensions = ".mp3, .wav, .flac, .aac, .ogg, .wma, .m4a, .opus, .aiff, .mid"
        },
        [PSCustomObject]@{
            id         = "documents"
            label      = "Documents"
            folderName = "Documents"
            enabled    = $true
            extensions = ".pdf, .doc, .docx, .xls, .xlsx, .ppt, .pptx, .txt, .rtf, .csv, .md, .odt, .ods, .epub"
        },
        [PSCustomObject]@{
            id         = "archives"
            label      = "Archives"
            folderName = "Archives"
            enabled    = $true
            extensions = ".zip, .rar, .7z, .tar, .gz, .bz2, .xz, .cab"
        },
        [PSCustomObject]@{
            id         = "installers"
            label      = "Installers & Programs"
            folderName = "Installers"
            enabled    = $true
            extensions = ".exe, .msi, .msix, .appx, .bat, .cmd"
        },
        [PSCustomObject]@{
            id         = "diskimages"
            label      = "Disk Images"
            folderName = "Disk Images"
            enabled    = $true
            extensions = ".iso, .img, .vhd, .vhdx, .dmg"
        },
        [PSCustomObject]@{
            id         = "code"
            label      = "Code & Scripts"
            folderName = "Code"
            enabled    = $false
            extensions = ".ps1, .psm1, .py, .js, .ts, .html, .css, .json, .xml, .yaml, .yml, .sql, .cs, .cpp, .h, .sh"
        }
    )
}

function Get-FileOrganizerState {
    [CmdletBinding()]
    param(
        [string]$RootPath = ""
    )

    try {
        $folderDefs = @(
            @{ id = "downloads"; label = "Downloads"; icon = "⬇️"; path = (Resolve-KnownUserFolder -ShellKey "{374DE290-123F-4565-9164-39C4925E467B}" -FallbackRelative "Downloads"); defaultSelected = $true },
            @{ id = "pictures";  label = "Pictures";  icon = "🖼️"; path = (Resolve-KnownUserFolder -ShellKey "My Pictures" -FallbackRelative "Pictures"); defaultSelected = $true },
            @{ id = "documents"; label = "Documents"; icon = "📄"; path = (Resolve-KnownUserFolder -ShellKey "Personal" -FallbackRelative "Documents"); defaultSelected = $true },
            @{ id = "videos";    label = "Videos";    icon = "🎬"; path = (Resolve-KnownUserFolder -ShellKey "My Video" -FallbackRelative "Videos"); defaultSelected = $true },
            @{ id = "music";     label = "Music";     icon = "🎵"; path = (Resolve-KnownUserFolder -ShellKey "My Music" -FallbackRelative "Music"); defaultSelected = $true },
            @{ id = "desktop";   label = "Desktop";   icon = "🖥️"; path = (Resolve-KnownUserFolder -ShellKey "Desktop" -FallbackRelative "Desktop"); defaultSelected = $false }
        )

        $folders = foreach ($f in $folderDefs) {
            $exists = ($f.path -and (Test-Path -LiteralPath $f.path -PathType Container -ErrorAction SilentlyContinue))
            $fileCount = 0
            if ($exists) {
                try {
                    $fileCount = @(Get-ChildItem -LiteralPath $f.path -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne "desktop.ini" -and $_.Extension -notin @(".lnk", ".tmp", ".crdownload", ".part") }).Count
                } catch {}
            }
            [PSCustomObject]@{
                id              = $f.id
                label           = $f.label
                icon            = $f.icon
                path            = $f.path
                exists          = [bool]$exists
                fileCount       = [int]$fileCount
                defaultSelected = [bool]($f.defaultSelected -and $exists)
                isCustom        = $false
            }
        }

        $undoCount = 0
        $undoTimestamp = ""
        if ($RootPath) {
            $undoPath = Get-UndoManifestPath -RootPath $RootPath
            if (Test-Path -LiteralPath $undoPath -PathType Leaf) {
                try {
                    $manifest = Get-Content -LiteralPath $undoPath -Raw | ConvertFrom-Json
                    if ($manifest -and $manifest.moves) {
                        $undoCount = @($manifest.moves).Count
                        $undoTimestamp = [string]$manifest.timestamp
                    }
                } catch {}
            }
        }

        return @{
            type          = "FILE_ORGANIZER_STATE"
            userFolders   = @($folders)
            defaultRules  = @(Get-DefaultMediaRules)
            defaultRoot   = (Join-Path $env:USERPROFILE "Organized")
            undoAvailable = ($undoCount -gt 0)
            undoCount     = $undoCount
            undoTimestamp = $undoTimestamp
            error         = $null
        }
    } catch {
        return @{
            type          = "FILE_ORGANIZER_STATE"
            userFolders   = @()
            defaultRules  = @(Get-DefaultMediaRules)
            defaultRoot   = (Join-Path $env:USERPROFILE "Organized")
            undoAvailable = $false
            undoCount     = 0
            undoTimestamp = ""
            error         = $_.Exception.Message
        }
    }
}

function Sanitize-SubfolderName {
    param([string]$Name)
    if (-not $Name) { return "" }
    $clean = $Name.Trim() -replace '[:*?"<>|]', ''
    $clean = $clean.Trim('\', '/')
    # Prevent path traversal
    $segments = $clean -split '[\\/]+' | Where-Object { $_ -and $_ -ne '.' -and $_ -ne '..' }
    return ($segments -join '\')
}

function Build-OrganizerPlan {
    param($Payload)

    $sourceFolders = @($Payload.folders | ForEach-Object { ([string]$_).Trim().TrimEnd('\') } | Where-Object { $_ } | Select-Object -Unique)
    if ($sourceFolders.Count -eq 0) {
        throw "Select at least one folder to organize."
    }

    $mode = if ($Payload.mode -eq "extension") { "extension" } else { "media" }
    $destMode = if ($Payload.destMode -eq "unified") { "unified" } else { "inplace" }
    $unifiedRoot = if ($Payload.unifiedRoot) { ([string]$Payload.unifiedRoot).Trim().TrimEnd('\') } else { "" }
    $includeSubfolders = [bool]$Payload.includeSubfolders
    $duplicateMode = if ($Payload.duplicateMode -eq "skip") { "skip" } else { "rename" }

    if ($destMode -eq "unified") {
        if (-not $unifiedRoot -or (Test-IsProtectedOrganizerPath -FolderPath $unifiedRoot)) {
            throw "Choose a valid non-system destination root folder (e.g. D:\Organized)."
        }
    }

    # Build lookup structures for Media Type mode or Extension mode
    $mediaExtMap = @{}
    $reservedTargetNames = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)

    if ($mode -eq "media") {
        $rules = @($Payload.mediaRules)
        foreach ($r in $rules) {
            if (-not $r.enabled) { continue }
            $folderName = Sanitize-SubfolderName -Name ([string]$r.folderName)
            if (-not $folderName) { continue }
            $null = $reservedTargetNames.Add(($folderName -split '\\')[0])

            $rawExts = ([string]$r.extensions) -split '[,;\s]+'
            foreach ($e in $rawExts) {
                $norm = $e.Trim().ToLowerInvariant()
                if (-not $norm) { continue }
                if (-not $norm.StartsWith('.')) { $norm = ".$norm" }
                if (-not $mediaExtMap.ContainsKey($norm)) {
                    $mediaExtMap[$norm] = @{
                        folderName = $folderName
                        ruleLabel  = if ($r.label) { [string]$r.label } else { $folderName }
                    }
                }
            }
        }
        if ($mediaExtMap.Count -eq 0) {
            throw "Enable at least one Media Type rule with valid extensions."
        }
    } else {
        $extTemplate = if ($Payload.extFolderTemplate) { ([string]$Payload.extFolderTemplate).Trim() } else { "{EXT}" }
        $extFilterSet = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)
        if ($Payload.extFilter) {
            foreach ($e in (([string]$Payload.extFilter) -split '[,;\s]+')) {
                $norm = $e.Trim().ToLowerInvariant()
                if (-not $norm) { continue }
                if (-not $norm.StartsWith('.')) { $norm = ".$norm" }
                $null = $extFilterSet.Add($norm)
            }
        }
        $extOverrides = @{}
        foreach ($ov in @($Payload.extOverrides)) {
            $ext = ([string]$ov.extension).Trim().ToLowerInvariant()
            $folder = Sanitize-SubfolderName -Name ([string]$ov.folderName)
            if ($ext -and $folder) {
                if (-not $ext.StartsWith('.')) { $ext = ".$ext" }
                $extOverrides[$ext] = $folder
                $null = $reservedTargetNames.Add(($folder -split '\\')[0])
            }
        }
    }

    $skipExtensions = @('.lnk', '.url', '.ini', '.tmp', '.temp', '.crdownload', '.part', '.download', '.opdownload', '.partial')
    $plan = New-Object System.Collections.Generic.List[PSCustomObject]
    $skippedCount = 0
    $totalBytes = 0L
    $folderCounts = @{}
    $claimedDestinations = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)

    foreach ($srcFolder in $sourceFolders) {
        if (Test-IsProtectedOrganizerPath -FolderPath $srcFolder) {
            throw "Protected system folder cannot be organized: $srcFolder"
        }
        if (-not (Test-Path -LiteralPath $srcFolder -PathType Container)) {
            continue
        }

        $srcFull = [System.IO.Path]::GetFullPath($srcFolder).TrimEnd('\')
        $files = if ($includeSubfolders) {
            Get-ChildItem -LiteralPath $srcFull -File -Recurse -ErrorAction SilentlyContinue
        } else {
            Get-ChildItem -LiteralPath $srcFull -File -ErrorAction SilentlyContinue
        }

        foreach ($file in $files) {
            # Skip hidden/system files, desktop.ini, shortcuts, and active partial downloads
            if (($file.Attributes -band [System.IO.FileAttributes]::System) -or ($file.Attributes -band [System.IO.FileAttributes]::Hidden)) {
                $skippedCount++
                continue
            }
            if ($file.Name -ieq "desktop.ini" -or $file.Name -ieq "thumbs.db") {
                $skippedCount++
                continue
            }
            $extLower = $file.Extension.ToLowerInvariant()
            if (-not $extLower -or $skipExtensions -contains $extLower) {
                $skippedCount++
                continue
            }

            $targetSubfolder = ""
            $ruleLabel = ""

            if ($mode -eq "media") {
                if (-not $mediaExtMap.ContainsKey($extLower)) {
                    $skippedCount++
                    continue
                }
                $hit = $mediaExtMap[$extLower]
                $targetSubfolder = $hit.folderName
                $ruleLabel = $hit.ruleLabel
            } else {
                if ($extFilterSet.Count -gt 0 -and -not $extFilterSet.Contains($extLower)) {
                    $skippedCount++
                    continue
                }
                $extClean = $extLower.TrimStart('.').ToUpperInvariant()
                if ($extOverrides.ContainsKey($extLower)) {
                    $targetSubfolder = $extOverrides[$extLower]
                    $ruleLabel = "$extLower → $targetSubfolder"
                } else {
                    $rendered = $extTemplate -replace '\{EXT\}', $extClean -replace '\{ext\}', $extLower.TrimStart('.')
                    $targetSubfolder = Sanitize-SubfolderName -Name $rendered
                    if (-not $targetSubfolder) { $targetSubfolder = $extClean }
                    $ruleLabel = "Extension ($extLower)"
                }
            }

            $baseDestDir = if ($destMode -eq "unified") { $unifiedRoot } else { $srcFull }
            $destDir = Join-Path $baseDestDir $targetSubfolder

            # Skip if the file is already sitting inside its destination folder
            if ($file.DirectoryName.TrimEnd('\') -ieq $destDir.TrimEnd('\')) {
                $skippedCount++
                continue
            }

            # If recursive in-place, avoid pulling files back out of an already-organized target folder
            if ($includeSubfolders -and $destMode -eq "inplace" -and $reservedTargetNames.Count -gt 0) {
                $relPath = $file.DirectoryName.Substring($srcFull.Length).TrimStart('\')
                if ($relPath) {
                    $firstSeg = ($relPath -split '\\')[0]
                    if ($reservedTargetNames.Contains($firstSeg)) {
                        $skippedCount++
                        continue
                    }
                }
            }

            # Resolve target filename with duplicate handling
            $destPath = Join-Path $destDir $file.Name
            $renamed = $false
            if ((Test-Path -LiteralPath $destPath) -or $claimedDestinations.Contains($destPath)) {
                if ($duplicateMode -eq "skip") {
                    $skippedCount++
                    continue
                }
                $baseName = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
                $extRaw = $file.Extension
                $idx = 1
                do {
                    $candidate = Join-Path $destDir "$baseName ($idx)$extRaw"
                    $idx++
                } while ((Test-Path -LiteralPath $candidate) -or $claimedDestinations.Contains($candidate))
                $destPath = $candidate
                $renamed = $true
            }

            $null = $claimedDestinations.Add($destPath)
            $totalBytes += [long]$file.Length

            if (-not $folderCounts.ContainsKey($destDir)) { $folderCounts[$destDir] = 0 }
            $folderCounts[$destDir]++

            $plan.Add([PSCustomObject]@{
                fileName     = [string]$file.Name
                destFileName = [System.IO.Path]::GetFileName($destPath)
                extension    = $extLower
                sourceDir    = [string]$file.DirectoryName
                sourcePath   = [string]$file.FullName
                destDir      = [string]$destDir
                destPath     = [string]$destPath
                targetFolder = [string]$targetSubfolder
                ruleLabel    = [string]$ruleLabel
                sizeBytes    = [long]$file.Length
                renamed      = [bool]$renamed
            })
        }
    }

    $targetBreakdown = foreach ($kv in ($folderCounts.GetEnumerator() | Sort-Object Value -Descending)) {
        [PSCustomObject]@{
            destDir = [string]$kv.Key
            count   = [int]$kv.Value
        }
    }

    return @{
        items           = $plan.ToArray()
        matchedCount    = $plan.Count
        skippedCount    = $skippedCount
        totalBytes      = $totalBytes
        totalMB         = [math]::Round(($totalBytes / 1MB), 2)
        targetBreakdown = @($targetBreakdown)
    }
}

function Invoke-FileOrganizerAction {
    param(
        [Parameter(Mandatory = $true)]
        $Payload,
        [string]$RootPath = ""
    )

    if ($Payload -is [string]) {
        $Payload = $Payload | ConvertFrom-Json
    }
    if ($null -eq $Payload -or $null -eq $Payload.command) { return $null }

    $cmd = [string]$Payload.command

    try {
        if ($cmd -eq "OPEN_ORGANIZER_FOLDER") {
            $path = [string]$Payload.path
            if ($path -and (Test-Path -LiteralPath $path -PathType Container)) {
                Start-Process "explorer.exe" -ArgumentList "`"$path`""
                return @{
                    type    = "FILE_ORGANIZER_NOTICE"
                    message = "Opened folder [$path] in Windows Explorer."
                    error   = $null
                }
            }
            throw "Folder not found on disk: $path"
        }
        elseif ($cmd -eq "PREVIEW_ORGANIZE") {
            $plan = Build-OrganizerPlan -Payload $Payload
            $previewItems = if ($plan.items.Count -gt 400) { @($plan.items | Select-Object -First 400) } else { @($plan.items) }
            return @{
                type            = "FILE_ORGANIZER_PREVIEW"
                matchedCount    = $plan.matchedCount
                skippedCount    = $plan.skippedCount
                totalMB         = $plan.totalMB
                truncated       = ($plan.items.Count -gt 400)
                targetBreakdown = $plan.targetBreakdown
                items           = $previewItems
                message         = "Dry-run preview ready: $($plan.matchedCount) files ($($plan.totalMB) MB) queued across $($plan.targetBreakdown.Count) target folders."
                error           = $null
            }
        }
        elseif ($cmd -eq "EXECUTE_ORGANIZE") {
            $plan = Build-OrganizerPlan -Payload $Payload
            if ($plan.matchedCount -eq 0) {
                return @{
                    type          = "FILE_ORGANIZER_RESULT"
                    movedCount    = 0
                    failedCount   = 0
                    skippedCount  = $plan.skippedCount
                    totalMB       = 0
                    undoAvailable = $false
                    undoCount     = 0
                    errors        = @()
                    message       = "No files needed organizing based on your current rules."
                    error         = $null
                }
            }

            $movedLog = New-Object System.Collections.Generic.List[PSCustomObject]
            $createdDirs = New-Object System.Collections.Generic.List[string]
            $errorList = New-Object System.Collections.Generic.List[string]
            $movedBytes = 0L

            foreach ($item in $plan.items) {
                try {
                    if (-not (Test-Path -LiteralPath $item.destDir -PathType Container)) {
                        $null = New-Item -ItemType Directory -Path $item.destDir -Force -ErrorAction Stop
                        $createdDirs.Add($item.destDir)
                    }
                    Move-Item -LiteralPath $item.sourcePath -Destination $item.destPath -ErrorAction Stop
                    $movedBytes += [long]$item.sizeBytes
                    $movedLog.Add([PSCustomObject]@{
                        from = $item.sourcePath
                        to   = $item.destPath
                    })
                } catch {
                    $errorList.Add("$($item.fileName): $($_.Exception.Message)")
                }
            }

            if ($RootPath -and $movedLog.Count -gt 0) {
                $undoPath = Get-UndoManifestPath -RootPath $RootPath
                $manifest = [PSCustomObject]@{
                    timestamp   = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
                    moves       = $movedLog.ToArray()
                    createdDirs = @($createdDirs | Select-Object -Unique)
                }
                $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $undoPath -Encoding UTF8
            }

            $movedMB = [math]::Round(($movedBytes / 1MB), 2)
            $stateRefresh = Get-FileOrganizerState -RootPath $RootPath
            return @{
                type          = "FILE_ORGANIZER_RESULT"
                movedCount    = $movedLog.Count
                failedCount   = $errorList.Count
                skippedCount  = $plan.skippedCount
                totalMB       = $movedMB
                undoAvailable = ($movedLog.Count -gt 0)
                undoCount     = $movedLog.Count
                userFolders   = $stateRefresh.userFolders
                errors        = @($errorList | Select-Object -First 20)
                message       = "Organized $($movedLog.Count) files ($movedMB MB)$(if ($errorList.Count -gt 0) { " ($($errorList.Count) skipped due to errors)" })."
                error         = $null
            }
        }
        elseif ($cmd -eq "UNDO_ORGANIZE") {
            if (-not $RootPath) { throw "Undo path unavailable." }
            $undoPath = Get-UndoManifestPath -RootPath $RootPath
            if (-not (Test-Path -LiteralPath $undoPath -PathType Leaf)) {
                throw "No previous organization run found to undo."
            }

            $manifest = Get-Content -LiteralPath $undoPath -Raw | ConvertFrom-Json
            $moves = @($manifest.moves)
            $restored = 0
            $failed = 0

            # Reverse order for clean restoration
            for ($i = $moves.Count - 1; $i -ge 0; $i--) {
                $m = $moves[$i]
                try {
                    if (Test-Path -LiteralPath $m.to -PathType Leaf) {
                        $origDir = [System.IO.Path]::GetDirectoryName([string]$m.from)
                        if ($origDir -and -not (Test-Path -LiteralPath $origDir)) {
                            $null = New-Item -ItemType Directory -Path $origDir -Force -ErrorAction SilentlyContinue
                        }
                        if (-not (Test-Path -LiteralPath $m.from)) {
                            Move-Item -LiteralPath $m.to -Destination $m.from -ErrorAction Stop
                            $restored++
                        } else {
                            $failed++
                        }
                    }
                } catch {
                    $failed++
                }
            }

            # Clean up any newly created directories that are now empty
            foreach ($dir in @($manifest.createdDirs | Sort-Object Length -Descending)) {
                try {
                    if ($dir -and (Test-Path -LiteralPath $dir -PathType Container)) {
                        $remaining = @(Get-ChildItem -LiteralPath $dir -Force -ErrorAction SilentlyContinue)
                        if ($remaining.Count -eq 0) {
                            Remove-Item -LiteralPath $dir -Force -ErrorAction SilentlyContinue
                        }
                    }
                } catch {}
            }

            Remove-Item -LiteralPath $undoPath -Force -ErrorAction SilentlyContinue
            $stateRefresh = Get-FileOrganizerState -RootPath $RootPath

            return @{
                type          = "FILE_ORGANIZER_RESULT"
                movedCount    = $restored
                failedCount   = $failed
                skippedCount  = 0
                totalMB       = 0
                undoAvailable = $false
                undoCount     = 0
                userFolders   = $stateRefresh.userFolders
                errors        = @()
                message       = "Undo complete: restored $restored files back to their original locations$(if ($failed -gt 0) { " ($failed could not be restored)" })."
                error         = $null
            }
        }
        else {
            throw "Unsupported File Organizer command: $cmd"
        }
    } catch {
        return @{
            type    = "FILE_ORGANIZER_ERROR"
            message = $null
            error   = $_.Exception.Message
        }
    }
}
