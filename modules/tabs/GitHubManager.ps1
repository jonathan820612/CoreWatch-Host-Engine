# File: modules/tabs/GitHubManager.ps1
# =========================================================================
# COREWATCH GITHUB MANAGER
#   - Auth: Auto-detects GitHub CLI (gh) auth OR DPAPI-encrypted PAT fallback
#   - Local Projects: Scans configured Projects Root -> VS Code, Terminal,
#                     Explorer, Fetch/Pull, Branch/Dirty/Ahead-Behind status
#   - My Repos & Clone: Search/filter own repos, clone to Projects Root,
#                       plus dedicated "Clone Any Git URL" to custom path
#   - Releases: List, Create (with Draft/Pre-release + Auto-Notes + Asset),
#               Upload Assets, Delete, and local Publish-Release.ps1 trigger
# =========================================================================

$script:GitHubSecretKey = "github_pat"

function Get-GitExecutablePath {
    $cmd = Get-Command "git.exe" -ErrorAction SilentlyContinue
    if (-not $cmd) { $cmd = Get-Command "git" -ErrorAction SilentlyContinue }
    if ($cmd -and $cmd.Source) { return [string]$cmd.Source }
    foreach ($cand in @("C:\Program Files\Git\cmd\git.exe", "C:\Program Files\Git\bin\git.exe")) {
        if (Test-Path -LiteralPath $cand -PathType Leaf) { return $cand }
    }
    return ""
}

function Get-GhCliExecutablePath {
    $cmd = Get-Command "gh.exe" -ErrorAction SilentlyContinue
    if (-not $cmd) { $cmd = Get-Command "gh" -ErrorAction SilentlyContinue }
    if ($cmd -and $cmd.Source) { return [string]$cmd.Source }
    foreach ($cand in @("C:\Program Files\GitHub CLI\gh.exe", (Join-Path $env:LOCALAPPDATA "Programs\GitHub CLI\gh.exe"))) {
        if ($cand -and (Test-Path -LiteralPath $cand -PathType Leaf)) { return $cand }
    }
    return ""
}

function Get-GitHubAuthContext {
    param([Parameter(Mandatory)][string]$RootPath)
    $settingsScript = Join-Path $RootPath "modules\core\CoreWatchSettings.ps1"
    if (Test-Path -LiteralPath $settingsScript -PathType Leaf) { . $settingsScript }

    $ghExe = Get-GhCliExecutablePath
    $pat   = ""
    try { $pat = Get-CoreWatchSecret -Key $script:GitHubSecretKey } catch {}

    # 1. Prefer saved DPAPI PAT if explicitly configured
    if ($pat) {
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            $hdr = @{
                "Authorization"        = "Bearer $pat"
                "Accept"               = "application/vnd.github+json"
                "User-Agent"           = "CoreWatch-GitHubManager"
                "X-GitHub-Api-Version" = "2022-11-28"
            }
            $u = Invoke-RestMethod -Uri "https://api.github.com/user" -Headers $hdr -TimeoutSec 8 -ErrorAction Stop
            return @{
                authenticated = $true
                source        = "PAT"
                username      = [string]$u.login
                displayName   = if ($u.name) { [string]$u.name } else { [string]$u.login }
                token         = $pat
                ghExe         = $ghExe
                hasPat        = $true
            }
        } catch {}
    }

    # 2. Auto-detect logged-in GitHub CLI (gh) token cleanly
    if ($ghExe) {
        try {
            $ghToken = ((& $ghExe auth token 2>$null) | Out-String).Trim()
            if ($LASTEXITCODE -eq 0 -and $ghToken) {
                [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
                $hdr = @{
                    "Authorization"        = "Bearer $ghToken"
                    "Accept"               = "application/vnd.github+json"
                    "User-Agent"           = "CoreWatch-GitHubManager"
                    "X-GitHub-Api-Version" = "2022-11-28"
                }
                $u = Invoke-RestMethod -Uri "https://api.github.com/user" -Headers $hdr -TimeoutSec 8 -ErrorAction Stop
                return @{
                    authenticated = $true
                    source        = "gh CLI"
                    username      = [string]$u.login
                    displayName   = if ($u.name) { [string]$u.name } else { [string]$u.login }
                    token         = $ghToken
                    ghExe         = $ghExe
                    hasPat        = [bool](-not [string]::IsNullOrWhiteSpace($pat))
                }
            }
        } catch {}
    }

    return @{
        authenticated = $false
        source        = "None"
        username      = ""
        displayName   = ""
        token         = ""
        ghExe         = $ghExe
        hasPat        = [bool](-not [string]::IsNullOrWhiteSpace($pat))
    }
}

