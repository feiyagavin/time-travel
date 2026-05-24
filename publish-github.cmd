@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo.
echo 这个脚本会把当前项目提交并推送到 GitHub。
echo 请先在 GitHub 新建一个空仓库，然后复制仓库地址。
echo 例如：https://github.com/your-name/time-travel-app.git
echo.
set /p REPO_URL=请输入 GitHub 仓库地址：

if "%REPO_URL%"=="" (
  echo 没有输入仓库地址，已取消。
  pause
  exit /b 1
)

git --version >nul 2>nul
if errorlevel 1 (
  echo 没找到 Git，请先安装 Git for Windows。
  pause
  exit /b 1
)

git config user.name >nul 2>nul
if errorlevel 1 (
  git config user.name "Time Travel App"
)

git config user.email >nul 2>nul
if errorlevel 1 (
  git config user.email "time-travel-app@example.com"
)

git add .
git commit -m "Initial open source release"
git branch -M main
git remote remove origin >nul 2>nul
git remote add origin "%REPO_URL%"
git push -u origin main

echo.
echo 如果上面没有报错，就已经发布到 GitHub 了。
pause
