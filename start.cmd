@echo off
setlocal
chcp 65001 >nul 2>nul

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js（需要 Node.js 22.12 或更新版本）。
  echo [Error] Node.js 22.12+ is required, but "node" was not found in PATH.
  echo 请先安装 Node.js 22.12+：https://nodejs.org/ 或运行 winget install OpenJS.NodeJS.LTS
  if not defined CI if not "%POLARIS_NO_PAUSE%"=="1" pause
  exit /b 1
)

node "%~dp0scripts\start.mjs" %*
set "EXIT_CODE=%errorlevel%"

if not "%EXIT_CODE%"=="0" (
  if not defined CI if not "%POLARIS_NO_PAUSE%"=="1" pause
)

exit /b %EXIT_CODE%
