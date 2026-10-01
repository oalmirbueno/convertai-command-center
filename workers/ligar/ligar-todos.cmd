@echo off
rem Frente MTR (30/09/2026): atalho do ligar-motores.ps1 (passo a passo em docs\motores\LIGAR-OS-MOTORES.md).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0ligar-motores.ps1" -Motor todos %*
if errorlevel 1 pause
