@echo off
rem Frente MTR (30/09/2026): atalho do ligar-motores.ps1 (passo a passo em docs\motores\LIGAR-OS-MOTORES.md).
rem Frente CUS (01/10/2026): abre uma janela para cada worker: render, motor de código e navegador do agente.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0ligar-motores.ps1" -Motor todos %*
if errorlevel 1 pause
