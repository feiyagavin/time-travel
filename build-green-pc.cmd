@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set OUT=pc-green-release

if exist "%OUT%" (
  rmdir /s /q "%OUT%"
)

mkdir "%OUT%"
mkdir "%OUT%\public"
mkdir "%OUT%\pc-green\data"

copy "server.js" "%OUT%\" >nul
copy "package.json" "%OUT%\" >nul
copy "start-green-pc.cmd" "%OUT%\" >nul
copy ".env.example" "%OUT%\" >nul
copy "README.md" "%OUT%\" >nul
copy "GREEN-PC.md" "%OUT%\" >nul
xcopy "public" "%OUT%\public" /E /I /Y >nul

where node >nul 2>nul
if not errorlevel 1 (
  for /f "delims=" %%n in ('where node') do (
    copy "%%n" "%OUT%\node.exe" >nul
    goto copied_node
  )
)

:copied_node
if exist "%OUT%\node.exe" (
  echo 已生成绿色包：%OUT%
  echo 用户解压后双击 start-green-pc.cmd 即可运行。
) else (
  echo 已生成绿色包：%OUT%
  echo 未找到 node.exe，用户电脑需要先安装 Node.js，或手动把 node.exe 放入绿色包目录。
)

pause
