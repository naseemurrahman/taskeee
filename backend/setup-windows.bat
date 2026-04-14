@echo off
setlocal EnableDelayedExpansion
title TaskFlow Pro - Setup
color 0A

echo.
echo  ============================================
echo   TaskFlow Pro - Windows Setup
echo  ============================================
echo.

:: ── Step 1: Create .env if missing ───────────────────────────────────────
if not exist ".env" (
    echo [1/5] Creating .env config file...
    copy ".env.example" ".env" >nul
    echo       Done.
) else (
    echo [1/5] .env already exists.
)

:: ── Step 2: npm install ───────────────────────────────────────────────────
echo.
echo [2/5] Installing Node.js packages...
call npm install --silent
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  ERROR: npm install failed.
    echo  Make sure Node.js is installed: https://nodejs.org
    echo.
    pause
    exit /b 1
)
echo       Done.

:: ── Step 3: Find PostgreSQL and set up database ───────────────────────────
echo.
echo [3/5] Looking for PostgreSQL...

set PSQL_EXE=
set PG_FOUND=0

:: Search common PostgreSQL install locations
for /d %%D in ("C:\Program Files\PostgreSQL\*") do (
    if exist "%%D\bin\psql.exe" (
        set "PSQL_EXE=%%D\bin\psql.exe"
        set "PG_FOUND=1"
    )
)
for /d %%D in ("C:\Program Files (x86)\PostgreSQL\*") do (
    if exist "%%D\bin\psql.exe" (
        set "PSQL_EXE=%%D\bin\psql.exe"
        set "PG_FOUND=1"
    )
)
:: Also check PATH
where psql >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    set "PSQL_EXE=psql"
    set "PG_FOUND=1"
)

if %PG_FOUND% EQU 1 (
    echo       Found PostgreSQL: %PSQL_EXE%
    echo       Setting up database...

    "%PSQL_EXE%" -U postgres -c "CREATE USER taskflow WITH PASSWORD 'devpassword123';" 2>nul
    "%PSQL_EXE%" -U postgres -c "CREATE DATABASE taskflow_dev OWNER taskflow;" 2>nul
    "%PSQL_EXE%" -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE taskflow_dev TO taskflow;" 2>nul
    "%PSQL_EXE%" -U taskflow -d taskflow_dev -f "migrations\001_initial_schema.sql" 2>nul
    "%PSQL_EXE%" -U taskflow -d taskflow_dev -f "migrations\002_seed_dev.sql" 2>nul
    echo       Database ready.
) else (
    echo.
    echo  WARNING: PostgreSQL not found on this machine.
    echo  The app will run in DEMO MODE using built-in sample data.
    echo  To use a real database later, install PostgreSQL from:
    echo  https://www.postgresql.org/download/windows/
    echo.
    :: Switch to demo mode in .env
    node -e "
      const fs = require('fs');
      let env = fs.readFileSync('.env','utf8');
      env = env.replace('DATABASE_URL=postgres', '#DATABASE_URL=postgres');
      env += '\nDEMO_MODE=true\n';
      fs.writeFileSync('.env', env);
    " 2>nul
)

:: ── Step 4: Kill anything on port 3000 ───────────────────────────────────
echo.
echo [4/5] Checking port 3000...
set PORT_USED=0
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    echo       Stopping process %%a on port 3000...
    taskkill /PID %%a /F >nul 2>&1
    set PORT_USED=1
)
if %PORT_USED% EQU 0 echo       Port 3000 is free.

:: ── Step 5: Check Redis ───────────────────────────────────────────────────
echo.
echo [5/5] Checking Redis...
node -e "
  const net = require('net');
  const c = net.createConnection(6379,'127.0.0.1');
  c.on('connect',()=>{ process.stdout.write('REDIS_OK'); c.destroy(); process.exit(0); });
  c.on('error',()=>{ process.stdout.write('REDIS_MISSING'); c.destroy(); process.exit(1); });
  setTimeout(()=>{ process.stdout.write('REDIS_TIMEOUT'); process.exit(1); },2000);
" 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo       Redis not found - switching to in-memory session cache.
    node -e "
      const fs=require('fs');
      let e=fs.readFileSync('.env','utf8');
      e=e.replace('REDIS_URL=redis://localhost:6379','REDIS_URL=memory://');
      fs.writeFileSync('.env',e);
    " 2>nul
) else (
    echo       Redis OK.
)

echo.
echo  ============================================
echo   Starting TaskFlow Pro on port 3000...
echo.
echo   Open this file in your browser:
echo   dashboard.html  (in the taskflow-pro folder)
echo.
echo   Keep this window open while using the app.
echo  ============================================
echo.

node src\server.js
