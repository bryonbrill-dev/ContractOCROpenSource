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

REM TLS cert/key for HTTPS API
REM set SSL_CERTFILE=C:\ContractsOCR\Workarea\certs\localhost-cert.pem
REM set SSL_KEYFILE=C:\ContractsOCR\Workarea\certs\localhost-key.pem

set UVICORN_SSL_ARGS=
if not "%SSL_CERTFILE%"=="" set UVICORN_SSL_ARGS=--ssl-certfile "%SSL_CERTFILE%" --ssl-keyfile "%SSL_KEYFILE%"

cd /d C:\ContractsOCR\Workarea
uvicorn app:app --host 0.0.0.0 --port 8080 --reload %UVICORN_SSL_ARGS%