function Invoke-GitHubRestApi {
    param(
        [Parameter(Mandatory)][string]$Token,
        [Parameter(Mandatory)][string]$Endpoint,
        [string]$Method = "Get",
        $Body = $null
    )
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $uri = if ($Endpoint -match '^https://') { $Endpoint } else { "https://api.github.com/$($Endpoint.TrimStart('/'))" }
    $headers = @{
        "Authorization"        = "Bearer $Token"
        "Accept"               = "application/vnd.github+json"
        "User-Agent"           = "CoreWatch-GitHubManager"
        "X-GitHub-Api-Version" = "2022-11-28"
    }
    $params = @{
        Method      = $Method
        Uri         = $uri
        Headers     = $headers
        TimeoutSec  = 20
        ErrorAction = "Stop"
    }
    if ($null -ne $Body) {
        $json = if ($Body -is [string]) { $Body } else { $Body | ConvertTo-Json -Depth 8 }
        $params["Body"]        = [System.Text.Encoding]::UTF8.GetBytes($json)
        $params["ContentType"] = "application/json; charset=utf-8"
    }
    return (Invoke-RestMethod @params)
}

function Get-LocalGitRepositories {
    param([string]$ProjectsRoot)
    $gitExe = Get-GitExecutablePath
    $list = New-Object System.Collections.Generic.List[object]
    if (-not $ProjectsRoot -or -not (Test-Path -LiteralPath $ProjectsRoot -PathType Container)) {
        return @()
    }

    $candidates = New-Object System.Collections.Generic.List[string]
    if (Test-Path -LiteralPath (Join-Path $ProjectsRoot ".git")) {
        $candidates.Add($ProjectsRoot)
    }
    try {
        Get-ChildItem -LiteralPath $ProjectsRoot -Directory -ErrorAction SilentlyContinue | Sort-Object Name | ForEach-Object {
            if (Test-Path -LiteralPath (Join-Path $_.FullName ".git")) {
                $candidates.Add($_.FullName)
            }
        }
    } catch {}

    foreach ($repoPath in $candidates) {
        $name = Split-Path -Path $repoPath -Leaf
        $branch = "unknown"
        $dirtyCount = 0
        $ahead = 0
        $behind = 0
        $lastCommit = ""
        $lastDate = ""
        $remoteUrl = ""
        $repoSlug = ""

        if ($gitExe) {
            try {
                $stLines = @(& $gitExe -C $repoPath status --porcelain=v1 -b 2>$null)
                if ($stLines.Count -gt 0 -and $stLines[0] -match '^##\s+([^\.\s]+)') {
                    $branch = $Matches[1]
                    if ($stLines[0] -match 'ahead\s+(\d+)')  { $ahead  = [int]$Matches[1] }
                    if ($stLines[0] -match 'behind\s+(\d+)') { $behind = [int]$Matches[1] }
                }
                if ($stLines.Count -gt 1) {
                    $dirtyCount = ($stLines | Select-Object -Skip 1 | Where-Object { $_ -and $_.Trim() }).Count
                }
                $logLine = ((& $gitExe -C $repoPath log -1 --pretty=format:"%h|%cr|%s" 2>$null) | Out-String).Trim()
                if ($logLine -and $logLine -match '^([^|]+)\|([^|]+)\|(.*)$') {
                    $lastDate   = $Matches[2].Trim()
                    $lastCommit = "$($Matches[1].Trim()) $($Matches[3].Trim())"
                }
                $remoteUrl = ((& $gitExe -C $repoPath remote get-url origin 2>$null) | Out-String).Trim()
                if ($remoteUrl -match 'github\.com[:/]([^/]+/[^/\.]+?)(?:\.git)?$') {
                    $repoSlug = $Matches[1]
                }
            } catch {}
        }

        $hasPublishScript = Test-Path -LiteralPath (Join-Path $repoPath "build\Publish-Release.ps1") -PathType Leaf
        $list.Add([PSCustomObject]@{
            name             = $name
            path             = $repoPath
            branch           = $branch
            dirtyCount       = [int]$dirtyCount
            ahead            = [int]$ahead
            behind           = [int]$behind
            lastCommit       = $lastCommit
            lastDate         = $lastDate
            remoteUrl        = $remoteUrl
            repoSlug         = $repoSlug
            hasPublishScript = [bool]$hasPublishScript
        })
    }

    return $list.ToArray()
}

