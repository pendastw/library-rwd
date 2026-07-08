@echo off
cd /d "%~dp0"
title 圖書館查詢系統 (請勿關閉此視窗)
:loop
node server.js
echo.
echo [!] server 停止了, 5 秒後自動重新啟動... (要永久停止請直接關閉此視窗)
timeout /t 5 /nobreak >nul
goto loop
