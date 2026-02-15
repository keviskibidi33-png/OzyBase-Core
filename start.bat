@echo off
title OzyBase - Backend + Frontend
echo ============================================
echo        OzyBase Development Server
echo ============================================
echo.

:: Start Backend
echo [1/2] Starting Backend (Go)...
start "OzyBase Backend" cmd /k "cd /d %~dp0 && go run cmd/OzyBase/main.go"

:: Wait a moment for backend to initialize
timeout /t 3 /nobreak >nul

:: Start Frontend
echo [2/2] Starting Frontend (Vite)...
start "OzyBase Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo ============================================
echo   Backend  -> http://localhost:8090
echo   Frontend -> http://localhost:5342
echo ============================================
echo.
echo Both services started in separate windows.
echo Close this window or press any key to exit.
pause >nul
