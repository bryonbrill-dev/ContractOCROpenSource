@echo off
setlocal

cd /d C:\ContractsOCR\Workarea

REM Create venv only if it doesn't exist yet
if not exist ".venv\Scripts\python.exe" (
  py -m venv .venv
)

REM Activate venv for this session
call ".\.venv\Scripts\activate.bat"

REM (Optional) install deps if you want it to self-heal
REM python -m pip install -r requirements.txt

REM Start API
uvicorn app:app --host 0.0.0.0 --port 8080 --reload

endlocal
pause
