# File: modules/tabs/SshCertsManager.ps1
# =========================================================================
# COREWATCH SSH HOST LAUNCHER & WINDOWS CERTIFICATE INSPECTOR
#   - Visual %USERPROFILE%\.ssh\config parser/editor + 1-click Windows Terminal SSH
#   - SSH Key inventory + public key viewer + ed25519 key generator
#   - Windows TLS & Code-Signing Certificate expiry auditor (LocalMachine + CurrentUser)
# =========================================================================

function Get-SshDir {
    $d = Join-Path $env:USERPROFILE ".ssh"
    if (-not (Test-Path -LiteralPath $d)) { $null = New-Item -ItemType Directory -Path $d -Force }
    return $d
}

function Get-ParsedSshConfigHosts {
    $cfgPath = Join-Path (Get-SshDir) "config"
    $hosts = New-Object System.Collections.Generic.List[object]
    if (-not (Test-Path -LiteralPath $cfgPath -PathType Leaf)) { return @() }

    $cur = $null
    foreach ($rawLine in (Get-Content -LiteralPath $cfgPath -ErrorAction SilentlyContinue)) {
        $line = $rawLine.Trim()
        if (-not $line -or $line.StartsWith("#")) { continue }
        if ($line -match '^(?i)Host\s+(.+)$') {
            if ($cur) { $hosts.Add([PSCustomObject]$cur) }
            $alias = $Matches[1].Trim()
            if ($alias -eq "*") { $cur = $null; continue }
            $cur = [ordered]@{
                alias        = $alias
                hostName     = ""
                user         = ""
                port         = "22"
                identityFile = ""
                proxyJump    = ""
            }
        } elseif ($cur -and $line -match '^([A-Za-z]+)\s+(.+)$') {
            $k = $Matches[1].ToLowerInvariant()
            $v = $Matches[2].Trim().Trim('"')
            switch ($k) {
                "hostname"     { $cur["hostName"]     = $v }
                "user"         { $cur["user"]         = $v }
                "port"         { $cur["port"]         = $v }
                "identityfile" { $cur["identityFile"] = $v }
                "proxyjump"    { $cur["proxyJump"]    = $v }
            }
        }
    }
    if ($cur) { $hosts.Add([PSCustomObject]$cur) }
    return $hosts.ToArray()
}

function Save-SshConfigHostBlock {
    param([Parameter(Mandatory)][System.Collections.IDictionary]$HostObj, [switch]$DeleteOnly)
    $cfgPath = Join-Path (Get-SshDir) "config"
    $targetAlias = ([string]$HostObj["alias"]).Trim()
    if (-not $targetAlias -or $targetAlias -match '\s') { throw "Host alias is required (no spaces)." }

    $lines = if (Test-Path -LiteralPath $cfgPath -PathType Leaf) { @(Get-Content -LiteralPath $cfgPath) } else { @() }
    $out = New-Object System.Collections.Generic.List[string]
    $skipping = $false
    foreach ($ln in $lines) {
        if ($ln.Trim() -match '^(?i)Host\s+(.+)$') {
            $thisAlias = $Matches[1].Trim()
            $skipping = $thisAlias.Equals($targetAlias, [System.StringComparison]::OrdinalIgnoreCase)
        }
        if (-not $skipping) { $out.Add($ln) }
    }

    if (-not $DeleteOnly) {
        $hn = ([string]($HostObj["hostName"] ?? "")).Trim()
        if (-not $hn) { throw "HostName (IP or domain) is required." }
        if ($out.Count -gt 0 -and $out[$out.Count - 1].Trim() -ne "") { $out.Add("") }
        $out.Add("Host $targetAlias")
        $out.Add("    HostName $hn")
        $u = ([string]($HostObj["user"] ?? "")).Trim()
        if ($u) { $out.Add("    User $u") }
        $p = ([string]($HostObj["port"] ?? "22")).Trim()
        if ($p -and $p -ne "22") { $out.Add("    Port $p") }
        $idF = ([string]($HostObj["identityFile"] ?? "")).Trim()
        if ($idF) { $out.Add("    IdentityFile $idF") }
        $pj = ([string]($HostObj["proxyJump"] ?? "")).Trim()
        if ($pj) { $out.Add("    ProxyJump $pj") }
    }

    [System.IO.File]::WriteAllText($cfgPath, (($out.ToArray()) -join "`r`n") + "`r`n", (New-Object System.Text.UTF8Encoding($false)))
}

