@echo off
cd /d C:\ContractsOCR\ui

REM Default API base (override as needed)
set API_BASE=https://192.168.149.8:8080

REM TLS cert/key for HTTPS UI
REM set UI_SSL_CERTFILE=C:\ContractsOCR\Workarea\certs\localhost-cert.pem
REM set UI_SSL_KEYFILE=C:\ContractsOCR\Workarea\certs\localhost-key.pem

> config.js (
  echo window.API_BASE = "%API_BASE%";
)

cd /d C:\ContractsOCR\Workarea
py serve_ui_https.py --directory C:\ContractsOCR\ui --port 3000
