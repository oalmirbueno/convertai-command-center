<#
  Aceleriq Motores: instalador (frente SUP, 01/10/2026).

  Pedido do dono: "dê para instalar as dependências em qualquer computador...
  e este tem que abrir junto, mas sem ficar com os terminais abertos".

  Modos:
    instalar               (padrão; o .cmd baixado do painel roda este)
      confere/instala Node, ffmpeg e Git (winget, com a confirmação do Windows),
      troca o código de pareamento do painel pela chave de serviço (guardada no
      cofre DPAPI do Windows, nunca em texto), baixa o pacote dos workers e confere
      o sha256, instala as dependências (npm ci) e o Chromium do navegador,
      registra o início invisível com o Windows e liga.
    migrar-desta-maquina   (a máquina que já roda os workers em janelas)
      passa as chaves das variáveis do usuário para o cofre DPAPI, copia os workers
      do clone (C:\AI\aceleriq-workers), instala o início invisível, espera os
      motores ficarem ociosos (nunca derruba um "construir"), fecha as janelas
      antigas e liga o supervisor.
    desinstalar            para com calma, tira o início automático e apaga o cofre.
    conferir               mostra o que está instalado e o estado dos motores.

  Nada aqui mostra, grava em texto ou loga uma chave. Passo a passo e segurança:
  docs\motores\ACELERIQ-MOTORES.md
#>
param(
  [ValidateSet('instalar', 'migrar-desta-maquina', 'desinstalar', 'conferir')]
  [string]$Modo = 'instalar',
  [string]$Codigo = $env:ACELERIQ_CODIGO,
  [string]$SupabaseUrl = 'https://jjjtkowvxemvituvywvf.supabase.co',
  [string]$ChavePublica = '',
  [string]$PainelUrl = 'https://aceleriq.online',
  [string]$FuncaoUrl = '',
  [string]$Pasta = $env:ACELERIQ_MOTORES_PASTA,
  [string]$Origem = 'C:\AI\aceleriq-workers',
  [string]$PacoteLocal = '',
  [string[]]$Motores = $(if ($env:ACELERIQ_MOTORES) { @($env:ACELERIQ_MOTORES) } else { @() }),
  [string]$Nome = '',
  [switch]$SemDependencias,
  [switch]$SemNpm,
  [switch]$SemInicioAutomatico,
  [switch]$SemLigar,
  [string]$PastaInicializar = $env:ACELERIQ_PASTA_INICIALIZAR,
  [switch]$NaoEsperar,
  [switch]$LimparVariaveis,
  [switch]$ApagarTudo,
  # migrar: faz tudo menos fechar as janelas antigas e ligar (mostra o que fecharia e o que está em curso).
  [switch]$Ensaiar
)

# 'Continue': no PowerShell 5.1, um aviso no stderr de programa (npm, winget, tar) com 'Stop' derruba o script.
# Os erros que importam são tratados um a um (try/catch com -ErrorAction Stop).
$ErrorActionPreference = 'Continue'
# Ajustes por variável de ambiente (o .cmd do painel não repassa parâmetros): teste ponta a ponta e máquinas especiais.
if ($env:ACELERIQ_SEM_DEPENDENCIAS -eq '1') { $SemDependencias = [switch]$true }
if ($env:ACELERIQ_SEM_NPM -eq '1') { $SemNpm = [switch]$true }
if ($env:ACELERIQ_MODO -and $Modo -eq 'instalar') { $Modo = $env:ACELERIQ_MODO }
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
$ProgressPreference = 'SilentlyContinue'

$MOTORES_VALIDOS = @('render', 'codigo', 'navegador')
$NOMES = @{ render = 'Render (Motion e Edição)'; codigo = 'Motor de código (Site)'; navegador = 'Navegador do agente' }
$ENTROPIA = 'Aceleriq Motores v1'
$CHAVES_DO_COFRE = @('SUPABASE_SERVICE_ROLE_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_WORKSPACE_ID', 'VERCEL_TOKEN')
$NODE_MINIMO = [version]'22.18.0'