function Get-GitHubManagerState {
    param(
        [Parameter(Mandatory)][string]$RootPath,
        [string]$ProjectsRootOverride = "",
        [switch]$SkipRemoteRepos,
        [string]$Notice = "",
        [bool]$NoticeError = $false
    )
    $settingsScript = Join-Path $RootPath "modules\core\CoreWatchSettings.ps1"
    if (Test-Path -LiteralPath $settingsScript -PathType Leaf) { . $settingsScript }

    $appSet = Get-CoreWatchAppSettings
    $projectsRoot = if ($ProjectsRootOverride) { $ProjectsRootOverride.Trim() } else { [string]$appSet.directories.projectsRoot }
    if (-not $projectsRoot) { $projectsRoot = Get-CoreWatchDefaultProjectsRoot }
    $editorPath = [string]$appSet.directories.editorPath
    if (-not $editorPath) { $editorPath = Get-CoreWatchDefaultEditorPath }

    $gitExe = Get-GitExecutablePath
    $auth   = Get-GitHubAuthContext -RootPath $RootPath
    $localRepos = @(Get-LocalGitRepositories -ProjectsRoot $projectsRoot)

    $localSlugMap = @{}
    foreach ($lr in $localRepos) {
        if ($lr.repoSlug) { $localSlugMap[$lr.repoSlug.ToLowerInvariant()] = $lr.path }
    }

    $remoteRepos = New-Object System.Collections.Generic.List[object]
    if (-not $SkipRemoteRepos -and $auth.authenticated -and $auth.token) {
        try {
            $rawRepos = @(Invoke-GitHubRestApi -Token $auth.token -Endpoint "user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member")
            foreach ($r in $rawRepos) {
                $slug = [string]$r.full_name
                $localMatch = if ($localSlugMap.ContainsKey($slug.ToLowerInvariant())) { $localSlugMap[$slug.ToLowerInvariant()] } else { "" }
                $remoteRepos.Add([PSCustomObject]@{
                    fullName      = $slug
                    name          = [string]$r.name
                    owner         = [string]$r.owner.login
                    description   = if ($r.description) { [string]$r.description } else { "" }
                    private       = [bool]$r.private
                    language      = if ($r.language) { [string]$r.language } else { "" }
                    defaultBranch = if ($r.default_branch) { [string]$r.default_branch } else { "main" }
                    stars         = [int]($r.stargazers_count ?? 0)
                    updatedAt     = if ($r.updated_at) { ([datetime]$r.updated_at).ToLocalTime().ToString("yyyy-MM-dd HH:mm") } else { "" }
                    cloneUrl      = [string]$r.clone_url
                    htmlUrl       = [string]$r.html_url
                    localPath     = $localMatch
                })
            }
        } catch {
            if (-not $Notice) {
                $Notice = "Loaded local projects, but failed to fetch GitHub repos: $($_.Exception.Message)"
                $NoticeError = $true
            }
        }
    }

    return [ordered]@{
        type         = "GITHUB_MANAGER_STATE"
        gitAvailable = (-not [string]::IsNullOrWhiteSpace($gitExe))
        ghAvailable  = (-not [string]::IsNullOrWhiteSpace($auth.ghExe))
        projectsRoot = $projectsRoot
        editorPath   = $editorPath
        auth         = @{
            authenticated = [bool]$auth.authenticated
            source        = [string]$auth.source
            username      = [string]$auth.username
            displayName   = [string]$auth.displayName
            hasPat        = [bool]$auth.hasPat
        }
        localRepos   = $localRepos
        remoteRepos  = $remoteRepos.ToArray()
        notice       = $Notice
        noticeError  = $NoticeError
    }
}

