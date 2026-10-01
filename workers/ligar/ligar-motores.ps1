<#
  Liga os motores do painel Aceleriq nesta máquina (frente MTR, 30/09/2026).

  Uso (pelos atalhos .cmd desta pasta, ou direto no PowerShell):
    .\ligar-motores.ps1 -Motor conferir        confere a máquina e as chaves (não liga nada)
    .\ligar-motores.ps1 -Motor render          liga o worker de render (Motion e Mesa Edição) nesta janela
    .\ligar-motores.ps1 -Motor codigo          liga o worker do motor de código (Mesa Site) nesta janela
    .\ligar-motores.ps1 -Motor navegador       liga o worker do navegador do agente (computer use) nesta janela
    .\ligar-motores.ps1 -Motor todos           abre uma janela para cada worker (render, código e navegador)
    .\ligar-motores.ps1 -Motor render -UmaVez  faz um pedido da fila e sai (teste)
    .\ligar-motores.ps1 -GuardarChaves         pergunta as chaves (sem mostrar) e guarda nas variáveis do Windows

  Chaves: só em variável de ambiente do Windows (Usuário) ou no arquivo
  %USERPROFILE%\.aceleriq\motores.env (fora do git). Este script nunca mostra
  nem grava o valor de uma chave em arquivo do repositório.
  Passo a passo: docs\motores\LIGAR-OS-MOTORES.md
#>
param(
  [ValidateSet('conferir', 'render', 'codigo', 'navegador', 'todos')]
  [string]$Motor = 'conferir',
  [switch]$UmaVez,
  [switch]$GuardarChaves
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
$Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$PastaRender = Join-Path $Raiz 'workers\render'
$PastaCodigo = Join-Path $Raiz 'workers\motor-codigo'
$PastaNavegador = Join-Path $Raiz 'workers\computador'
$ArquivoEnv = Join-Path $env:USERPROFILE '.aceleriq\motores.env'
$UrlPadrao = 'https://jjjtkowvxemvituvywvf.supabase.co'
$NodeMinimo = [version]'22.18.0'

function Escrever([string]$texto, [string]$cor = 'Gray') { Write-Host $texto -ForegroundColor $cor }
function Ok([string]$texto) { Escrever "  ok     $texto" 'Green' }
function Falta([string]$texto) { Escrever "  FALTA  $texto" 'Red' }
function Aviso([string]$texto) { Escrever "  aviso  $texto" 'Yellow' }

# Valor de uma variável: sessão, depois Usuário, depois Máquina (o valor nunca é mostrado).
function Ler-Variavel([string]$nome) {
  foreach ($escopo in 'Process', 'User', 'Machine') {
    $v = [Environment]::GetEnvironmentVariable($nome, $escopo)
    if ($v -and $v.Trim()) { return $v.Trim() }
  }
  return $null
}

# Arquivo opcional fora do git: linhas NOME=valor. Vale só para esta sessão e não sobrescreve o que já existe.
function Carregar-ArquivoEnv {
  if (-not (Test-Path $ArquivoEnv)) { return }
  foreach ($linha in Get-Content -LiteralPath $ArquivoEnv -Encoding UTF8) {
    $l = $linha.Trim()
    if (-not $l -or $l.StartsWith('#')) { continue }
    $i = $l.IndexOf('=')
    if ($i -lt 1) { continue }
    $nome = $l.Substring(0, $i).Trim()
    $valor = $l.Substring($i + 1).Trim().Trim('"')
    if ($nome -notmatch '^[A-Z][A-Z0-9_]*$' -or -not $valor) { continue }
    if (-not (Ler-Variavel $nome)) { [Environment]::SetEnvironmentVariable($nome, $valor, 'Process') }
  }
}

# Leva para a sessão o que está no Usuário/Máquina (o worker herda o ambiente da sessão).
function Levar-ParaSessao([string[]]$nomes) {
  foreach ($n in $nomes) {
    $v = Ler-Variavel $n
    if ($v) { [Environment]::SetEnvironmentVariable($n, $v, 'Process') }
  }
}

function Tem-Comando([string]$nome) { return [bool](Get-Command $nome -ErrorAction SilentlyContinue) }

function Conferir-Node {
  if (-not (Tem-Comando 'node')) { Falta 'Node.js não encontrado (instale o Node 24 LTS: winget install OpenJS.NodeJS.LTS)'; return $false }
  $v = [version]((& node --version).Trim().TrimStart('v'))
  if ($v -lt $NodeMinimo) { Falta "Node $v é antigo; precisa de $NodeMinimo ou mais novo"; return $false }
  Ok "Node $v"
  return $true
}

function Conferir-Chaves([string[]]$obrigatorias, [string[]]$umaDestas, [string[]]$opcionais) {
  $tudo = $true
  foreach ($n in $obrigatorias) {
    if (Ler-Variavel $n) { Ok "$n definida" } else { Falta "$n (rode guardar-chaves.cmd)"; $tudo = $false }
  }
  if ($umaDestas.Count) {
    $achou = @($umaDestas | Where-Object { Ler-Variavel $_ })
    if ($achou.Count) { Ok "chave de modelo: $($achou -join ', ')" } else { Falta "uma chave de modelo ($($umaDestas -join ' ou ')); OPENROUTER_API_KEY cobre todos os modelos"; $tudo = $false }
  }
  foreach ($n in $opcionais) {
    if (Ler-Variavel $n) { Ok "$n definida" } else { Aviso "$n ausente (opcional)" }
  }
  return $tudo
}

function Instalar-SePrecisar([string]$pasta, [string[]]$marcas) {
  $falta = @($marcas | Where-Object { -not (Test-Path (Join-Path $pasta "node_modules\$_")) })
  if (-not $falta.Count) { Ok "dependências instaladas em $(Split-Path $pasta -Leaf)"; return $true }
  Escrever "  instalando dependências em $(Split-Path $pasta -Leaf) (npm ci, uma vez; alguns minutos)..." 'Cyan'
  Push-Location $pasta
  try {
    & npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Falta "npm ci falhou em $pasta"; return $false }
  } finally { Pop-Location }
  Ok "dependências instaladas em $(Split-Path $pasta -Leaf)"
  return $true
}

