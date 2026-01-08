@echo off
cd /d C:\ContractsOCR\ui

REM Default API base (override as needed)
set API_BASE=http://192.168.149.8:8080

> config.js (
  echo window.API_BASE = "%API_BASE%";
)

py -m http.server 3000
