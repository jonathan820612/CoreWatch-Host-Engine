function Get-SharingCenterState {
    $shares = @(Get-SmbShare -ErrorAction Stop | Sort-Object Name | ForEach-Object {
        $share = $_
        $path = [string]$share.Path
        $folder = if ($path -and (Test-Path -LiteralPath $path -PathType Container)) { Get-Item -LiteralPath $path -ErrorAction SilentlyContinue } else { $null }
        $bytes = $null
        if ($folder -and -not $share.Special) {
            try {
                $sum = Get-ChildItem -LiteralPath $path -File -Recurse -Force -ErrorAction Stop | Measure-Object -Property Length -Sum
                $bytes = [long]$sum.Sum
            } catch { $bytes = $null }
        }
        $access = @()
        $accessError = $null
        try {
            $access = @(Get-SmbShareAccess -Name $share.Name -ErrorAction Stop | ForEach-Object {
                @{ account = [string]$_.AccountName; right = [string]$_.AccessRight; type = [string]$_.AccessControlType }
            })
        } catch { $accessError = $_.Exception.Message }
        [PSCustomObject]@{
            name = [string]$share.Name
            path = $path
            networkPath = '\\{0}\{1}' -f $(if ($share.ScopeName -and $share.ScopeName -ne '*') { [string]$share.ScopeName } else { [string]$env:COMPUTERNAME }), [string]$share.Name
            description = [string]$share.Description
            special = [bool]$share.Special
            sizeBytes = $bytes
            created = if ($folder) { $folder.CreationTime.ToString('o') } else { $null }
            modified = if ($folder) { $folder.LastWriteTime.ToString('o') } else { $null }
            scope = [string]$share.ScopeName
            access = $access
            accessError = $accessError
        }
    })
    return @{ type = 'SHARING_CENTER'; shares = $shares; error = $null }
}

function Invoke-SharingCenterAction {
    param([Parameter(Mandatory)]$Payload)
    $name = [string]$Payload.name
    if ($name -notmatch '^[^\\/\[\]:;|=,+*?<>"\s][^\\/\[\]:;|=,+*?<>"]{0,79}$') { throw 'Enter a valid share name (up to 80 characters).' }

    if ($Payload.command -eq 'CREATE_SHARE') {
        $path = [string]$Payload.path
        if (-not [System.IO.Path]::IsPathRooted($path) -or -not (Test-Path -LiteralPath $path -PathType Container)) { throw 'Choose an existing local folder.' }
        $folder = Get-Item -LiteralPath $path -ErrorAction Stop
        if ($folder.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'Linked folders cannot be shared here.' }
        New-SmbShare -Name $name -Path $folder.FullName -Description ([string]$Payload.description) -ErrorAction Stop | Out-Null
        return
    }

    $share = Get-SmbShare -Name $name -ErrorAction Stop
    if ($share.Special) { throw 'Windows system shares cannot be changed here.' }
    if ($Payload.command -in @('GRANT_SHARE_ACCESS', 'REMOVE_SHARE_ACCESS')) {
        $account = ([string]$Payload.account).Trim()
        if (-not $account -or $account.Length -gt 256 -or $account -match '[\r\n]') { throw 'Enter a valid user or group name.' }
        try { $null = (New-Object System.Security.Principal.NTAccount($account)).Translate([System.Security.Principal.SecurityIdentifier]) }
        catch { throw "Windows could not find the user or group '$account'." }
        $current = @(Get-SmbShareAccess -Name $name -ErrorAction Stop | Where-Object { $_.AccountName -eq $account })
        if ($Payload.command -eq 'GRANT_SHARE_ACCESS') {
            $right = [string]$Payload.right
            if ($right -notin @('Read', 'Change', 'Full')) { throw 'Choose Read, Change, or Full access.' }
            if (@($current | Where-Object { $_.AccessControlType -eq 'Deny' }).Count) { throw 'Remove the deny entry before granting access.' }
            Grant-SmbShareAccess -Name $name -AccountName $account -AccessRight $right -Force -ErrorAction Stop | Out-Null
        } else {
            if (-not $current.Count) { throw 'That permission no longer exists. Refresh the list.' }
            if (@($current | Where-Object { $_.AccessControlType -eq 'Allow' }).Count) {
                Revoke-SmbShareAccess -Name $name -AccountName $account -Force -ErrorAction Stop | Out-Null
            }
            if (@($current | Where-Object { $_.AccessControlType -eq 'Deny' }).Count) {
                Unblock-SmbShareAccess -Name $name -AccountName $account -Force -ErrorAction Stop | Out-Null
            }
        }
        return
    }
    if ($Payload.command -eq 'REMOVE_SHARE') {
        Remove-SmbShare -Name $name -Force -ErrorAction Stop
        return
    }
    if ($Payload.command -eq 'DELETE_SHARED_FOLDER') {
        $path = [string]$share.Path
        $folder = Get-Item -LiteralPath $path -ErrorAction Stop
        if (-not $folder.PSIsContainer -or ($folder.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) { throw 'This folder cannot be deleted here.' }
        $fullPath = [System.IO.Path]::GetFullPath($folder.FullName).TrimEnd('\')
        $root = [System.IO.Path]::GetPathRoot($fullPath).TrimEnd('\')
        if ($fullPath -eq $root -or $fullPath -match '^[A-Za-z]:\\(Windows|Program Files(?: \(x86\))?|ProgramData)(\\|$)') { throw 'Protected folder cannot be deleted.' }
        if ([string]$Payload.confirmName -cne $name -or [string]$Payload.confirmPath -cne $path) { throw 'Deletion confirmation did not match.' }
        $otherShares = @(Get-SmbShare -ErrorAction Stop | Where-Object { $_.Name -ne $name -and $_.Path -and ([System.IO.Path]::GetFullPath($_.Path).TrimEnd('\') -eq $fullPath -or [System.IO.Path]::GetFullPath($_.Path).StartsWith($fullPath + '\', [System.StringComparison]::OrdinalIgnoreCase)) })
        if ($otherShares.Count) { throw 'Other shares use this folder or a subfolder.' }
        Remove-SmbShare -Name $name -Force -ErrorAction Stop
        Remove-Item -LiteralPath $fullPath -Recurse -Force -ErrorAction Stop
        return
    }
    throw 'Unsupported sharing action.'
}
