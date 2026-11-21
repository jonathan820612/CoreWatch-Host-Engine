# File: modules/telemetry/GetIDMetrics.ps1

$script:CachedIdMetrics = $null
$script:LastIdRefresh   = [datetime]::MinValue

function Get-IDMetrics {
    # Static identity values; refresh at most every 30 seconds
    if ($null -eq $script:CachedIdMetrics -or (([datetime]::Now - $script:LastIdRefresh).TotalSeconds -ge 30)) {
        $CpuInfo = Get-CimInstance -ClassName Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1
        $CompSys = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction SilentlyContinue

        $script:CachedIdMetrics = [PSCustomObject]@{
            HostName  = [string]$env:COMPUTERNAME
            Workgroup = if ($CompSys) { [string]$CompSys.Domain } else { "WORKGROUP" }
            CpuModel  = if ($CpuInfo) { [string]$CpuInfo.Name.Trim() } else { "Processor Core" }
        }
        $script:LastIdRefresh = [datetime]::Now
    }

    return $script:CachedIdMetrics
}