function Conferir-Render([switch]$instalar) {
  Escrever "`nWorker de render (Motion e Mesa Edição)" 'White'
  $ok = Conferir-Node
  $ok = (Conferir-Chaves @('SUPABASE_SERVICE_ROLE_KEY') @() @()) -and $ok
  if (Tem-Comando 'ffmpeg') { Ok 'ffmpeg no PATH' } elseif (Ler-Variavel 'RENDER_FFMPEG') { Ok 'RENDER_FFMPEG definida' } else { Falta 'ffmpeg (winget install Gyan.FFmpeg e abra uma janela nova)'; $ok = $false }
  # O worker usa o ffprobe também (duração e checagem do vídeo): sem ele a máquina não está pronta.
  if (Tem-Comando 'ffprobe') { Ok 'ffprobe no PATH' } elseif (Ler-Variavel 'RENDER_FFPROBE') { Ok 'RENDER_FFPROBE definida' } else { Falta 'ffprobe (vem com o ffmpeg: winget install Gyan.FFmpeg; ou RENDER_FFPROBE com o caminho)'; $ok = $false }
  foreach ($n in 'RENDER_FFMPEG', 'RENDER_FFPROBE', 'RENDER_HYPERFRAMES', 'RENDER_GSAP') {
    $c = Ler-Variavel $n
    if ($c -and ($c -match '[\\/]') -and -not (Test-Path $c)) { Falta "$n aponta para um arquivo que não existe"; $ok = $false }
  }
  if ($instalar) { $ok = (Instalar-SePrecisar $PastaRender @('@remotion\cli', 'hyperframes', 'gsap', '@supabase\supabase-js')) -and $ok }
  elseif (Test-Path (Join-Path $PastaRender 'node_modules\hyperframes')) { Ok 'dependências instaladas' }
  else { Aviso 'dependências ainda não instaladas (o ligar-render instala na primeira vez)' }
  $chrome = Ler-Variavel 'RENDER_CHROME'
  if ($chrome -and -not (Test-Path $chrome)) { Falta 'RENDER_CHROME aponta para um arquivo que não existe'; $ok = $false }
  return $ok
}

function Conferir-Codigo([switch]$instalar) {
  Escrever "`nWorker do motor de código (Mesa Site)" 'White'
  $ok = Conferir-Node
  $ok = (Conferir-Chaves @('SUPABASE_SERVICE_ROLE_KEY') @('OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY') @('VERCEL_TOKEN')) -and $ok
  if (Tem-Comando 'git') { Ok 'git' } else { Falta 'git (winget install Git.Git)'; $ok = $false }
  if (Tem-Comando 'cloudflared') { Ok 'cloudflared (prévia com link público)' } else { Aviso 'cloudflared ausente: a prévia fica só nesta máquina (winget install Cloudflare.cloudflared)' }
  if ((Tem-Comando 'py') -or (Tem-Comando 'python')) { Ok 'Python (busca da base de design)' } else { Aviso 'Python ausente: a busca da base de design fica desligada' }
  if ($instalar) { $ok = (Instalar-SePrecisar $PastaCodigo @('opencode-ai', '@opencode-ai\sdk', '@supabase\supabase-js')) -and $ok }
  elseif (Test-Path (Join-Path $PastaCodigo 'node_modules\opencode-ai')) { Ok 'dependências instaladas' }
  else { Aviso 'dependências ainda não instaladas (o ligar-motor-codigo instala na primeira vez)' }
  return $ok
}

