@echo off
:: Starts the Hardness Tester app as Administrator (dev mode)
:: Use this if fix-camera-driver.ps1 hasn't been run yet
powershell -Command "Start-Process cmd -ArgumentList '/k cd /d C:\Users\SANTHIYA\Desktop\hardness-tester && npm run dev' -Verb RunAs"