function Invoke-GitHubManagerAction {
    param(
        [Parameter(Mandatory)][string]$RawJson,
        [Parameter(Mandatory)][string]$RootPath
    )
    $settingsScript = Join-Path $RootPath "modules\core\CoreWatchSettings.ps1"
    if (Test-Path -LiteralPath $settingsScript -PathType Leaf) { . $settingsScript }

    $payload = $RawJson | ConvertFrom-Json
    $cmd = [string]$payload.command

    try {
        switch ($cmd) {
            'GH_LOAD' {
                $rootOvr = [string]($payload.projectsRoot ?? "")
                return (Get-GitHubManagerState -RootPath $RootPath -ProjectsRootOverride $rootOvr)
            }
            'GH_SAVE_PAT' {
                $tok = ([string]($payload.token ?? "")).Trim()
                if (-not $tok) { throw "Enter a GitHub Personal Access Token." }
                Set-CoreWatchSecret -Key $script:GitHubSecretKey -Value $tok
                $st = Get-GitHubManagerState -RootPath $RootPath
                if (-not $st.auth.authenticated) {
                    Remove-CoreWatchSecret -Key $script:GitHubSecretKey
                    throw "GitHub rejected that token. Verify the token has 'repo' scope and try again."
                }
                $st["notice"] = "Signed in to GitHub as @$($st.auth.username) (token stored DPAPI-encrypted)."
                return $st
            }
            'GH_CLEAR_PAT' {
                Remove-CoreWatchSecret -Key $script:GitHubSecretKey
                return (Get-GitHubManagerState -RootPath $RootPath -Notice "Cleared saved GitHub PAT (falling back to gh CLI if signed in).")
            }
            'GH_OPEN_VSCODE' {
                $repoPath = ([string]($payload.path ?? "")).Trim()
                if (-not $repoPath -or -not (Test-Path -LiteralPath $repoPath -PathType Container)) {
                    throw "Project folder does not exist: $repoPath"
                }
                $appSet = Get-CoreWatchAppSettings
                $ed = [string]$appSet.directories.editorPath
                if (-not $ed -or -not (Test-Path -LiteralPath $ed -PathType Leaf)) {
                    $ed = Get-CoreWatchDefaultEditorPath
                }
                if (-not $ed) { throw "VS Code / Code Editor was not found. Configure Editor Path in Settings -> Directories." }
                Start-Process -FilePath $ed -ArgumentList "`"$repoPath`"" -ErrorAction Stop
                return @{ type = "GITHUB_NOTICE"; ok = $true; message = "Opened '$repoPath' in $(Split-Path -Leaf $ed)." }
            }
            'GH_OPEN_TERMINAL' {
                $repoPath = ([string]($payload.path ?? "")).Trim()
                if (-not $repoPath -or -not (Test-Path -LiteralPath $repoPath -PathType Container)) {
                    throw "Project folder does not exist: $repoPath"
                }
                $wt = Get-Command "wt.exe" -ErrorAction SilentlyContinue
                if ($wt) {
                    Start-Process -FilePath $wt.Source -ArgumentList @("-d", "`"$repoPath`"") -ErrorAction Stop
                } else {
                    $sh = if (Get-Command "pwsh.exe" -ErrorAction SilentlyContinue) { "pwsh.exe" } else { "powershell.exe" }
                    Start-Process -FilePath $sh -WorkingDirectory $repoPath -ErrorAction Stop
                }
                return @{ type = "GITHUB_NOTICE"; ok = $true; message = "Opened terminal in $repoPath." }
            }
            'GH_OPEN_EXPLORER' {
                $repoPath = ([string]($payload.path ?? "")).Trim()
                if (-not $repoPath -or -not (Test-Path -LiteralPath $repoPath)) { throw "Path not found: $repoPath" }
                Start-Process "explorer.exe" -ArgumentList "`"$repoPath`"" -ErrorAction Stop
                return @{ type = "GITHUB_NOTICE"; ok = $true; message = "Opened Explorer: $repoPath" }
            }
            'GH_GIT_PULL' {
                $repoPath = ([string]($payload.path ?? "")).Trim()
                $gitExe = Get-GitExecutablePath
                if (-not $gitExe) { throw "git.exe not found in PATH." }
                if (-not $repoPath -or -not (Test-Path -LiteralPath (Join-Path $repoPath ".git"))) {
                    throw "Not a valid Git repository: $repoPath"
                }
                $fetchOut = (& $gitExe -C $repoPath fetch --all --prune 2>&1 | Out-String).Trim()
                $pullOut  = (& $gitExe -C $repoPath pull --ff-only 2>&1 | Out-String).Trim()
                $ok = ($LASTEXITCODE -eq 0)
                $summary = ($pullOut -split "`r?`n" | Select-Object -Last 2) -join " "
                $st = Get-GitHubManagerState -RootPath $RootPath -SkipRemoteRepos -Notice "$(Split-Path -Leaf $repoPath): $summary" -NoticeError (-not $ok)
                return $st
            }
            'GH_RUN_LOCAL_PUBLISH' {
                $repoPath = ([string]($payload.path ?? "")).Trim()
                $pubScript = Join-Path $repoPath "build\Publish-Release.ps1"
                if (-not (Test-Path -LiteralPath $pubScript -PathType Leaf)) {
                    throw "No build\Publish-Release.ps1 found in $repoPath."
                }
                $sh = if (Get-Command "pwsh.exe" -ErrorAction SilentlyContinue) { "pwsh.exe" } else { "powershell.exe" }
                Start-Process -FilePath $sh -WorkingDirectory $repoPath -ArgumentList @("-NoExit", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$pubScript`"") -ErrorAction Stop
                return @{ type = "GITHUB_NOTICE"; ok = $true; message = "Launched build\Publish-Release.ps1 in a new terminal." }
            }
            'GH_CLONE_REPO' {
                $gitExe = Get-GitExecutablePath
                if (-not $gitExe) { throw "git.exe is required to clone repositories. Install Git via App Installer." }
                $cloneUrl = ([string]($payload.url ?? "")).Trim()
                if (-not $cloneUrl -or $cloneUrl -notmatch '^(https://|git@|ssh://)') {
                    throw "Enter a valid HTTPS or SSH Git repository URL."
                }
                $destParent = ([string]($payload.destination ?? "")).Trim()
                if (-not $destParent) {
                    $appSet = Get-CoreWatchAppSettings
                    $destParent = [string]$appSet.directories.projectsRoot
                }
                if (-not $destParent) { throw "Specify a destination folder to clone into." }
                if (-not (Test-Path -LiteralPath $destParent -PathType Container)) {
                    $null = New-Item -ItemType Directory -Path $destParent -Force -ErrorAction Stop
                }
                $repoName = ([string]($payload.folderName ?? "")).Trim()
                if (-not $repoName) {
                    $cleanUrl = $cloneUrl.TrimEnd('/') -replace '\.git$', ''
                    $repoName = ($cleanUrl -split '[/\\:]')[-1]
                }
                if (-not $repoName -or $repoName -match '[<>:"/\\|?*]') {
                    throw "Could not derive a valid folder name from repository URL."
                }
                $targetDir = Join-Path $destParent $repoName
                if (Test-Path -LiteralPath $targetDir) {
                    throw "Target folder already exists: $targetDir"
                }

                $gitArgs = New-Object System.Collections.Generic.List[string]
                $gitArgs.Add("clone")
                if ([bool]$payload.shallow) {
                    $gitArgs.Add("--depth")
                    $gitArgs.Add("1")
                }
                $branch = ([string]($payload.branch ?? "")).Trim()
                if ($branch) {
                    $gitArgs.Add("--branch")
                    $gitArgs.Add($branch)
                }
                $gitArgs.Add($cloneUrl)
                $gitArgs.Add($targetDir)

                $out = (& $gitExe @gitArgs 2>&1 | Out-String).Trim()
                if ($LASTEXITCODE -ne 0) {
                    throw "git clone failed: $out"
                }

                if ([bool]$payload.openInEditor) {
                    $appSet = Get-CoreWatchAppSettings
                    $ed = [string]$appSet.directories.editorPath
                    if (-not $ed -or -not (Test-Path -LiteralPath $ed -PathType Leaf)) { $ed = Get-CoreWatchDefaultEditorPath }
                    if ($ed) { try { Start-Process -FilePath $ed -ArgumentList "`"$targetDir`"" } catch {} }
                }

                $st = Get-GitHubManagerState -RootPath $RootPath -Notice "Cloned '$repoName' into $targetDir."
                return $st
            }
            'GH_LOAD_RELEASES' {
                $slug = ([string]($payload.repoSlug ?? "")).Trim()
                if (-not $slug -or $slug -notmatch '^[^/]+/[^/]+$') { throw "Select a valid GitHub repository (owner/repo)." }
                $auth = Get-GitHubAuthContext -RootPath $RootPath
                if (-not $auth.authenticated) { throw "Sign in to GitHub (via gh CLI or PAT) to manage releases." }
                $rawRels = @(Invoke-GitHubRestApi -Token $auth.token -Endpoint "repos/$slug/releases?per_page=30")
                $rels = New-Object System.Collections.Generic.List[object]
                foreach ($r in $rawRels) {
                    $assets = @($r.assets | ForEach-Object {
                        [PSCustomObject]@{
                            id        = [long]$_.id
                            name      = [string]$_.name
                            sizeBytes = [long]$_.size
                            downloads = [int]$_.download_count
                            url       = [string]$_.browser_download_url
                        }
                    })
                    $relName = if ($r.name) { [string]$r.name } else { [string]$r.tag_name }
                    $relBody = if ($r.body) { [string]$r.body } else { "" }
                    $relCreated = if ($r.created_at) { ([datetime]$r.created_at).ToLocalTime().ToString("yyyy-MM-dd HH:mm") } else { "" }
                    $relUploadUrl = ([string]$r.upload_url) -replace '\{\?.*\}$', ''
                    $rels.Add([PSCustomObject]@{
                        id          = [long]$r.id
                        tagName     = [string]$r.tag_name
                        name        = $relName
                        body        = $relBody
                        draft       = [bool]$r.draft
                        prerelease  = [bool]$r.prerelease
                        createdAt   = $relCreated
                        htmlUrl     = [string]$r.html_url
                        uploadUrl   = $relUploadUrl
                        assets      = $assets
                    })
                }
                return @{
                    type     = "GITHUB_RELEASES_STATE"
                    ok       = $true
                    repoSlug = $slug
                    releases = $rels.ToArray()
                    message  = "Loaded $($rels.Count) release(s) for $slug."
                }
            }
            'GH_GENERATE_RELEASE_NOTES' {
                $slug = ([string]($payload.repoSlug ?? "")).Trim()
                $tag  = ([string]($payload.tagName ?? "")).Trim()
                $tgt  = ([string]($payload.targetBranch ?? "main")).Trim()
                if (-not $slug -or -not $tag) { throw "Repository and Tag Name are required to generate release notes." }
                $auth = Get-GitHubAuthContext -RootPath $RootPath
                if (-not $auth.authenticated) { throw "Sign in to GitHub first." }
                $resp = Invoke-GitHubRestApi -Token $auth.token -Method Post -Endpoint "repos/$slug/releases/generate-notes" -Body @{
                    tag_name         = $tag
                    target_commitish = $tgt
                }
                return @{
                    type  = "GITHUB_GENERATED_NOTES"
                    ok    = $true
                    title = [string]$resp.name
                    body  = [string]$resp.body
                }
            }
            'GH_CREATE_RELEASE' {
                $slug = ([string]($payload.repoSlug ?? "")).Trim()
                $tag  = ([string]($payload.tagName ?? "")).Trim()
                $title = ([string]($payload.title ?? $tag)).Trim()
                $body  = [string]($payload.body ?? "")
                $tgt   = ([string]($payload.targetBranch ?? "main")).Trim()
                $draft = [bool]$payload.draft
                $pre   = [bool]$payload.prerelease
                if (-not $slug -or -not $tag) { throw "Repository and Tag Name are required." }

                $auth = Get-GitHubAuthContext -RootPath $RootPath
                if (-not $auth.authenticated) { throw "Sign in to GitHub first." }

                $created = Invoke-GitHubRestApi -Token $auth.token -Method Post -Endpoint "repos/$slug/releases" -Body @{
                    tag_name         = $tag
                    target_commitish = $tgt
                    name             = $title
                    body             = $body
                    draft            = $draft
                    prerelease       = $pre
                }

                $uploadedCount = 0
                $uploadBase = ([string]$created.upload_url) -replace '\{\?.*\}$', ''
                $assetPaths = @($payload.assetPaths | Where-Object { $_ -and (Test-Path -LiteralPath ([string]$_) -PathType Leaf) })
                if ($uploadBase -and $assetPaths.Count -gt 0) {
                    $upHeaders = @{
                        "Authorization"        = "Bearer $($auth.token)"
                        "Accept"               = "application/vnd.github+json"
                        "User-Agent"           = "CoreWatch-GitHubManager"
                        "X-GitHub-Api-Version" = "2022-11-28"
                    }
                    foreach ($ap in $assetPaths) {
                        $fn = Split-Path -Path $ap -Leaf
                        $mime = if ($fn -match '\.zip$') { "application/zip" } elseif ($fn -match '\.exe$|\.msi$') { "application/octet-stream" } elseif ($fn -match '\.txt$|\.md$') { "text/plain" } else { "application/octet-stream" }
                        $uUrl = "$uploadBase?name=$([System.Uri]::EscapeDataString($fn))"
                        $null = Invoke-RestMethod -Method Post -Uri $uUrl -Headers $upHeaders -InFile $ap -ContentType $mime -TimeoutSec 120 -ErrorAction Stop
                        $uploadedCount++
                    }
                }

                $refreshed = Invoke-GitHubManagerAction -RawJson (@{ command = 'GH_LOAD_RELEASES'; repoSlug = $slug } | ConvertTo-Json -Compress) -RootPath $RootPath
                $refreshed["message"] = "Created release '$tag' for $slug$(if ($uploadedCount -gt 0) { " ($uploadedCount asset(s) uploaded)" })."
                return $refreshed
            }
            'GH_UPLOAD_RELEASE_ASSET' {
                $slug      = ([string]($payload.repoSlug ?? "")).Trim()
                $uploadUrl = ([string]($payload.uploadUrl ?? "")).Trim()
                $filePath  = ([string]($payload.filePath ?? "")).Trim()
                if (-not $uploadUrl -or -not $filePath -or -not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
                    throw "Select a valid file to upload."
                }
                $auth = Get-GitHubAuthContext -RootPath $RootPath
                if (-not $auth.authenticated) { throw "Sign in to GitHub first." }
                $fn = Split-Path -Path $filePath -Leaf
                $upHeaders = @{
                    "Authorization"        = "Bearer $($auth.token)"
                    "Accept"               = "application/vnd.github+json"
                    "User-Agent"           = "CoreWatch-GitHubManager"
                    "X-GitHub-Api-Version" = "2022-11-28"
                }
                $uUrl = "$uploadUrl?name=$([System.Uri]::EscapeDataString($fn))"
                $null = Invoke-RestMethod -Method Post -Uri $uUrl -Headers $upHeaders -InFile $filePath -ContentType "application/octet-stream" -TimeoutSec 120 -ErrorAction Stop
                $refreshed = Invoke-GitHubManagerAction -RawJson (@{ command = 'GH_LOAD_RELEASES'; repoSlug = $slug } | ConvertTo-Json -Compress) -RootPath $RootPath
                $refreshed["message"] = "Uploaded asset '$fn' to release."
                return $refreshed
            }
            'GH_DELETE_RELEASE' {
                $slug  = ([string]($payload.repoSlug ?? "")).Trim()
                $relId = [long]($payload.releaseId ?? 0)
                if (-not $slug -or $relId -le 0) { throw "Invalid release ID." }
                $auth = Get-GitHubAuthContext -RootPath $RootPath
                if (-not $auth.authenticated) { throw "Sign in to GitHub first." }
                $null = Invoke-GitHubRestApi -Token $auth.token -Method Delete -Endpoint "repos/$slug/releases/$relId"
                $refreshed = Invoke-GitHubManagerAction -RawJson (@{ command = 'GH_LOAD_RELEASES'; repoSlug = $slug } | ConvertTo-Json -Compress) -RootPath $RootPath
                $refreshed["message"] = "Deleted release #$relId from $slug."
                return $refreshed
            }
            default {
                throw "Unsupported GitHub Manager command: $cmd"
            }
        }
    } catch {
        return @{
            type    = "GITHUB_NOTICE"
            ok      = $false
            error   = $_.Exception.Message
            message = $_.Exception.Message
        }
    }
}
