$phantomId = "USB\VID_2BDF&PID_0001&MI_00\6&37FE35A2&0&0000"
$realId    = "USB\VID_2BDF&PID_0001&MI_00\6&4720C49&0&0000"
$classGuid = "{e6f501e6-d4d6-4501-ac39-4f774609fa98}"

# Remove phantom
pnputil /remove-device $phantomId 2>&1

# Set security
$sddl    = "D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;BU)"
$sd      = New-Object System.Security.AccessControl.RawSecurityDescriptor($sddl)
$sdBytes = New-Object byte[] ($sd.BinaryLength)
$sd.GetBinaryForm($sdBytes, 0)

$devReg = "HKLM:\SYSTEM\CurrentControlSet\Enum\USB\VID_2BDF&PID_0001&MI_00\6&4720C49&0&0000\Device Parameters"
if (Test-Path $devReg) {
    Set-ItemProperty -Path $devReg -Name "DeviceSecurity" -Value $sdBytes -Type Binary -Force
    Write-Output "Device security: OK"
} else {
    Write-Output "Device security: path not found"
}

$classReg = "HKLM:\SYSTEM\CurrentControlSet\Control\Class\$classGuid"
if (Test-Path $classReg) {
    Set-ItemProperty -Path $classReg -Name "Security" -Value $sdBytes -Type Binary -Force
    Write-Output "Class security: OK"
} else {
    Write-Output "Class security: path not found"
}

# Restart device
pnputil /disable-device $realId 2>&1
Start-Sleep -Seconds 1
pnputil /enable-device $realId 2>&1
Write-Output "Done - unplug and replug USB cable now"
