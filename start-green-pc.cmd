@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".env" (
  copy ".env.example" ".env" >nul
)

set STORAGE_MODE=file
set TT_STORAGE_MODE=file
set APP_DATA_DIR=pc-green\data
set PORT=5188

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
  echo 绿色版端口 %PORT% 已被进程 %%a 占用，尝试关闭旧服务...
  taskkill /PID %%a /F >nul 2>nul
)

echo.
echo 正在启动绿色 PC 端：http://localhost:%PORT%
echo 数据会保存在本目录 pc-green\data\db.json，DeepSeek Key 由用户在界面里配置。
echo 请保持此窗口打开，关闭窗口服务就会停止。
echo.

start "" "http://localhost:%PORT%"
if exist "%~dp0node.exe" (
  "%~dp0node.exe" server.js
) else (
  node server.js
)

echo.
echo 绿色 PC 端已退出。
pause
