# File: modules/tabs/JiraManager.ps1
# =========================================================================
# COREWATCH JIRA MANAGER
#   - Supports Jira Cloud (REST v3, Email + Atlassian API Token) AND
#     Jira Server / Data Center (REST v2, Personal Access Token Bearer)
#   - Config stored in %LOCALAPPDATA%\CoreWatch\jira-config.json (NO secrets)
#   - API Token stored DPAPI-encrypted via CoreWatchSettings Secrets Vault
#   - Capabilities: My Work / Active / Reported / Custom JQL, Live Status
#     Transitions, Add Comments, Log Work Time, Assign to Me, Create Issue
# =========================================================================

$script:JiraSecretKey = "jira_api_token"

function Get-JiraConfigPath {
    $dir = Join-Path $env:LOCALAPPDATA "CoreWatch"
    if (-not (Test-Path -LiteralPath $dir)) { $null = New-Item -ItemType Directory -Path $dir -Force }
    return (Join-Path $dir "jira-config.json")
}

function Get-JiraSavedConfig {
    $path = Get-JiraConfigPath
    $def = @{
        siteUrl        = ""
        email          = ""
        authMode       = "cloud_basic"   # cloud_basic | datacenter_pat
        defaultProject = ""
        lastPreset     = "assigned"
        lastJql        = ""
    }
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        try {
            $raw = Get-Content -LiteralPath $path -Raw -ErrorAction Stop | ConvertFrom-Json -AsHashtable
            foreach ($k in @($def.Keys)) {
                if ($raw.ContainsKey($k) -and $null -ne $raw[$k]) { $def[$k] = [string]$raw[$k] }
            }
        } catch {}
    }
    return $def
}

function Save-JiraConfig {
    param([Parameter(Mandatory)][System.Collections.IDictionary]$Config)
    $path = Get-JiraConfigPath
    $clean = [ordered]@{
        siteUrl        = (([string]($Config["siteUrl"] ?? "")).Trim()).TrimEnd('/')
        email          = ([string]($Config["email"] ?? "")).Trim()
        authMode       = if ($Config["authMode"] -eq "datacenter_pat") { "datacenter_pat" } else { "cloud_basic" }
        defaultProject = ([string]($Config["defaultProject"] ?? "")).Trim()
        lastPreset     = ([string]($Config["lastPreset"] ?? "assigned")).Trim()
        lastJql        = ([string]($Config["lastJql"] ?? "")).Trim()
    }
    [System.IO.File]::WriteAllText($path, ($clean | ConvertTo-Json -Depth 4), (New-Object System.Text.UTF8Encoding($false)))
    return $clean
}

function ConvertFrom-JiraAdfToText {
    param($Node)
    if ($null -eq $Node) { return "" }
    if ($Node -is [string]) { return $Node }

    $sb = New-Object System.Text.StringBuilder
    function Invoke-AdfWalk {
        param($Current, [System.Text.StringBuilder]$Builder)
        if ($null -eq $Current) { return }
        if ($Current -is [string]) { [void]$Builder.Append($Current); return }

        $textVal = $null
        $typeVal = ""
        $contentVal = $null
        if ($Current -is [System.Collections.IDictionary]) {
            if ($Current.Contains('text'))    { $textVal    = $Current['text'] }
            if ($Current.Contains('type'))    { $typeVal    = [string]$Current['type'] }
            if ($Current.Contains('content')) { $contentVal = $Current['content'] }
        } else {
            if ($Current.PSObject.Properties['text'])    { $textVal    = $Current.text }
            if ($Current.PSObject.Properties['type'])    { $typeVal    = [string]$Current.type }
            if ($Current.PSObject.Properties['content']) { $contentVal = $Current.content }
        }

        if ($textVal) { [void]$Builder.Append([string]$textVal) }
        if ($typeVal -eq "hardBreak") { [void]$Builder.AppendLine() }
        if ($typeVal -eq "listItem")  { [void]$Builder.Append("• ") }
        if ($contentVal) {
            foreach ($c in @($contentVal)) { Invoke-AdfWalk -Current $c -Builder $Builder }
        }
        if ($typeVal -in @("paragraph", "heading", "listItem", "codeBlock", "blockquote")) {
            [void]$Builder.AppendLine()
        }
    }
    Invoke-AdfWalk -Current $Node -Builder $sb
    return $sb.ToString().Trim()
}