# Chromium do Playwright (headless shell) já baixado, ou o Chrome apontado em COMPUTADOR_CHROME.
function Achar-Chromium {
  $c = Ler-Variavel 'COMPUTADOR_CHROME'
  if ($c) { if (Test-Path $c) { return $c } else { return $null } }
  $base = Join-Path $env:LOCALAPPDATA 'ms-playwright'
  if (-not (Test-Path $base)) { return $null }
  $pasta = Get-ChildItem -LiteralPath $base -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^chromium_headless_shell-\d+$' } | Sort-Object { [int]($_.Name -replace '\D', '') } -Descending | Select-Object -First 1
  if (-not $pasta) { return $null }
  $exe = Get-ChildItem -LiteralPath $pasta.FullName -Recurse -Filter 'chrome-headless-shell.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($exe) { return $exe.FullName } else { return $null }
}

function Conferir-Navegador([switch]$instalar) {
  Escrever "`nWorker do navegador do agente (computer use, só leitura)" 'White'
  $ok = Conferir-Node
  $ok = (Conferir-Chaves @('SUPABASE_SERVICE_ROLE_KEY') @() @()) -and $ok
  if ($instalar) { $ok = (Instalar-SePrecisar $PastaNavegador @('playwright-core', '@supabase\supabase-js')) -and $ok }
  elseif (Test-Path (Join-Path $PastaNavegador 'node_modules\playwright-core')) { Ok 'dependências instaladas' }
  else { Aviso 'dependências ainda não instaladas (o ligar-navegador instala na primeira vez)' }
  $chromium = Achar-Chromium
  if (-not $chromium -and $instalar -and (Test-Path (Join-Path $PastaNavegador 'node_modules\playwright-core'))) {
    Escrever '  baixando o Chromium do navegador do agente (uma vez)...' 'Cyan'
    Push-Location $PastaNavegador
    try { & npx playwright-core install chromium } finally { Pop-Location }
    $chromium = Achar-Chromium
  }
  if ($chromium) { Ok "Chromium do navegador ($(Split-Path (Split-Path (Split-Path $chromium -Parent) -Parent) -Leaf))" }
  elseif (Ler-Variavel 'COMPUTADOR_CHROME') { Falta 'COMPUTADOR_CHROME aponta para um arquivo que não existe'; $ok = $false }
  else { Falta 'Chromium do Playwright (o ligar-navegador baixa; ou rode npm run navegador em workers\computador)'; $ok = $false }
  $ligado = Ler-Variavel 'COMPUTADOR_COM_MODELO_LIGADO'
  $chaves = @('ANTHROPIC_API_KEY', 'OPENAI_API_KEY' | Where-Object { Ler-Variavel $_ })
  if ($ligado -eq '1') {
    Ok 'COMPUTADOR_COM_MODELO_LIGADO=1 nesta máquina (as ações com modelo ligam)'
    if ($chaves.Count) { Ok "chave de modelo do computer use: $($chaves -join ', ')" }
    else { Falta 'uma chave de modelo para o computer use (ANTHROPIC_API_KEY para Claude ou OPENAI_API_KEY para GPT); OpenRouter não serve aqui'; $ok = $false }
    if ($chaves.Count -eq 1) { Aviso "só $($chaves[0]): tarefa pedida com modelo do outro provedor espera na fila" }
  } else {
    Aviso 'COMPUTADOR_COM_MODELO_LIGADO diferente de 1: só as ações sem modelo (capturar, conferir post e conferir site) rodam nesta máquina'
    if ($chaves.Count) { Ok "chave de modelo pronta para quando ligar: $($chaves -join ', ')" }
  }
  Aviso 'COMPUTADOR_COM_MODELO_LIGADO também precisa ser 1 nos segredos do Supabase (função computador-do-agente): confira em Configurações › Estado dos motores'
  return $ok
}

function Guardar-Chaves {
  Escrever 'Guardar as chaves nas variáveis do Windows (Usuário). Enter vazio mantém a que já existe.' 'White'
  foreach ($n in 'SUPABASE_SERVICE_ROLE_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'VERCEL_TOKEN') {
    $existe = [bool](Ler-Variavel $n)
    $seguro = Read-Host -AsSecureString "$n$(if ($existe) { ' (já definida)' } else { '' })"
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro)
    try { $valor = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    if ($valor -and $valor.Trim()) {
      [Environment]::SetEnvironmentVariable($n, $valor.Trim(), 'User')
      [Environment]::SetEnvironmentVariable($n, $valor.Trim(), 'Process')
      Ok "$n guardada"
    }
    $valor = $null
  }
  if (-not (Ler-Variavel 'SUPABASE_URL')) { [Environment]::SetEnvironmentVariable('SUPABASE_URL', $UrlPadrao, 'User'); Ok 'SUPABASE_URL guardada (endereço do projeto)' }
  Escrever 'Pronto. Abra uma janela nova para os programas enxergarem as variáveis.' 'Cyan'
}