if (-not $Pasta) { $Pasta = Join-Path $env:LOCALAPPDATA 'Aceleriq\Motores' }
$Pasta = [IO.Path]::GetFullPath($Pasta)
if (-not $PastaInicializar) { $PastaInicializar = [Environment]::GetFolderPath('Startup') }
if (-not $FuncaoUrl) { $FuncaoUrl = ($SupabaseUrl.TrimEnd('/') + '/functions/v1/motores-parear') }
$Cofre = Join-Path $Pasta 'cofre.dat'
$ArquivoDaMaquina = Join-Path $Pasta 'maquina.json'
$Lancador = Join-Path $Pasta 'lancador.mjs'
$Atalho = Join-Path $PastaInicializar 'Aceleriq Motores.lnk'
$Tar = Join-Path $env:SystemRoot 'System32\tar.exe'
$Conhost = Join-Path $env:SystemRoot 'System32\conhost.exe'

function Escrever([string]$t, [string]$cor = 'Gray') { Write-Host $t -ForegroundColor $cor }
function Titulo([string]$t) { Write-Host ''; Write-Host $t -ForegroundColor White }
function Ok([string]$t) { Escrever "  ok     $t" 'Green' }
function Aviso([string]$t) { Escrever "  aviso  $t" 'Yellow' }
function Falha([string]$t) { Escrever "  FALTA  $t" 'Red' }
function Parar([string]$t, [int]$codigo = 1) { Write-Host ''; Escrever $t 'Red'; exit $codigo }