function ConvertTo-JiraAdfDocument {
    param([string]$PlainText)
    $lines = @(($PlainText -replace "`r`n", "`n") -split "`n")
    $paras = New-Object System.Collections.Generic.List[object]
    foreach ($ln in $lines) {
        if ($ln.Length -gt 0) {
            $paras.Add(@{
                type    = "paragraph"
                content = @(@{ type = "text"; text = $ln })
            })
        } else {
            $paras.Add(@{ type = "paragraph"; content = @() })
        }
    }
    if ($paras.Count -eq 0) {
        $paras.Add(@{ type = "paragraph"; content = @(@{ type = "text"; text = " " }) })
    }
    return @{
        type    = "doc"
        version = 1
        content = $paras.ToArray()
    }
}

function Invoke-JiraRestRequest {
    param(
        [Parameter(Mandatory)][System.Collections.IDictionary]$Config,
        [Parameter(Mandatory)][string]$Token,
        [Parameter(Mandatory)][string]$Path,
        [string]$Method = "Get",
        $Body = $null
    )
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $base = (([string]$Config["siteUrl"]).Trim()).TrimEnd('/')
    if (-not $base -or $base -notmatch '^https?://') {
        throw "Jira Site URL must start with https:// (e.g. https://yourorg.atlassian.net)."
    }
    $apiVer = if ($Config["authMode"] -eq "datacenter_pat") { "2" } else { "3" }
    $uri = if ($Path -match '^https?://') { $Path } else { "$base/rest/api/$apiVer/$($Path.TrimStart('/'))" }

    $headers = @{
        "Accept"     = "application/json"
        "User-Agent" = "CoreWatch-JiraManager"
    }
    if ($Config["authMode"] -eq "datacenter_pat") {
        $headers["Authorization"] = "Bearer $Token"
    } else {
        $email = ([string]$Config["email"]).Trim()
        if (-not $email) { throw "Atlassian account email is required for Jira Cloud API Token authentication." }
        $pair = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes("${email}:${Token}"))
        $headers["Authorization"] = "Basic $pair"
    }

    $params = @{
        Method      = $Method
        Uri         = $uri
        Headers     = $headers
        TimeoutSec  = 20
        ErrorAction = "Stop"
    }
    if ($null -ne $Body) {
        $json = if ($Body -is [string]) { $Body } else { $Body | ConvertTo-Json -Depth 12 }
        $params["Body"]        = [System.Text.Encoding]::UTF8.GetBytes($json)
        $params["ContentType"] = "application/json; charset=utf-8"
    }

    return (Invoke-RestMethod @params)
}

function ConvertTo-JiraIssueSummary {
    param($IssueObj, [string]$SiteUrl)
    $f = $IssueObj.fields
    $statusName = if ($f.status) { [string]$f.status.name } else { "Unknown" }
    $statusCat  = if ($f.status -and $f.status.statusCategory) { [string]$f.status.statusCategory.key } else { "new" }
    $prioName   = if ($f.priority) { [string]$f.priority.name } else { "None" }
    $typeName   = if ($f.issuetype) { [string]$f.issuetype.name } else { "Task" }
    $assignee   = if ($f.assignee) { [string]($f.assignee.displayName ?? $f.assignee.name) } else { "Unassigned" }
    $reporter   = if ($f.reporter) { [string]($f.reporter.displayName ?? $f.reporter.name) } else { "" }
    $projKey    = if ($f.project) { [string]$f.project.key } else { "" }
    $updatedStr = if ($f.updated) { try { ([datetime]$f.updated).ToLocalTime().ToString("yyyy-MM-dd HH:mm") } catch { [string]$f.updated } } else { "" }

    return [PSCustomObject]@{
        key            = [string]$IssueObj.key
        id             = [string]$IssueObj.id
        summary        = [string]($f.summary ?? "")
        status         = $statusName
        statusCategory = $statusCat     # new | indeterminate | done
        priority       = $prioName
        issueType      = $typeName
        assignee       = $assignee
        reporter       = $reporter
        projectKey     = $projKey
        labels         = @($f.labels)
        updated        = $updatedStr
        browseUrl      = "$($SiteUrl.TrimEnd('/'))/browse/$($IssueObj.key)"
    }
}

