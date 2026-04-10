@echo off
title Hardness Tester - Build and Run
cd /d "%~dp0"

echo ============================================
echo  Step 1: Stopping all running processes...
echo ============================================
taskkill /F /IM electron.exe /T >nul 2>&1
taskkill /F /IM node.exe     /T >nul 2>&1
taskkill /F /IM esbuild.exe  /T >nul 2>&1
timeout /t 3 /nobreak >nul
echo Done.

echo.
echo ============================================
echo  Step 2: Building camera addon (with fix)...
echo ============================================
cd backend
node-gyp rebuild
if errorlevel 1 (
    echo.
    echo BUILD FAILED. See error above.
    pause
    exit /b 1
)
cd ..
echo Build successful!

echo.
echo ============================================
echo  Step 3: Starting the app...
echo ============================================
npm run dev
