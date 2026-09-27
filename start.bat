@echo off
setlocal
cd /d "%~dp0"

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm not found. Install Node.js: https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed
    pause
    exit /b 1
  )
)

if not exist ".env" (
  if exist ".env.example" (
    copy /Y ".env.example" ".env" >nul
    echo Created .env from .env.example
    echo Fill PROXYAPI_KEY, VK_GROUP_TOKEN, VK_GROUP_ID in .env
    echo.
  )
)

rem Free port 3000 if busy
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
  echo Port 3000 busy, killing PID %%a
  taskkill /F /PID %%a >nul 2>&1
)

echo Starting server: http://localhost:3000
echo Stop with Ctrl+C
echo.
call npm start
echo.
echo Server stopped. Exit code: %ERRORLEVEL%
pause
