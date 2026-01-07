@echo off
title Contract OCR API
color 0A

REM Default admin credentials (override as needed)
set ADMIN_EMAIL=admin@local.com
set ADMIN_PASSWORD=password
set ADMIN_NAME=Admin

REM SMTP placeholders (override as needed)
REM set SMTP_HOST=smtp.sendgrid.net
REM set SMTP_PORT=587
REM set SMTP_USERNAME=apikey
REM set SMTP_PASSWORD=CHANGEME
REM set SMTP_FROM=admin@local.com
REM set SMTP_FROM_NAME=Contract OCR

cd /d C:\ContractsOCR\Workarea
uvicorn app:app --host 0.0.0.0 --port 8080 --reload
