# File: modules/telemetry/GetIDMetrics.ps1

$script:CachedIdMetrics = $null
$script:LastIdRefresh   = [datetime]::MinValue

# =========================================================================
# [DIAGNOSTIC ADDITION] ADMIN / ELEVATION CONTEXT CHECK
# Insert Point: Evaluated in Get-IDMetrics to show Administrator vs Standard User
# =========================================================================
function Get-ElevationContext {
    try {
        $identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
        $principal = New-Object Security.Principal.WindowsPrincipal($identity)
        $isAdmin   = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
        return @{
            IsAdmin         = $isAdmin
            ElevationStatus = if ($isAdmin) { "Administrator" } else { "Standard User" }
        }
    } catch {
        return @{
            IsAdmin         = $false
            ElevationStatus = "Standard User"
        }
    }
}

function Get-IDMetrics {
    # Static identity values; refresh at most every 30 seconds
    if ($null -eq $script:CachedIdMetrics -or (([datetime]::Now - $script:LastIdRefresh).TotalSeconds -ge 30)) {
        $CpuInfo = Get-CimInstance -ClassName Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1
        $CompSys = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction SilentlyContinue
        $elev    = Get-ElevationContext

        $script:CachedIdMetrics = [PSCustomObject]@{
            HostName        = [string]$env:COMPUTERNAME
            Workgroup       = if ($CompSys) { [string]$CompSys.Domain } else { "WORKGROUP" }
            CpuModel        = if ($CpuInfo) { [string]$CpuInfo.Name.Trim() } else { "Processor Core" }
            IsAdmin         = [bool]$elev.IsAdmin
            ElevationStatus = [string]$elev.ElevationStatus
        }
        $script:LastIdRefresh = [datetime]::Now
    }

    return $script:CachedIdMetrics
}
