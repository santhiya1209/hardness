$ErrorActionPreference = "SilentlyContinue"

$ports = @(5173, 5174, 5175, 5176, 8765)
$stoppedPortPids = New-Object System.Collections.Generic.HashSet[int]
$currentPid = $PID
foreach ($port in $ports) {
  $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if (-not $listeners) { continue }

  $procIds = $listeners | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $procIds) {
    if ($procId -le 0) { continue }
    if ($procId -eq $currentPid) { continue }
    if (-not $stoppedPortPids.Add([int]$procId)) { continue }

    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if (-not $proc) { continue }
    if ($proc.ProcessName -notin @("node", "electron")) { continue }

    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    if (-not (Get-Process -Id $procId -ErrorAction SilentlyContinue)) {
      Write-Host "Stopped PID $procId ($($proc.ProcessName)) on port $port"
    } else {
      Write-Host "Could not stop PID $procId ($($proc.ProcessName)) on port $port"
    }
  }
}

Write-Host "Cleanup complete. You can start with: npm run dev"
