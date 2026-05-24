@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".env" (
  copy ".env.example" ".env" >nul
)

set PORT=5175
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5175" ^| findstr "LISTENING"') do (
  echo 5175 已被进程 %%a 占用，尝试关闭旧服务...
  taskkill /PID %%a /F >nul 2>nul
)

timeout /t 1 /nobreak >nul
netstat -ano | findstr ":5175" | findstr "LISTENING" >nul
if not errorlevel 1 (
  set PORT=5176
  echo 5175 仍被占用，改用 5176。
)

echo 启动地址：http://localhost:%PORT%
start "" "http://localhost:%PORT%"
node server.js
echo.
echo 服务已退出。如果这里显示错误，请把上面的错误发给我。
pause
