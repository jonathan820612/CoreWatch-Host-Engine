# File: modules/telemetry/GetIDMetrics.ps1

function Get-IDMetrics {
    $CpuInfo = Get-CimInstance -ClassName Win32_Processor -ErrorAction Stop
    $CompSys = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction SilentlyContinue

    return [PSCustomObject]@{
        HostName  = [string]$env:COMPUTERNAME
        Workgroup = if ($CompSys) { [string]$CompSys.Domain } else { "WORKGROUP" }
        CpuModel  = [string]$CpuInfo.Name.Trim()
    }
}
