@echo off
rem Frente CUS (01/10/2026): atalho do ligar-motores.ps1 para o navegador do agente (passo a passo em docs\motores\LIGAR-OS-MOTORES.md).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0ligar-motores.ps1" -Motor navegador %*
if errorlevel 1 pause