function Get-LocalSshKeys {
    $dir = Get-SshDir
    $keys = New-Object System.Collections.Generic.List[object]
    $keygen = Get-Command ssh-keygen -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath $dir -Filter "*.pub" -File -ErrorAction SilentlyContinue | ForEach-Object {
        $pubTxt = (Get-Content -LiteralPath $_.FullName -Raw -ErrorAction SilentlyContinue)
        $pubTrim = if ($pubTxt) { $pubTxt.Trim() } else { "" }
        $keyType = if ($pubTrim -match '^(\S+)') { $Matches[1] } else { "key" }
        $fp = ""
        if ($keygen) {
            try {
                $fpOut = (& $keygen.Source -lf $_.FullName 2>$null | Out-String).Trim()
                if ($fpOut) { $fp = $fpOut }
            } catch {}
        }
        $privPath = $_.FullName.Substring(0, $_.FullName.Length - 4)
        $keys.Add([PSCustomObject]@{
            name        = $_.BaseName
            type        = $keyType
            fingerprint = $fp
            publicKey   = $pubTrim
            hasPrivate  = (Test-Path -LiteralPath $privPath -PathType Leaf)
            path        = $privPath
        })
    }
    return $keys.ToArray()
}

function Get-WindowsCertificateAudit {
    $now = [datetime]::Now
    $list = New-Object System.Collections.Generic.List[object]
    $stores = @(
        @{ label = "LocalMachine\My"; path = "Cert:\LocalMachine\My" },
        @{ label = "CurrentUser\My";  path = "Cert:\CurrentUser\My" }
    )
    foreach ($st in $stores) {
        try {
            Get-ChildItem -Path $st.path -ErrorAction SilentlyContinue | ForEach-Object {
                $daysLeft = [int][math]::Floor(($_.NotAfter - $now).TotalDays)
                $status = if ($daysLeft -lt 0) { "expired" } elseif ($daysLeft -le 30) { "expiring" } else { "valid" }
                $subj = ([string]$_.Subject) -replace '^CN=',''
                if ($subj.Contains(',')) { $subj = $subj.Split(',')[0] }
                $iss = ([string]$_.Issuer) -replace '^CN=',''
                if ($iss.Contains(',')) { $iss = $iss.Split(',')[0] }
                $list.Add([PSCustomObject]@{
                    store      = $st.label
                    subject    = $subj.Trim()
                    issuer     = $iss.Trim()
                    thumbprint = [string]$_.Thumbprint
                    notAfter   = $_.NotAfter.ToString("yyyy-MM-dd")
                    daysLeft   = $daysLeft
                    status     = $status
                    hasPrivKey = [bool]$_.HasPrivateKey
                })
            }
        } catch {}
    }
    return ($list.ToArray() | Sort-Object daysLeft)
}

function Get-SshCertsState {
    param([string]$Notice = "", [bool]$NoticeError = $false)
    $hosts = @(Get-ParsedSshConfigHosts)
    $keys  = @(Get-LocalSshKeys)
    $certs = @(Get-WindowsCertificateAudit)
    $expiringCnt = (@($certs | Where-Object { $_.status -in @("expired", "expiring") })).Count
    return [ordered]@{
        type          = "SSH_CERTS_STATE"
        sshAvailable  = ($null -ne (Get-Command ssh -ErrorAction SilentlyContinue))
        configPath    = (Join-Path (Get-SshDir) "config")
        hosts         = $hosts
        keys          = $keys
        certs         = $certs
        expiringCount = $expiringCnt
        notice        = $Notice
        noticeError   = $NoticeError
    }
}

