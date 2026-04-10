@echo off
echo =====================================================
echo   Hikrobot Camera Driver Fix - Running as Admin
echo =====================================================
echo.
powershell -Command "Start-Process powershell -ArgumentList '-ExecutionPolicy Bypass -File ""%~dp0fix-camera-driver.ps1""' -Verb RunAs -Wait"
echo.
echo Done. Now unplug and replug your camera USB cable.
echo Then double-click START-APP.bat to run the software.
pause
