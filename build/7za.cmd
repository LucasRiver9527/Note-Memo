@echo off
setlocal enabledelayedexpansion
set "a="
set "added="
:l
if "%~1"=="" goto run
if /i "%~1"=="-snld" (
  if not defined added (
    set "a=!a! -snl-"
    set "added=1"
  )
) else (
  set "a=!a! %~1"
)
shift
goto l
:run
if not defined added set "a=!a! -snl-"
"D:\project\node_modules\7zip-bin\win\x64\7za.exe" !a!
exit /b %errorlevel%
