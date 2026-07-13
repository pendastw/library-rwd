@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 圖書館系統
echo ============================================
echo     圖書館系統 - 更新並啟動
echo ============================================
echo.
echo [1/3] 從 GitHub 取得最新版本...
git fetch origin
git reset --hard origin/main
echo.
echo [2/3] 停止舊的伺服器（若有）...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
timeout /t 1 /nobreak >nul
echo.
echo [3/3] 啟動伺服器...
echo.
echo   *** 請保持這個視窗開著，關掉伺服器就會停止 ***
echo   *** 要停止請按 Ctrl+C，或直接關閉視窗       ***
echo.
node server.js
echo.
echo *** 伺服器已停止。按任意鍵關閉視窗。***
pause >nul