function Get-JiraJqlForPreset {
    param(
        [string]$Preset,
        [string]$ProjectKey = "",
        [string]$CustomJql = ""
    )
    if ($Preset -eq "custom" -and -not [string]::IsNullOrWhiteSpace($CustomJql)) {
        return $CustomJql.Trim()
    }
    $projClause = if ($ProjectKey) { "project = `"$ProjectKey`" AND " } else { "" }
    switch ($Preset) {
        "open"     { return "${projClause}assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC" }
        "reported" { return "${projClause}reporter = currentUser() ORDER BY updated DESC" }
        "recent"   { return "${projClause}updated >= -14d ORDER BY updated DESC" }
        default    { return "${projClause}assignee = currentUser() ORDER BY statusCategory ASC, updated DESC" }
    }
}

function Get-JiraManagerState {
    param(
        [Parameter(Mandatory)][string]$RootPath,
        [string]$Preset = "",
        [string]$ProjectKey = "",
        [string]$CustomJql = "",
        [string]$Notice = "",
        [bool]$NoticeError = $false
    )
    $settingsScript = Join-Path $RootPath "modules\core\CoreWatchSettings.ps1"
    if (Test-Path -LiteralPath $settingsScript -PathType Leaf) { . $settingsScript }

    $cfg   = Get-JiraSavedConfig
    $token = ""
    try { $token = Get-CoreWatchSecret -Key $script:JiraSecretKey } catch {}

    $effectivePreset = if ($Preset) { $Preset } elseif ($cfg.lastPreset) { $cfg.lastPreset } else { "assigned" }
    $effectiveProj   = if ($ProjectKey -ne $null -and $ProjectKey -ne "__keep__") { $ProjectKey } else { $cfg.defaultProject }
    $effectiveJql    = if ($CustomJql) { $CustomJql } else { $cfg.lastJql }

    if (-not $cfg.siteUrl -or -not $token) {
        return [ordered]@{
            type          = "JIRA_MANAGER_STATE"
            authenticated = $false
            config        = $cfg
            hasToken      = (-not [string]::IsNullOrWhiteSpace($token))
            user          = $null
            projects      = @()
            issues        = @()
            activePreset  = $effectivePreset
            activeProject = $effectiveProj
            activeJql     = $effectiveJql
            summary       = @{ total = 0; todo = 0; inProgress = 0; done = 0 }
            notice        = if ($Notice) { $Notice } else { "Sign in with your Jira Site URL, Email, and Atlassian API Token (stored DPAPI-encrypted locally)." }
            noticeError   = $NoticeError
        }
    }

    $me = Invoke-JiraRestRequest -Config $cfg -Token $token -Path "myself"
    $userObj = @{
        accountId   = [string]($me.accountId ?? $me.name ?? "")
        displayName = [string]($me.displayName ?? $me.name ?? "")
        email       = [string]($me.emailAddress ?? $cfg.email)
    }

    # Fetch accessible projects
    $projects = New-Object System.Collections.Generic.List[object]
    try {
        $rawProjs = if ($cfg.authMode -eq "datacenter_pat") {
            @(Invoke-JiraRestRequest -Config $cfg -Token $token -Path "project")
        } else {
            $prResp = Invoke-JiraRestRequest -Config $cfg -Token $token -Path "project/search?maxResults=50"
            @($prResp.values)
        }
        foreach ($p in $rawProjs) {
            $projects.Add([PSCustomObject]@{
                key  = [string]$p.key
                name = [string]$p.name
            })
        }
    } catch {}

    # Query issues using Jira Cloud v3 /search/jql (fallback to /search for older/Data Center)
    $jql = Get-JiraJqlForPreset -Preset $effectivePreset -ProjectKey $effectiveProj -CustomJql $effectiveJql
    $fieldsArr = @("summary", "status", "priority", "issuetype", "assignee", "reporter", "project", "labels", "updated")
    $searchResp = $null
    if ($cfg.authMode -eq "datacenter_pat") {
        $searchResp = Invoke-JiraRestRequest -Config $cfg -Token $token -Method Post -Path "search" -Body @{
            jql        = $jql
            maxResults = 60
            fields     = $fieldsArr
        }
    } else {
        try {
            $searchResp = Invoke-JiraRestRequest -Config $cfg -Token $token -Method Post -Path "search/jql" -Body @{
                jql        = $jql
                maxResults = 60
                fields     = $fieldsArr
            }
        } catch {
            $searchResp = Invoke-JiraRestRequest -Config $cfg -Token $token -Method Post -Path "search" -Body @{
                jql        = $jql
                maxResults = 60
                fields     = $fieldsArr
            }
        }
    }

    $issues = New-Object System.Collections.Generic.List[object]
    $cTodo = 0; $cProg = 0; $cDone = 0
    foreach ($iss in @($searchResp.issues)) {
        $item = ConvertTo-JiraIssueSummary -IssueObj $iss -SiteUrl $cfg.siteUrl
        $issues.Add($item)
        if ($item.statusCategory -eq "done") { $cDone++ }
        elseif ($item.statusCategory -eq "indeterminate") { $cProg++ }
        else { $cTodo++ }
    }

    return [ordered]@{
        type          = "JIRA_MANAGER_STATE"
        authenticated = $true
        config        = $cfg
        hasToken      = $true
        user          = $userObj
        projects      = $projects.ToArray()
        issues        = $issues.ToArray()
        activePreset  = $effectivePreset
        activeProject = $effectiveProj
        activeJql     = $jql
        summary       = @{
            total      = $issues.Count
            todo       = $cTodo
            inProgress = $cProg
            done       = $cDone
        }
        notice        = if ($Notice) { $Notice } else { "Signed in as $($userObj.displayName) · Loaded $($issues.Count) issue(s)." }
        noticeError   = $NoticeError
    }
}

function Invoke-JiraManagerAction {
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
            'JIRA_LOAD' {
                $preset = [string]($payload.preset ?? "")
                $proj   = if ($null -ne $payload.projectKey) { [string]$payload.projectKey } else { "__keep__" }
                $jql    = [string]($payload.customJql ?? "")
                return (Get-JiraManagerState -RootPath $RootPath -Preset $preset -ProjectKey $proj -CustomJql $jql)
            }
            'JIRA_SIGN_IN' {
                $siteUrl  = (([string]($payload.siteUrl ?? "")).Trim()).TrimEnd('/')
                $email    = ([string]($payload.email ?? "")).Trim()
                $authMode = if ($payload.authMode -eq "datacenter_pat") { "datacenter_pat" } else { "cloud_basic" }
                $tok      = ([string]($payload.token ?? "")).Trim()
                if (-not $siteUrl) { throw "Enter your Jira Site URL (e.g. https://yourorg.atlassian.net)." }
                if (-not $tok) {
                    $tok = Get-CoreWatchSecret -Key $script:JiraSecretKey
                }
                if (-not $tok) { throw "Enter your Atlassian API Token (or Personal Access Token)." }

                $testCfg = @{ siteUrl = $siteUrl; email = $email; authMode = $authMode; defaultProject = ""; lastPreset = "assigned"; lastJql = "" }
                $null = Invoke-JiraRestRequest -Config $testCfg -Token $tok -Path "myself"

                $null = Save-JiraConfig -Config $testCfg
                Set-CoreWatchSecret -Key $script:JiraSecretKey -Value $tok
                return (Get-JiraManagerState -RootPath $RootPath -Preset "assigned" -Notice "Connected to $siteUrl (token stored DPAPI-encrypted).")
            }
            'JIRA_SIGN_OUT' {
                Remove-CoreWatchSecret -Key $script:JiraSecretKey
                return (Get-JiraManagerState -RootPath $RootPath -Notice "Signed out of Jira and removed local encrypted API token.")
            }
            'JIRA_GET_ISSUE_DETAIL' {
                $key = ([string]($payload.issueKey ?? "")).Trim()
                if (-not $key) { throw "Issue key is required." }
                $cfg = Get-JiraSavedConfig
                $tok = Get-CoreWatchSecret -Key $script:JiraSecretKey
                if (-not $tok) { throw "Not signed in to Jira." }

                $iss = Invoke-JiraRestRequest -Config $cfg -Token $tok -Path "issue/$key?fields=summary,description,status,priority,issuetype,assignee,reporter,project,labels,updated,comment,timetracking"
                $trResp = Invoke-JiraRestRequest -Config $cfg -Token $tok -Path "issue/$key/transitions"

                $sum = ConvertTo-JiraIssueSummary -IssueObj $iss -SiteUrl $cfg.siteUrl
                $descTxt = ConvertFrom-JiraAdfToText -Node $iss.fields.description

                $comments = New-Object System.Collections.Generic.List[object]
                foreach ($c in @($iss.fields.comment.comments)) {
                    $comments.Add([PSCustomObject]@{
                        author  = if ($c.author) { [string]($c.author.displayName ?? $c.author.name) } else { "User" }
                        created = if ($c.created) { try { ([datetime]$c.created).ToLocalTime().ToString("yyyy-MM-dd HH:mm") } catch { [string]$c.created } } else { "" }
                        body    = ConvertFrom-JiraAdfToText -Node $c.body
                    })
                }

                $transitions = @($trResp.transitions | ForEach-Object {
                    [PSCustomObject]@{
                        id         = [string]$_.id
                        name       = [string]$_.name
                        toStatus   = if ($_.to) { [string]$_.to.name } else { [string]$_.name }
                        toCategory = if ($_.to -and $_.to.statusCategory) { [string]$_.to.statusCategory.key } else { "indeterminate" }
                    }
                })

                $timeSpent = if ($iss.fields.timetracking -and $iss.fields.timetracking.timeSpent) { [string]$iss.fields.timetracking.timeSpent } else { "None" }

                return @{
                    type        = "JIRA_ISSUE_DETAIL"
                    ok          = $true
                    issue       = $sum
                    description = $descTxt
                    timeSpent   = $timeSpent
                    comments    = $comments.ToArray()
                    transitions = $transitions
                }
            }
            'JIRA_TRANSITION_ISSUE' {
                $key   = ([string]($payload.issueKey ?? "")).Trim()
                $trId  = ([string]($payload.transitionId ?? "")).Trim()
                $trLbl = ([string]($payload.transitionName ?? "")).Trim()
                if (-not $key -or -not $trId) { throw "Issue key and transition ID are required." }
                $cfg = Get-JiraSavedConfig
                $tok = Get-CoreWatchSecret -Key $script:JiraSecretKey
                if (-not $tok) { throw "Not signed in to Jira." }
                $null = Invoke-JiraRestRequest -Config $cfg -Token $tok -Method Post -Path "issue/$key/transitions" -Body @{ transition = @{ id = $trId } }
                $detail = Invoke-JiraManagerAction -RawJson (@{ command = 'JIRA_GET_ISSUE_DETAIL'; issueKey = $key } | ConvertTo-Json -Compress) -RootPath $RootPath
                $detail["notice"] = "Transitioned $key -> $trLbl."
                $detail["refreshList"] = $true
                return $detail
            }
            'JIRA_ADD_COMMENT' {
                $key  = ([string]($payload.issueKey ?? "")).Trim()
                $text = ([string]($payload.body ?? "")).Trim()
                if (-not $key -or -not $text) { throw "Issue key and comment text are required." }
                $cfg = Get-JiraSavedConfig
                $tok = Get-CoreWatchSecret -Key $script:JiraSecretKey
                if (-not $tok) { throw "Not signed in to Jira." }
                $bodyObj = if ($cfg.authMode -eq "datacenter_pat") { @{ body = $text } } else { @{ body = (ConvertTo-JiraAdfDocument -PlainText $text) } }
                $null = Invoke-JiraRestRequest -Config $cfg -Token $tok -Method Post -Path "issue/$key/comment" -Body $bodyObj
                $detail = Invoke-JiraManagerAction -RawJson (@{ command = 'JIRA_GET_ISSUE_DETAIL'; issueKey = $key } | ConvertTo-Json -Compress) -RootPath $RootPath
                $detail["notice"] = "Added comment to $key."
                return $detail
            }
            'JIRA_LOG_WORK' {
                $key       = ([string]($payload.issueKey ?? "")).Trim()
                $timeSpent = ([string]($payload.timeSpent ?? "")).Trim()
                $comment   = ([string]($payload.comment ?? "")).Trim()
                if (-not $key -or -not $timeSpent) { throw "Enter a Jira time duration (e.g. '30m', '1h 30m')." }
                $cfg = Get-JiraSavedConfig
                $tok = Get-CoreWatchSecret -Key $script:JiraSecretKey
                if (-not $tok) { throw "Not signed in to Jira." }
                $wlBody = @{ timeSpent = $timeSpent }
                if ($comment) {
                    $wlBody["comment"] = if ($cfg.authMode -eq "datacenter_pat") { $comment } else { (ConvertTo-JiraAdfDocument -PlainText $comment) }
                }
                $null = Invoke-JiraRestRequest -Config $cfg -Token $tok -Method Post -Path "issue/$key/worklog" -Body $wlBody
                $detail = Invoke-JiraManagerAction -RawJson (@{ command = 'JIRA_GET_ISSUE_DETAIL'; issueKey = $key } | ConvertTo-Json -Compress) -RootPath $RootPath
                $detail["notice"] = "Logged $timeSpent on $key."
                return $detail
            }
            'JIRA_ASSIGN_TO_ME' {
                $key = ([string]($payload.issueKey ?? "")).Trim()
                if (-not $key) { throw "Issue key is required." }
                $cfg = Get-JiraSavedConfig
                $tok = Get-CoreWatchSecret -Key $script:JiraSecretKey
                if (-not $tok) { throw "Not signed in to Jira." }
                $me = Invoke-JiraRestRequest -Config $cfg -Token $tok -Path "myself"
                $assignBody = if ($cfg.authMode -eq "datacenter_pat") { @{ name = [string]$me.name } } else { @{ accountId = [string]$me.accountId } }
                $null = Invoke-JiraRestRequest -Config $cfg -Token $tok -Method Put -Path "issue/$key/assignee" -Body $assignBody
                $detail = Invoke-JiraManagerAction -RawJson (@{ command = 'JIRA_GET_ISSUE_DETAIL'; issueKey = $key } | ConvertTo-Json -Compress) -RootPath $RootPath
                $detail["notice"] = "Assigned $key to $($me.displayName)."
                $detail["refreshList"] = $true
                return $detail
            }
            'JIRA_CREATE_ISSUE' {
                $projKey   = ([string]($payload.projectKey ?? "")).Trim()
                $issueType = ([string]($payload.issueType ?? "Task")).Trim()
                $summary   = ([string]($payload.summary ?? "")).Trim()
                $desc      = ([string]($payload.description ?? "")).Trim()
                $priority  = ([string]($payload.priority ?? "")).Trim()
                $assignMe  = [bool]$payload.assignToMe
                if (-not $projKey -or -not $summary) { throw "Project and Summary are required to create a Jira issue." }

                $cfg = Get-JiraSavedConfig
                $tok = Get-CoreWatchSecret -Key $script:JiraSecretKey
                if (-not $tok) { throw "Not signed in to Jira." }

                $fields = @{
                    project   = @{ key = $projKey }
                    summary   = $summary
                    issuetype = @{ name = $issueType }
                }
                if ($desc) {
                    $fields["description"] = if ($cfg.authMode -eq "datacenter_pat") { $desc } else { (ConvertTo-JiraAdfDocument -PlainText $desc) }
                }
                if ($priority) {
                    $fields["priority"] = @{ name = $priority }
                }
                if ($assignMe) {
                    $me = Invoke-JiraRestRequest -Config $cfg -Token $tok -Path "myself"
                    $fields["assignee"] = if ($cfg.authMode -eq "datacenter_pat") { @{ name = [string]$me.name } } else { @{ accountId = [string]$me.accountId } }
                }

                $created = Invoke-JiraRestRequest -Config $cfg -Token $tok -Method Post -Path "issue" -Body @{ fields = $fields }
                $newKey = [string]$created.key
                return (Get-JiraManagerState -RootPath $RootPath -Notice "Created Jira issue $newKey ($summary).")
            }
            default {
                throw "Unsupported Jira Manager command: $cmd"
            }
        }
    } catch {
        return @{
            type    = "JIRA_NOTICE"
            ok      = $false
            error   = $_.Exception.Message
            message = $_.Exception.Message
        }
    }
}
