@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing packages...
  call npm install --no-fund --no-audit
)
:loop
node bridge.js --app=discord-chatbridge
echo Bridge stopped (code %errorlevel%). Restarting in 10 seconds, Ctrl+C to abort.
timeout /t 10 >nul
goto loop