function Atualizar-Path {
  $env:Path = ([Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User'))
}

function Tem([string]$cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

function Node-Exe {
  $c = Get-Command node -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  return $null
}

function Versao-Do-Node {
  $n = Node-Exe
  if (-not $n) { return $null }
  try { return [version]((& $n --version).Trim().TrimStart('v')) } catch { return $null }
}

function Instalar-Com-Winget([string]$id, [string]$nome) {
  if (-not (Tem 'winget')) {
    Parar "Falta $nome e o winget não está nesta máquina. Instale o 'Instalador de Aplicativo' pela Microsoft Store (ou $nome pelo site oficial) e rode de novo."
  }
  Escrever "  instalando $nome pelo winget (o Windows pode pedir confirmação)..." 'Cyan'
  & winget install --id $id -e --source winget
  Atualizar-Path
}

function Garantir-Dependencias([string[]]$motores) {
  Titulo '1. Programas desta máquina'
  $v = Versao-Do-Node
  if (-not $v -or $v -lt $NODE_MINIMO) {
    if ($v) { Aviso "Node $v é antigo (precisa de $NODE_MINIMO ou mais novo)" }
    Instalar-Com-Winget 'OpenJS.NodeJS.LTS' 'Node.js LTS'
    $v = Versao-Do-Node
    if (-not $v -or $v -lt $NODE_MINIMO) { Parar 'O Node.js não ficou disponível. Feche esta janela, abra de novo o instalador e, se continuar, instale o Node 24 LTS em nodejs.org.' }
  }
  Ok "Node $v"
  if ($motores -contains 'render') {
    if (-not (Tem 'ffmpeg') -or -not (Tem 'ffprobe')) { Instalar-Com-Winget 'Gyan.FFmpeg' 'ffmpeg' }
    if ((Tem 'ffmpeg') -and (Tem 'ffprobe')) { Ok 'ffmpeg e ffprobe' } else { Aviso 'ffmpeg ainda fora do PATH: o render avisa no painel o que falta' }
  }
  if ($motores -contains 'codigo') {
    if (-not (Tem 'git')) { Instalar-Com-Winget 'Git.Git' 'Git' }
    if (Tem 'git') { Ok 'Git' } else { Aviso 'Git ainda fora do PATH: o motor de código precisa dele' }
    if (Tem 'cloudflared') { Ok 'cloudflared (prévia com link público)' } else { Aviso 'cloudflared ausente (opcional): a prévia do site fica só nesta máquina (winget install Cloudflare.cloudflared)' }
  }
}

# ── Cofre DPAPI (mesmo formato de workers\supervisor\segredos.ts) ─────────────
Add-Type -AssemblyName System.Security
function Ler-Cofre {
  if (-not (Test-Path -LiteralPath $Cofre)) { return @{} }
  $b = [IO.File]::ReadAllBytes($Cofre)
  $d = [Security.Cryptography.ProtectedData]::Unprotect($b, [Text.Encoding]::UTF8.GetBytes($ENTROPIA), [Security.Cryptography.DataProtectionScope]::CurrentUser)
  $o = [Text.Encoding]::UTF8.GetString($d) | ConvertFrom-Json
  [Array]::Clear($d, 0, $d.Length)
  $h = @{}
  foreach ($p in $o.PSObject.Properties) { $h[$p.Name] = [string]$p.Value }
  return $h
}

function Gravar-Cofre([hashtable]$novos) {
  New-Item -ItemType Directory -Force -Path $Pasta | Out-Null
  $atual = @{}
  try { $atual = Ler-Cofre } catch { Aviso 'o cofre antigo não abriu (outro usuário ou outra máquina): começo um novo' }
  foreach ($k in $novos.Keys) { if ($novos[$k]) { $atual[$k] = [string]$novos[$k] } }
  $json = $atual | ConvertTo-Json -Compress
  $d = [Text.Encoding]::UTF8.GetBytes($json)
  $json = $null
  $p = [Security.Cryptography.ProtectedData]::Protect($d, [Text.Encoding]::UTF8.GetBytes($ENTROPIA), [Security.Cryptography.DataProtectionScope]::CurrentUser)
  [Array]::Clear($d, 0, $d.Length)
  $tmp = "$Cofre.tmp"
  [IO.File]::WriteAllBytes($tmp, $p)
  Move-Item -LiteralPath $tmp -Destination $Cofre -Force
}

function Gravar-Json([string]$arq, $dados) {
  New-Item -ItemType Directory -Force -Path (Split-Path $arq) | Out-Null
  $t = ($dados | ConvertTo-Json -Depth 5)
  [IO.File]::WriteAllText($arq, $t + "`n", (New-Object Text.UTF8Encoding $false))
}

function Ler-Json([string]$arq) {
  if (-not (Test-Path -LiteralPath $arq)) { return $null }
  try { return (Get-Content -LiteralPath $arq -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return $null }
}

function Url-Segura([string]$u) {
  return ($u -match '^https://') -or ($u -match '^http://(127\.0\.0\.1|localhost)(:\d+)?/')
}

# ── Pareamento ───────────────────────────────────────────────────────────────
function Parear([string[]]$motores) {
  Titulo '2. Pareamento com o painel'
  if (-not (Url-Segura $FuncaoUrl)) { Parar 'O pareamento só funciona por HTTPS.' }
  $c = $Codigo
  if (-not $c) {
    Escrever '  No painel: Configurações › Estado dos motores › Instalar os motores neste computador › Gerar código.' 'Gray'
    $c = Read-Host '  Código (ex.: ABCD-EFGH)'
  }
  $c = ($c -replace '[\s-]', '').ToUpper()
  if ($c.Length -ne 8) { Parar 'O código tem 8 letras e números (ex.: ABCD-EFGH). Gere outro no painel.' }
  $nomeDaMaquina = $Nome
  if (-not $nomeDaMaquina) { $nomeDaMaquina = $env:COMPUTERNAME }
  $corpo = @{ acao = 'trocar'; codigo = $c; maquina = @{ nome = $nomeDaMaquina; hostname = $env:COMPUTERNAME; sistema = 'windows' } } | ConvertTo-Json -Compress
  $cab = @{}
  if ($ChavePublica) { $cab['apikey'] = $ChavePublica; $cab['Authorization'] = "Bearer $ChavePublica" }
  try {
    $r = Invoke-RestMethod -Uri $FuncaoUrl -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($corpo)) -Headers $cab -TimeoutSec 60 -ErrorAction Stop
  } catch {
    $msg = $null
    try {
      $s = $_.Exception.Response.GetResponseStream()
      $msg = ((New-Object IO.StreamReader($s, [Text.Encoding]::UTF8)).ReadToEnd() | ConvertFrom-Json).mensagem
    } catch { }
    if (-not $msg) { $msg = 'Não consegui falar com o painel (internet?). Tente de novo.' }
    Parar "  $msg"
  }
  if (-not $r.ok -or -not $r.chave_de_servico) { Parar '  O painel não confirmou o pareamento. Gere outro código.' }
  # A chave vai direto para o cofre DPAPI e some da memória deste script.
  Gravar-Cofre @{ SUPABASE_SERVICE_ROLE_KEY = [string]$r.chave_de_servico }
  $r.chave_de_servico = $null
  Ok "máquina pareada: $($r.maquina.nome) (chave guardada no cofre do Windows deste usuário)"
  $lista = @($r.maquina.motores | Where-Object { $MOTORES_VALIDOS -contains $_ })
  if ($motores.Count) { $lista = $motores }
  Gravar-Json $ArquivoDaMaquina ([ordered]@{
      maquina_id   = [string]$r.maquina.id
      nome         = [string]$r.maquina.nome
      motores      = @($lista)
      supabase_url = $(if ($r.supabase_url) { [string]$r.supabase_url } else { $SupabaseUrl })
      painel_url   = $PainelUrl
    })
  return @{ pacote = $r.pacote; motores = @($lista) }
}

# ── Pacote ───────────────────────────────────────────────────────────────────
function Baixar-E-Extrair($pacote) {
  Titulo '3. Código dos motores'
  $zip = $PacoteLocal
  if (-not $zip) {
    if (-not $pacote -or -not $pacote.url) { Parar '  Ainda não há versão dos motores publicada no painel. Peça ao admin: npm run publicar:motores (no repositório).' }
    if (-not (Url-Segura ([string]$pacote.url))) { Parar '  O endereço do pacote não é HTTPS.' }
    New-Item -ItemType Directory -Force -Path (Join-Path $Pasta 'baixados') | Out-Null
    $zip = Join-Path $Pasta "baixados\$($pacote.versao).zip"
    Escrever "  baixando a versão $($pacote.versao)..." 'Cyan'
    try { Invoke-WebRequest -Uri ([string]$pacote.url) -OutFile $zip -UseBasicParsing -TimeoutSec 900 -ErrorAction Stop } catch { Parar "  Não consegui baixar o pacote: $($_.Exception.Message)" }
  }
  $hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLower()
  if ($pacote -and $pacote.sha256 -and $hash -ne ([string]$pacote.sha256).ToLower()) {
    Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
    Parar '  O pacote baixado não confere com o painel (sha256). Nada foi instalado; tente de novo.'
  }
  Ok "pacote conferido (sha256 $($hash.Substring(0, 12))…)"
  $versao = $(if ($pacote -and $pacote.versao) { [string]$pacote.versao } else { 'l' + $hash.Substring(0, 9) })
  $destino = Join-Path $Pasta "versoes\$versao"
  $tmp = "$destino.extraindo"
  if (Test-Path $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  & $Tar -xf $zip -C $tmp 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $tmp 'workers\supervisor\preparar.ts'))) { Parar '  O pacote não abriu (tar). Baixe de novo pelo painel.' }
  if (Test-Path $destino) {
    Get-ChildItem -LiteralPath (Join-Path $destino 'workers') -Directory -ErrorAction SilentlyContinue | ForEach-Object {
      $nm = Join-Path $_.FullName 'node_modules'
      if ((Test-Path $nm) -and ((Get-Item $nm -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { cmd /c rmdir "$nm" | Out-Null }
    }
    Remove-Item -LiteralPath $destino -Recurse -Force
  }
  Move-Item -LiteralPath $tmp -Destination $destino
  if (-not $PacoteLocal) { Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue }
  Ok "versão $versao em $destino"
  return $destino
}

function Preparar([string]$script, [string[]]$motores, [string]$doClone = '') {
  Titulo '4. Dependências dos motores'
  $node = Node-Exe
  $argumentos = @($script, '--pasta', $Pasta, '--motores', ($motores -join ','))
  if ($doClone) { $argumentos += @('--do-clone', $doClone) }
  if ($SemNpm) { $argumentos += '--sem-npm' }
  $saida = & $node @argumentos 2>&1 | ForEach-Object { $l = [string]$_; if ($l -notmatch '^VERSAO=') { Escrever "  $l" }; $l }
  if ($LASTEXITCODE -ne 0) { Parar '  A preparação parou (veja acima). Rode o instalador de novo: o que já foi baixado é reaproveitado.' }
  $v = ($saida | Where-Object { $_ -match '^VERSAO=' } | Select-Object -Last 1) -replace '^VERSAO=', ''
  Ok "dependências prontas (versão $v)"
  return $v
}

# ── Início com o Windows, invisível ─────────────────────────────────────────
function Argumentos-Do-Lancador([string]$node) {
  return "--headless `"$node`" `"$Lancador`" --pasta `"$Pasta`""
}

function Criar-Atalho([string]$node, [string]$versao) {
  Titulo '5. Abrir junto com o Windows, sem janela'
  $icone = Join-Path $Pasta 'aceleriq.ico'
  $bandeja = Join-Path $Pasta "versoes\$versao\workers\supervisor\bandeja\bandeja.ps1"
  if (Test-Path $bandeja) { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $bandeja -Icone $icone | Out-Null }
  if ($SemInicioAutomatico) { Aviso 'início automático não registrado (-SemInicioAutomatico)'; return }
  New-Item -ItemType Directory -Force -Path $PastaInicializar | Out-Null
  $w = New-Object -ComObject WScript.Shell
  $l = $w.CreateShortcut($Atalho)
  $l.TargetPath = $Conhost
  $l.Arguments = Argumentos-Do-Lancador $node
  $l.WorkingDirectory = $Pasta
  $l.WindowStyle = 7
  $l.Description = 'Aceleriq Motores: liga os motores do painel sem janela (ícone perto do relógio).'
  if (Test-Path $icone) { $l.IconLocation = "$icone,0" }
  $l.Save()
  Ok "atalho na pasta Inicializar: $Atalho (aparece em Gerenciador de Tarefas › Aplicativos de inicialização)"
}

function Comando([string]$c, [int]$prazo = 20) {
  $node = Node-Exe
  if (-not (Test-Path $Lancador) -or -not $node) { return $null }
  $saida = & $node $Lancador --pasta $Pasta --comando $c 2>$null
  try { return (($saida -join "`n") | ConvertFrom-Json) } catch { return $null }
}

function Parar-Supervisor-Atual {
  $r = Comando 'estado'
  if (-not $r -or -not $r.ok) { return }
  Escrever '  já há um Aceleriq Motores ligado: peço para ele parar com calma (espera trabalhos em curso)...' 'Cyan'
  [void](Comando 'sair')
  $ate = (Get-Date).AddMinutes(90)
  while ((Get-Date) -lt $ate) {
    Start-Sleep -Seconds 3
    $e = Comando 'estado'
    if (-not $e -or -not $e.ok) { Ok 'o supervisor anterior parou'; return }
  }
  Parar '  O supervisor anterior ainda está terminando um trabalho. Rode o instalador de novo mais tarde.'
}

function Ligar([string]$node) {
  Titulo '6. Ligando'
  if ($SemLigar) { Aviso 'não liguei agora (-SemLigar)'; return }
  Start-Process -FilePath $Conhost -ArgumentList (Argumentos-Do-Lancador $node) -WorkingDirectory $Pasta -WindowStyle Hidden
  $ate = (Get-Date).AddSeconds(45)
  $e = $null
  while ((Get-Date) -lt $ate) {
    Start-Sleep -Seconds 2
    $e = Comando 'estado'
    if ($e -and $e.ok) { break }
  }
  if (-not $e -or -not $e.ok) {
    Aviso "o supervisor ainda não respondeu; veja os registros em $(Join-Path $Pasta 'logs')"
    return
  }
  Ok 'Aceleriq Motores ligado (ícone perto do relógio; pode estar nos ícones ocultos ^)'
  foreach ($m in $MOTORES_VALIDOS) {
    $s = $e.resposta.motores.$m.situacao
    if ($s) { Escrever ("  {0,-28} {1}" -f $NOMES[$m], $s) }
  }
}

function Motores-Pedidos([string[]]$padrao) {
  if ($Motores.Count) {
    $l = @($Motores | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $MOTORES_VALIDOS -contains $_ })
    return $l
  }
  return $padrao
}

# ── Migrar: o que roda nas janelas antigas ───────────────────────────────────
function Ler-Usuario([string]$n) {
  $v = [Environment]::GetEnvironmentVariable($n, 'User')
  if ($v -and $v.Trim()) { return $v.Trim() }
  return $null
}

function Executores {
  $h = $env:COMPUTERNAME
  return @{
    render    = $(if (Ler-Usuario 'RENDER_WORKER_NOME') { Ler-Usuario 'RENDER_WORKER_NOME' } else { "$h-render" })
    codigo    = $(if (Ler-Usuario 'MOTOR_EXECUTOR') { Ler-Usuario 'MOTOR_EXECUTOR' } else { "agencia-$h" })
    navegador = $(if (Ler-Usuario 'COMPUTADOR_EXECUTOR') { Ler-Usuario 'COMPUTADOR_EXECUTOR' } else { "$h-navegador" })
  }
}

function Trabalhos-Em-Curso([string]$url, [string]$chave) {
  $cab = @{ apikey = $chave; Authorization = "Bearer $chave" }
  $e = Executores
  $base = $url.TrimEnd('/') + '/rest/v1/'
  $ocupados = @()
  $consultas = @(
    @{ m = 'codigo'; q = "motor_trabalhos?select=id,tipo&executor=eq.$([uri]::EscapeDataString($e.codigo))&estado=in.(executando,parando)" },
    @{ m = 'render'; q = "render_pedidos?select=id,tipo&worker=eq.$([uri]::EscapeDataString($e.render))&estado=eq.rodando" },
    @{ m = 'navegador'; q = "agente_computador_tarefas?select=id,caso&executor=eq.$([uri]::EscapeDataString($e.navegador))&estado=eq.executando" }
  )
  foreach ($c in $consultas) {
    try {
      $linhas = @(Invoke-RestMethod -Uri ($base + $c.q) -Headers $cab -TimeoutSec 20 -ErrorAction Stop)
      foreach ($l in $linhas) { if ($l.id) { $ocupados += "$($NOMES[$c.m]): $(if ($l.tipo) { $l.tipo } else { $l.caso }) $($l.id)" } }
    } catch {
      $ocupados += "$($NOMES[$c.m]): não consegui conferir no banco ($($_.Exception.Message))"
    }
  }
  return $ocupados
}

function Processos-Antigos {
  $todos = @(Get-CimInstance Win32_Process)
  $janelas = @($todos | Where-Object { $_.CommandLine -and ($_.CommandLine -match 'ligar-motores\.ps1' -or $_.CommandLine -match 'workers\\ligar\\[a-z-]+\.cmd') })
  $ids = @{}
  foreach ($j in $janelas) { $ids[[uint32]$j.ProcessId] = $true }
  $workers = @($todos | Where-Object { $_.Name -eq 'node.exe' -and $ids.ContainsKey([uint32]$_.ParentProcessId) })
  return @{ janelas = $janelas; workers = $workers }
}

function Migrar {
  Escrever 'Aceleriq Motores: migrar esta máquina (as janelas antigas viram o supervisor invisível)' 'White'
  $preparar = Join-Path $Origem 'workers\supervisor\preparar.ts'
  if (-not (Test-Path $preparar)) { Parar "O clone $Origem ainda não tem o Aceleriq Motores (workers\supervisor). Rode antes: git -C $Origem pull --ff-only" }
  $motores = Motores-Pedidos $MOTORES_VALIDOS
  if (-not $SemDependencias) { Garantir-Dependencias $motores }
  $node = Node-Exe

  Titulo '2. Chaves: das variáveis do usuário para o cofre do Windows (DPAPI)'
  $servico = Ler-Usuario 'SUPABASE_SERVICE_ROLE_KEY'
  if (-not $servico) { $servico = (Ler-Cofre)['SUPABASE_SERVICE_ROLE_KEY'] }
  if (-not $servico) { Parar '  Falta SUPABASE_SERVICE_ROLE_KEY nas variáveis do usuário (e no cofre). Use o modo instalar, com o código do painel.' }
  $novas = @{}
  foreach ($n in $CHAVES_DO_COFRE) { $v = Ler-Usuario $n; if ($v) { $novas[$n] = $v } }
  Gravar-Cofre $novas
  Ok "guardadas no cofre: $(@($novas.Keys | Sort-Object) -join ', ') (o valor não aparece)"
  $novas = $null
  $url = Ler-Usuario 'SUPABASE_URL'
  if (-not $url) { $url = $SupabaseUrl }
  $m = Ler-Json $ArquivoDaMaquina
  Gravar-Json $ArquivoDaMaquina ([ordered]@{
      maquina_id   = $(if ($m -and $m.maquina_id) { [string]$m.maquina_id } else { $null })
      nome         = $(if ($Nome) { $Nome } elseif ($m -and $m.nome) { [string]$m.nome } else { $env:COMPUTERNAME })
      motores      = @($motores)
      supabase_url = $url
      painel_url   = $PainelUrl
    })
  Ok "máquina: $(if ($Nome) { $Nome } else { $env:COMPUTERNAME }) · motores: $($motores -join ', ')"

  $versao = Preparar $preparar $motores $Origem
  Criar-Atalho $node $versao

  Titulo '6. Janelas antigas'
  $antigos = Processos-Antigos
  if ($Ensaiar) {
    Escrever '  ENSAIO: nada é fechado nem ligado.' 'Yellow'
    foreach ($p in $antigos.workers) { Escrever "    worker que seria fechado: pid $($p.ProcessId) (pai $($p.ParentProcessId))" }
    foreach ($j in $antigos.janelas) { Escrever "    janela que seria fechada: pid $($j.ProcessId) $($j.Name)" }
    $ocupados = @(Trabalhos-Em-Curso $url $servico)
    if ($ocupados.Count) { $ocupados | ForEach-Object { Escrever "    em curso agora (esperaria terminar): $_" 'Yellow' } } else { Ok 'nenhum trabalho em curso agora' }
    $servico = $null
    Titulo 'Ensaio concluído. Rode sem -Ensaiar para migrar de verdade.'
    exit 0
  }
  if ($antigos.workers.Count -eq 0) {
    Ok 'nenhum worker em janela agora'
  } else {
    $ate = (Get-Date).AddHours(3)
    for (;;) {
      $ocupados = @(Trabalhos-Em-Curso $url $servico)
      if (-not $ocupados.Count) { break }
      if ($NaoEsperar) {
        Escrever '  Há trabalho em curso; não fechei nada (-NaoEsperar):' 'Yellow'
        $ocupados | ForEach-Object { Escrever "    $_" 'Yellow' }
        Escrever '  Rode de novo quando terminar (o que já foi preparado é reaproveitado).' 'Yellow'
        exit 3
      }
      if ((Get-Date) -gt $ate) { Parar '  Passaram 3 horas e ainda há trabalho em curso. Rode de novo mais tarde.' 3 }
      Escrever "  esperando terminar (confiro a cada 20 s; nada é derrubado no meio):" 'Cyan'
      $ocupados | ForEach-Object { Escrever "    $_" }
      Start-Sleep -Seconds 20
    }
    # Ocioso agora: fecha na hora (a janela entre conferir e fechar é de um segundo).
    $antigos = Processos-Antigos
    foreach ($p in $antigos.workers) { & taskkill.exe /PID $p.ProcessId /T /F | Out-Null }
    Start-Sleep -Seconds 1
    foreach ($j in $antigos.janelas) { try { Stop-Process -Id $j.ProcessId -Force -ErrorAction Stop } catch { } }
    Ok "fechei $($antigos.workers.Count) worker(s) e $($antigos.janelas.Count) janela(s) antiga(s)"
    $depois = @(Trabalhos-Em-Curso $url $servico)
    if ($depois.Count) {
      Aviso 'um trabalho começou no último segundo e ficou sem worker; o banco solta sozinho em até 10 min e o painel mostra:'
      $depois | ForEach-Object { Aviso "  $_" }
    }
    Escrever '  As abas antigas do Terminal podem mostrar "processo encerrado": pode fechá-las.' 'Gray'
  }
  $servico = $null

  Parar-Supervisor-Atual
  Ligar $node
  if ($LimparVariaveis) {
    foreach ($n in $CHAVES_DO_COFRE) { if (Ler-Usuario $n) { [Environment]::SetEnvironmentVariable($n, $null, 'User') } }
    Ok 'chaves apagadas das variáveis do usuário (agora só no cofre DPAPI)'
  } else {
    Escrever '  As chaves continuam também nas variáveis do usuário (para os atalhos antigos). Para deixar só no cofre, rode de novo com -LimparVariaveis.' 'Gray'
  }
  Titulo 'Pronto. Os motores desta máquina rodam sem janela e abrem sozinhos com o Windows.'
}

function Instalar {
  Escrever 'Aceleriq Motores: instalar os motores neste computador' 'White'
  Escrever "  pasta: $Pasta" 'Gray'
  $pedidos = Motores-Pedidos @()
  if (-not $SemDependencias) {
    # Antes do pareamento: os motores ainda não são conhecidos, então confere tudo o que eles podem precisar.
    Garantir-Dependencias $(if ($pedidos.Count) { $pedidos } else { $MOTORES_VALIDOS })
  } else {
    if (-not (Node-Exe)) { Parar 'Falta o Node.js (rode sem -SemDependencias).' }
  }
  $p = Parear $pedidos
  $destino = Baixar-E-Extrair $p.pacote
  Parar-Supervisor-Atual
  $versao = Preparar (Join-Path $destino 'workers\supervisor\preparar.ts') $p.motores
  $node = Node-Exe
  Criar-Atalho $node $versao
  Ligar $node
  Titulo 'Pronto. Os motores desta máquina rodam sem janela e abrem sozinhos com o Windows.'
  Escrever "  Ícone da Aceleriq perto do relógio: verde = tudo ligado, amarelo = atenção, vermelho = parado." 'Gray'
  Escrever "  A máquina aparece no painel em Configurações › Estado dos motores em até 30 s." 'Gray'
}

function Desinstalar {
  Escrever 'Aceleriq Motores: desinstalar deste computador' 'White'
  Parar-Supervisor-Atual
  if (Test-Path $Atalho) { Remove-Item -LiteralPath $Atalho -Force; Ok 'início automático removido' }
  if (Test-Path $Cofre) { Remove-Item -LiteralPath $Cofre -Force; Ok 'cofre apagado (a chave não fica nesta máquina)' }
  if ($ApagarTudo -and (Test-Path $Pasta)) {
    Get-ChildItem -LiteralPath (Join-Path $Pasta 'versoes') -Directory -ErrorAction SilentlyContinue | ForEach-Object {
      Get-ChildItem -LiteralPath (Join-Path $_.FullName 'workers') -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $nm = Join-Path $_.FullName 'node_modules'
        if (Test-Path $nm) { cmd /c rmdir "$nm" | Out-Null }
      }
    }
    Remove-Item -LiteralPath $Pasta -Recurse -Force
    Ok "pasta $Pasta apagada"
  }
  Escrever '  No painel, use "Remover máquina" para tirar esta máquina da lista.' 'Gray'
}

function Conferir {
  Escrever 'Aceleriq Motores: conferência' 'White'
  if (Test-Path $Atalho) { Ok "início automático: $Atalho" } else { Aviso 'sem início automático' }
  if (Test-Path $Cofre) { Ok 'cofre DPAPI presente' } else { Falha 'sem cofre (máquina não pareada)' }
  $a = Ler-Json (Join-Path $Pasta 'atual.json')
  if ($a) { Ok "versão $($a.versao)$(if ($a.em_teste) { ' (em prova)' })$(if ($a.anterior) { "; anterior $($a.anterior)" })" } else { Aviso 'nenhuma versão instalada' }
  $m = Ler-Json $ArquivoDaMaquina
  if ($m) { Ok "máquina $($m.nome) · motores: $(@($m.motores) -join ', ')$(if ($m.pausado) { ' · PAUSADA' })$(if ($m.revogada) { ' · REMOVIDA NO PAINEL' })" }
  $e = Comando 'estado'
  if ($e -and $e.ok) {
    Ok 'supervisor ligado'
    foreach ($k in $MOTORES_VALIDOS) { $s = $e.resposta.motores.$k.situacao; if ($s) { Escrever ("  {0,-28} {1}" -f $NOMES[$k], $s) } }
  } else { Aviso 'supervisor desligado' }
}

switch ($Modo) {
  'instalar' { Instalar }
  'migrar-desta-maquina' { Migrar }
  'desinstalar' { Desinstalar }
  'conferir' { Conferir }
}
# Chegou aqui: deu certo (o código do último programa chamado não conta).
exit 0
