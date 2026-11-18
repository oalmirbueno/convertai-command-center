/**
 * Scripts de uma linha que instalam a Central numa máquina: baixam o
 * central.py e rodam `central.py instalar` (sincroniza tudo e liga a
 * sincronização automática). Não levam segredo: a chave vem da variável
 * ACELERIQ_CENTRAL_TOKEN de quem roda.
 */

export function scriptDoInstalador(so: 'windows' | 'linux', supabaseUrl: string): string {
  const fn = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/central-skills`;
  if (so === 'windows') {
    return `# Central de Skills Aceleriq: instalador para Windows (PowerShell)
$ErrorActionPreference = 'Stop'
if (-not $env:ACELERIQ_CENTRAL_TOKEN) {
  Write-Host 'Defina antes: $env:ACELERIQ_CENTRAL_TOKEN="mcp_live_..." (chave do painel em API > Conectar, com memory:read e memory:write).'
  return
}
[Environment]::SetEnvironmentVariable('ACELERIQ_CENTRAL_TOKEN', $env:ACELERIQ_CENTRAL_TOKEN, 'User')
$pasta = Join-Path $HOME '.aceleriq'
New-Item -ItemType Directory -Force -Path $pasta | Out-Null
Invoke-RestMethod -Uri '${fn}?acao=cliente' -OutFile (Join-Path $pasta 'central.py')
$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) { $py = Get-Command py -ErrorAction SilentlyContinue }
if (-not $py) { Write-Host 'Instale o Python 3 (python.org) e rode de novo.'; return }
& $py.Source (Join-Path $pasta 'central.py') instalar
`;
  }
  return `#!/usr/bin/env bash
# Central de Skills Aceleriq: instalador para Linux e macOS
set -euo pipefail
if [ -z "\${ACELERIQ_CENTRAL_TOKEN:-}" ]; then
  echo 'Defina antes: export ACELERIQ_CENTRAL_TOKEN="mcp_live_..." (chave do painel com memory:read e memory:write).'
  exit 1
fi
mkdir -p "$HOME/.aceleriq"
umask 077
printf '%s' "$ACELERIQ_CENTRAL_TOKEN" > "$HOME/.aceleriq/token"
curl -fsSL '${fn}?acao=cliente' -o "$HOME/.aceleriq/central.py"
PY=$(command -v python3 || command -v python || true)
if [ -z "$PY" ]; then echo 'Instale o Python 3 e rode de novo.'; exit 1; fi
"$PY" "$HOME/.aceleriq/central.py" instalar
`;
}