function Invoke-SshCertsAction {
    param(
        [Parameter(Mandatory)][string]$RawJson,
        [Parameter(Mandatory)][string]$RootPath
    )
    $payload = $RawJson | ConvertFrom-Json -AsHashtable
    $cmd = [string]$payload["command"]
    try {
        switch ($cmd) {
            "SSH_LOAD" {
                return (Get-SshCertsState)
            }
            "SSH_LAUNCH_HOST" {
                $alias = ([string]($payload["alias"] ?? "")).Trim()
                if (-not $alias) { throw "SSH host alias is required." }
                $wt = Get-Command wt.exe -ErrorAction SilentlyContinue
                if ($wt) {
                    Start-Process -FilePath $wt.Source -ArgumentList @("new-tab", "--title", "SSH: $alias", "ssh", $alias)
                } else {
                    Start-Process -FilePath "ssh.exe" -ArgumentList @($alias)
                }
                return @{ type = "SSH_CERTS_NOTICE"; ok = $true; message = "Launched SSH session to '$alias'." }
            }
            "SSH_SAVE_HOST" {
                $h = $payload["host"]
                if (-not ($h -is [System.Collections.IDictionary])) { throw "Invalid SSH host payload." }
                Save-SshConfigHostBlock -HostObj $h
                return (Get-SshCertsState -Notice "Saved SSH host '$($h['alias'])' to ~/.ssh/config.")
            }
            "SSH_DELETE_HOST" {
                $alias = ([string]($payload["alias"] ?? "")).Trim()
                Save-SshConfigHostBlock -HostObj @{ alias = $alias } -DeleteOnly
                return (Get-SshCertsState -Notice "Removed SSH host '$alias' from ~/.ssh/config.")
            }
            "SSH_GEN_KEY" {
                $kName = (([string]($payload["name"] ?? "id_ed25519_corewatch")).Trim() -replace '[^A-Za-z0-9._-]','')
                $comment = ([string]($payload["comment"] ?? "$($env:USERNAME)@$($env:COMPUTERNAME)")).Trim()
                if (-not $kName) { throw "Enter a valid key filename." }
                $dest = Join-Path (Get-SshDir) $kName
                if (Test-Path -LiteralPath $dest -PathType Leaf) { throw "Key '$kName' already exists in ~/.ssh/." }
                $kg = Get-Command ssh-keygen -ErrorAction SilentlyContinue
                if (-not $kg) { throw "OpenSSH ssh-keygen.exe is not installed on PATH." }
                $out = & $kg.Source -t ed25519 -C $comment -f $dest -N '""' 2>&1
                if ($LASTEXITCODE -ne 0) { throw "ssh-keygen failed: $($out -join ' ')" }
                return (Get-SshCertsState -Notice "Generated new ed25519 keypair: ~/.ssh/$kName")
            }
            "SSH_OPEN_CONFIG" {
                $cfgPath = Join-Path (Get-SshDir) "config"
                if (-not (Test-Path -LiteralPath $cfgPath)) { $null = New-Item -ItemType File -Path $cfgPath -Force }
                Start-Process "notepad.exe" -ArgumentList "`"$cfgPath`""
                return @{ type = "SSH_CERTS_NOTICE"; ok = $true; message = "Opened $cfgPath in Notepad." }
            }
            "SSH_TEST_HOST" {
                $hn = ([string]($payload["hostName"] ?? "")).Trim()
                $pt = [int]($payload["port"] ?? 22)
                if (-not $hn) { throw "HostName is required to test TCP connectivity." }
                $sw = [System.Diagnostics.Stopwatch]::StartNew()
                $tcp = New-Object System.Net.Sockets.TcpClient
                try {
                    $iar = $tcp.BeginConnect($hn, $pt, $null, $null)
                    $okConn = $iar.AsyncWaitHandle.WaitOne(2500, $false)
                    if ($okConn -and $tcp.Connected) {
                        $tcp.EndConnect($iar)
                        $sw.Stop()
                        return @{ type = "SSH_CERTS_NOTICE"; ok = $true; message = "TCP $hn`:$pt reachable in $([int]$sw.ElapsedMilliseconds) ms." }
                    }
                    throw "Timed out connecting to ${hn}:${pt} after 2.5s."
                } finally {
                    $tcp.Close()
                }
            }
            "SSH_OPEN_CERTMGR" {
                Start-Process "certmgr.msc"
                return @{ type = "SSH_CERTS_NOTICE"; ok = $true; message = "Opened Windows Certificate Manager (certmgr.msc)." }
            }
            default { throw "Unknown SSH & Certs command: $cmd" }
        }
    } catch {
        return @{ type = "SSH_CERTS_NOTICE"; ok = $false; error = $_.Exception.Message }
    }
}
