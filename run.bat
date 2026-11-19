@echo off
REM Fabrexa AI Bot - Windows startup script

echo.
echo ============================================================
echo   Fabrexa AI - Telegram Bot
echo   Groq text + local ComfyUI images
echo ============================================================
echo.

node --version >nul 2>&1
if errorlevel 1 (
    echo Node.js is not installed or not in PATH.
    echo Install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo Node.js found:
node --version

npm --version >nul 2>&1
if errorlevel 1 (
    echo npm is not installed or not in PATH.
    pause
    exit /b 1
)

echo npm found:
npm --version

if not exist ".env" (
    echo.
    echo .env file not found.
    echo Creating .env from .env.example...
    copy .env.example .env >nul
    echo.
    echo Edit .env and set:
    echo    - TELEGRAM_BOT_TOKEN
    echo    - OWNER_ID
    echo    - OWNER_USERNAME
    echo    - GROQ_API_KEY
    echo    - GROQ_MODEL
    echo    - COMFYUI_CHECKPOINT_NAME
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo.
    echo Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo Failed to install dependencies.
        pause
        exit /b 1
    )
)

echo.
echo Starting Fabrexa AI Bot...
echo Make sure local ComfyUI is running.
echo.
call npm start

pause
