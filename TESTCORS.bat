@echo off
title CORS Troubleshooting
color 06

echo ========================================
echo   Contract OCR - CORS Troubleshooting
echo ========================================
echo.

echo 🔍 Checking server status...
echo.

REM Check if API server is running
echo 📍 Testing API connection...
curl -s http://localhost:8080/api/health >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ API server is running on port 8080
    curl -s http://localhost:8080/api/health
    echo.
) else (
    echo ❌ API server is NOT running on port 8080
    echo 💡 Start the API server first: API_Enhanced.bat
    echo.
)

REM Check if UI server is running
echo 📍 Testing UI connection...
curl -s http://localhost:3000 >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ UI server is running on port 3000
) else (
    echo ❌ UI server is NOT running on port 3000
    echo 💡 Start the UI server first: UI_Enhanced.bat
    echo.
)

REM Check what's using the ports
echo 🔍 Checking port usage...
echo.
echo Ports 3000 and 8080 usage:
netstat -ano | findstr ":3000 :8080"

echo.
echo ========================================
echo   Quick CORS Test
echo ========================================
echo.
echo Testing CORS preflight request...
curl -X OPTIONS -H "Origin: http://localhost:3000" -H "Access-Control-Request-Method: GET" -H "Access-Control-Request-Headers: Content-Type" http://localhost:8080/api/health -v

echo.
echo ========================================
echo   Browser Testing Instructions
echo ========================================
echo.
echo 1. Open browser and go to: http://localhost:3000
echo 2. Press F12 to open Developer Tools
echo 3. Go to Console tab
echo 4. Try uploading a contract file
echo 5. Look for any CORS error messages in console
echo.
echo Common CORS errors to look for:
echo - "Access-Control-Allow-Origin header missing"
echo - "CORS policy: No 'Access-Control-Allow-Origin' header"
echo - "Failed to fetch" errors
echo.

pause