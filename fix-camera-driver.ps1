#Requires -RunAsAdministrator
# Hikrobot USB Camera Driver/Permission Fix (dynamic VID_2BDF detection)

$ErrorActionPreference = "Continue"
$classGuid = "{e6f501e6-d4d6-4501-ac39-4f774609fa98}"
$vidPattern = "USB\\VID_2BDF&PID_0001"

Write-Host "Hikrobot Camera Driver Fix" -ForegroundColor Cyan

$cams = Get-PnpDevice -PresentOnly | Where-Object {
  $_.InstanceId -like "$vidPattern*" -or $_.FriendlyName -like "*USB3 Vision Camera*"
}

if (-not $cams -or $cams.Count -eq 0) {
  Write-Host "No active Hikrobot camera found. Plug the camera and run again." -ForegroundColor Yellow
  exit 1
}

Write-Host ""
Write-Host "Detected camera devices:" -ForegroundColor Gray
$cams | ForEach-Object { Write-Host "  - $($_.Status)  $($_.InstanceId)" -ForegroundColor Gray }

# 1) Remove stale/unknown duplicates for same VID/PID (not present or problematic)
Write-Host ""
Write-Host "[1] Removing stale duplicate devices..." -ForegroundColor Yellow
Get-PnpDevice | Where-Object {
  $_.InstanceId -like "$vidPattern*" -and $_.Status -ne "OK"
} | ForEach-Object {
  Write-Host "  Removing: $($_.InstanceId)" -ForegroundColor DarkYellow
  pnputil /remove-device "$($_.InstanceId)" 2>&1 | Out-Null
}
Write-Host "    Done." -ForegroundColor Green

# 2) Set permissive ACL (SYSTEM/Administrators/Users full access) on camera device + class
Write-Host "[2] Setting USB permissions for all users..." -ForegroundColor Yellow
try {
  $sddl = "D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;BU)"
  $sd = New-Object System.Security.AccessControl.RawSecurityDescriptor($sddl)
  $sdBytes = New-Object byte[] ($sd.BinaryLength)
  $sd.GetBinaryForm($sdBytes, 0)

  $cams = Get-PnpDevice -PresentOnly | Where-Object {
    $_.InstanceId -like "$vidPattern*" -or $_.FriendlyName -like "*USB3 Vision Camera*"
  }

  foreach ($cam in $cams) {
    $devReg = "HKLM:\SYSTEM\CurrentControlSet\Enum\$($cam.InstanceId)\Device Parameters"
    if (Test-Path $devReg) {
      Set-ItemProperty -Path $devReg -Name "DeviceSecurity" -Value $sdBytes -Type Binary -Force
      Write-Host "  Device security updated: $($cam.InstanceId)" -ForegroundColor Green
    }
  }

  $classReg = "HKLM:\SYSTEM\CurrentControlSet\Control\Class\$classGuid"
  if (Test-Path $classReg) {
    Set-ItemProperty -Path $classReg -Name "Security" -Value $sdBytes -Type Binary -Force
    Write-Host "  Class security updated." -ForegroundColor Green
  }
} catch {
  Write-Host "    Warning while updating security: $($_.Exception.Message)" -ForegroundColor DarkYellow
}

# 3) Restart active camera device(s)
Write-Host "[3] Restarting camera device..." -ForegroundColor Yellow
$cams = Get-PnpDevice -PresentOnly | Where-Object {
  $_.InstanceId -like "$vidPattern*" -or $_.FriendlyName -like "*USB3 Vision Camera*"
}
foreach ($cam in $cams) {
  Write-Host "  Restarting: $($cam.InstanceId)" -ForegroundColor DarkYellow
  pnputil /disable-device "$($cam.InstanceId)" 2>&1 | Out-Null
  Start-Sleep -Milliseconds 800
  pnputil /enable-device "$($cam.InstanceId)" 2>&1 | Out-Null
}
Write-Host "    Done." -ForegroundColor Green

Write-Host ""
Write-Host "Fix complete. Unplug and replug the camera USB cable, then reopen Hardness Tester." -ForegroundColor Green
Start-Sleep -Seconds 2