function Preparar-Sessao {
  Carregar-ArquivoEnv
  if (-not (Ler-Variavel 'SUPABASE_URL')) { [Environment]::SetEnvironmentVariable('SUPABASE_URL', $UrlPadrao, 'Process') }
  Levar-ParaSessao @('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_WORKSPACE_ID', 'VERCEL_TOKEN', 'VERCEL_TEAM_ID',
    'COMPUTADOR_COM_MODELO_LIGADO', 'COMPUTADOR_MODELO', 'COMPUTADOR_EXECUTOR', 'COMPUTADOR_INTERVALO_S', 'COMPUTADOR_CHROME',
    'RENDER_CHROME', 'RENDER_FFMPEG', 'RENDER_FFPROBE', 'RENDER_HYPERFRAMES', 'RENDER_GSAP', 'RENDER_PASTA', 'RENDER_WORKER_NOME', 'RENDER_INTERVALO_S', 'RENDER_CONCORRENCIA',
    'MOTOR_PASTA', 'MOTOR_EXECUTOR', 'MOTOR_TUNEL', 'MOTOR_PREVIA_MINUTOS', 'MOTOR_PRAZO_MIN', 'UIUX_PYTHON')
}

function Ligar-Render {
  if (-not (Conferir-Render -instalar)) { Escrever "`nO worker de render não foi ligado: resolva o que falta acima." 'Red'; exit 1 }
  $Host.UI.RawUI.WindowTitle = 'Aceleriq · worker de render'
  Escrever "`nLigando o worker de render. Deixe esta janela aberta; Ctrl+C para parar." 'Cyan'
  Push-Location $PastaRender
  try {
    if ($UmaVez) { & node principal.ts --uma-vez } else { & node principal.ts }
  } finally { Pop-Location }
}

function Ligar-Codigo {
  if (-not (Conferir-Codigo -instalar)) { Escrever "`nO motor de código não foi ligado: resolva o que falta acima." 'Red'; exit 1 }
  $Host.UI.RawUI.WindowTitle = 'Aceleriq · motor de código'
  Escrever "`nLigando o motor de código. Deixe esta janela aberta; Ctrl+C para parar." 'Cyan'
  Push-Location $PastaCodigo
  try {
    if ($UmaVez) { & node --env-file-if-exists=.env worker.ts --uma-vez } else { & node --env-file-if-exists=.env worker.ts }
  } finally { Pop-Location }
}

function Ligar-Navegador {
  if (-not (Conferir-Navegador -instalar)) { Escrever "`nO navegador do agente não foi ligado: resolva o que falta acima." 'Red'; exit 1 }
  $Host.UI.RawUI.WindowTitle = 'Aceleriq · navegador do agente'
  Escrever "`nLigando o navegador do agente. Deixe esta janela aberta; Ctrl+C para parar depois da tarefa atual." 'Cyan'
  Push-Location $PastaNavegador
  try {
    if ($UmaVez) { & node principal.ts --uma-vez } else { & node principal.ts }
  } finally { Pop-Location }
}

if ($GuardarChaves) { Guardar-Chaves; exit 0 }
Preparar-Sessao

switch ($Motor) {
  'conferir' {
    Escrever 'Conferindo esta máquina (nada é ligado).' 'White'
    if (Test-Path $ArquivoEnv) { Ok "arquivo de chaves $ArquivoEnv" } else { Aviso "sem $ArquivoEnv (tudo bem se as chaves estão nas variáveis do Windows)" }
    $r = Conferir-Render
    $c = Conferir-Codigo
    $n = Conferir-Navegador
    Escrever ''
    if ($r) { Escrever 'Render: pronto para ligar (ligar-render.cmd).' 'Green' } else { Escrever 'Render: falta algo acima.' 'Red' }
    if ($c) { Escrever 'Motor de código: pronto para ligar (ligar-motor-codigo.cmd).' 'Green' } else { Escrever 'Motor de código: falta algo acima.' 'Red' }
    if ($n) { Escrever 'Navegador do agente: pronto para ligar (ligar-navegador.cmd).' 'Green' } else { Escrever 'Navegador do agente: falta algo acima.' 'Red' }
  }
  'render' { Ligar-Render }
  'codigo' { Ligar-Codigo }
  'navegador' { Ligar-Navegador }
  'todos' {
    foreach ($m in 'render', 'codigo', 'navegador') {
      Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Motor', $m)
    }
    Escrever 'Abri uma janela para cada worker (render, código e navegador). Deixe as três abertas; o Estado dos motores (Configurações) mostra quando eles baterem ponto.' 'Cyan'
  }
}
