@echo off
cd /d "%~dp0"
echo === Sales Tracker: build Windows installer ===
where node >nul 2>nul || (echo Node.js is not installed. Install the LTS version from https://nodejs.org then run this again. & pause & exit /b 1)
call npm install || (echo npm install failed & pause & exit /b 1)
call npm test || (echo Tests failed. Not building. & pause & exit /b 1)
call npx electron-builder --win nsis portable --x64 || (echo Build failed & pause & exit /b 1)
echo.
echo Done. Your files are in the "dist" folder:
echo   Sales Tracker Setup 1.1.0.exe   (installer)
echo   SalesTracker-Portable.exe       (no install needed)
pause
