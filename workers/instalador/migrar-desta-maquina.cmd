@echo off
rem Aceleriq Motores (frente SUP, 01/10/2026): migra ESTA maquina das janelas antigas para o supervisor invisivel.
rem Passa as chaves das variaveis do usuario para o cofre DPAPI, espera os motores ficarem ociosos,
rem fecha as janelas antigas e liga o Aceleriq Motores (abre sozinho com o Windows, sem janela).
rem Passo a passo: docs\motores\ACELERIQ-MOTORES.md
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar-motores.ps1" -Modo migrar-desta-maquina -Origem "%~dp0..\.." %*
pause
