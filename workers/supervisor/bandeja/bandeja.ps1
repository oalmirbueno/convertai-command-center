<#
  Ícone da bandeja do Aceleriq Motores (frente SUP, 01/10/2026).

  Processo auxiliar oculto: o supervisor abre este script com windowsHide e
  conversa por cano, uma linha JSON por mensagem.
    supervisor -> bandeja (stdin):  {"tipo":"estado","cor":"verde|amarelo|vermelho|cinza","dica":"...","titulo":"...",
                                     "motores":[{"nome":"Render","texto":"ligado"}],"pausado":false,"painel":"https://..."}
                                    {"tipo":"aviso","titulo":"...","texto":"..."}   (balão discreto)
    bandeja -> supervisor (stdout): {"acao":"abrir|ver-estado|reiniciar|pausar|retomar|registros|sair"}
  Só um clique do dono no menu manda "abrir"/"ver-estado"/"registros" (o supervisor ainda freia: 1 a cada 10 s).
  Fechou o stdin (supervisor saiu): o ícone some e o script termina.

  -Amostra <pasta>: desenha os ícones (verde, amarelo, vermelho) e o menu em PNG, para conferência, e sai.
  -Icone <arquivo.ico>: grava o ícone da marca (sem o ponto de estado) para o atalho do Windows, e sai.
#>
param(
  [string]$Marca = (Join-Path $PSScriptRoot 'marca.png'),
  [string]$Amostra = '',
  [string]$Icone = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$CORES = @{
  verde    = [System.Drawing.Color]::FromArgb(255, 0, 255, 102)   # verde Aceleriq #00FF66
  amarelo  = [System.Drawing.Color]::FromArgb(255, 245, 180, 0)
  vermelho = [System.Drawing.Color]::FromArgb(255, 239, 68, 68)
  cinza    = [System.Drawing.Color]::FromArgb(255, 140, 140, 140)
}
$FUNDO = [System.Drawing.Color]::FromArgb(255, 14, 14, 14)

$script:imagemDaMarca = $null
if (Test-Path -LiteralPath $Marca) { $script:imagemDaMarca = [System.Drawing.Image]::FromFile($Marca) }

function Novo-Bitmap([string]$cor, [int]$lado, [switch]$SemPonto) {
  $bmp = New-Object System.Drawing.Bitmap $lado, $lado
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  # Fundo: quadrado escuro de cantos redondos (o mesmo do ícone do painel).
  $r = [Math]::Max(3, [int]($lado * 0.22))
  $caminho = New-Object System.Drawing.Drawing2D.GraphicsPath
  $caminho.AddArc(0, 0, $r * 2, $r * 2, 180, 90)
  $caminho.AddArc($lado - 1 - $r * 2, 0, $r * 2, $r * 2, 270, 90)
  $caminho.AddArc($lado - 1 - $r * 2, $lado - 1 - $r * 2, $r * 2, $r * 2, 0, 90)
  $caminho.AddArc(0, $lado - 1 - $r * 2, $r * 2, $r * 2, 90, 90)
  $caminho.CloseFigure()
  $pincel = New-Object System.Drawing.SolidBrush $FUNDO
  $g.FillPath($pincel, $caminho)
  # Marca: o símbolo da Aceleriq, um pouco acima e à esquerda (o ponto de estado fica no canto).
  if ($script:imagemDaMarca) {
    $m = [int]($lado * 0.84)
    $g.DrawImage($script:imagemDaMarca, [int]($lado * 0.03), [int]($lado * 0.05), $m, $m)
  } else {
    $fonte = New-Object System.Drawing.Font 'Segoe UI', ([single]($lado * 0.55)), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
    $g.DrawString('A', $fonte, [System.Drawing.Brushes]::White, [single]($lado * 0.12), [single]($lado * 0.05))
  }
  if ($SemPonto) { $g.Dispose(); return $bmp }
  # Ponto de estado com anel escuro (lê bem em barra clara e escura).
  $d = [int]([Math]::Max(6, $lado * 0.38))
  $x = $lado - $d - 1
  $anel = New-Object System.Drawing.SolidBrush $FUNDO
  $g.FillEllipse($anel, $x - 1, $x - 1, $d + 2, $d + 2)
  $ponto = New-Object System.Drawing.SolidBrush $CORES[$cor]
  $g.FillEllipse($ponto, $x + 1, $x + 1, $d - 2, $d - 2)
  $g.Dispose()
  return $bmp
}

function Novo-Icone([string]$cor) {
  $lado = [Math]::Max(16, [System.Windows.Forms.SystemInformation]::SmallIconSize.Width)
  $bmp = Novo-Bitmap $cor $lado
  return [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
}

# Menu escuro e discreto, no tom do painel.
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System.Drawing;
using System.Windows.Forms;
public class CoresAceleriq : ProfessionalColorTable {
  static Color F = Color.FromArgb(22, 22, 22);
  static Color S = Color.FromArgb(38, 38, 38);
  static Color B = Color.FromArgb(48, 48, 48);
  public override Color ToolStripDropDownBackground { get { return F; } }
  public override Color ImageMarginGradientBegin { get { return F; } }
  public override Color ImageMarginGradientMiddle { get { return F; } }
  public override Color ImageMarginGradientEnd { get { return F; } }
  public override Color MenuBorder { get { return B; } }
  public override Color MenuItemBorder { get { return S; } }
  public override Color MenuItemSelected { get { return S; } }
  public override Color MenuItemSelectedGradientBegin { get { return S; } }
  public override Color MenuItemSelectedGradientEnd { get { return S; } }
  public override Color MenuItemPressedGradientBegin { get { return S; } }
  public override Color MenuItemPressedGradientEnd { get { return S; } }
  public override Color SeparatorDark { get { return B; } }
  public override Color SeparatorLight { get { return F; } }
}
public class RenderizadorAceleriq : ToolStripProfessionalRenderer {
  public RenderizadorAceleriq() : base(new CoresAceleriq()) { RoundedEdges = false; }
  protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e) {
    e.TextColor = e.Item.Enabled ? Color.FromArgb(236, 236, 236) : Color.FromArgb(150, 150, 150);
    base.OnRenderItemText(e);
  }
  protected override void OnRenderArrow(ToolStripArrowRenderEventArgs e) {
    e.ArrowColor = Color.FromArgb(180, 180, 180);
    base.OnRenderArrow(e);
  }
}
'@

$fonteDoMenu = New-Object System.Drawing.Font 'Segoe UI', 9
$fonteDoTitulo = New-Object System.Drawing.Font 'Segoe UI Semibold', 9

$script:painel = 'https://aceleriq.online'
$script:pausado = $false

function Mandar([string]$acao) {
  [Console]::Out.WriteLine('{"acao":"' + $acao + '"}')
  [Console]::Out.Flush()
}

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$menu.Renderer = New-Object RenderizadorAceleriq
$menu.Font = $fonteDoMenu
$menu.ShowImageMargin = $false

$itemTitulo = New-Object System.Windows.Forms.ToolStripMenuItem 'Aceleriq Motores'
$itemTitulo.Font = $fonteDoTitulo
$itemTitulo.Enabled = $false
$itemResumo = New-Object System.Windows.Forms.ToolStripMenuItem 'Conferindo...'
$itemResumo.Enabled = $false
$itemAbrir = New-Object System.Windows.Forms.ToolStripMenuItem 'Abrir o painel'
$itemEstado = New-Object System.Windows.Forms.ToolStripMenuItem 'Estado dos motores'
$itemReiniciar = New-Object System.Windows.Forms.ToolStripMenuItem 'Reiniciar'
$itemPausar = New-Object System.Windows.Forms.ToolStripMenuItem 'Pausar'
$itemRegistros = New-Object System.Windows.Forms.ToolStripMenuItem 'Ver registros'
$itemSair = New-Object System.Windows.Forms.ToolStripMenuItem 'Sair'

$itemAbrir.add_Click({ Mandar 'abrir' })
$itemReiniciar.add_Click({ Mandar 'reiniciar' })
$itemPausar.add_Click({ if ($script:pausado) { Mandar 'retomar' } else { Mandar 'pausar' } })
$itemRegistros.add_Click({ Mandar 'registros' })
$itemSair.add_Click({ Mandar 'sair' })

[void]$menu.Items.Add($itemTitulo)
[void]$menu.Items.Add($itemResumo)
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
[void]$menu.Items.Add($itemAbrir)
[void]$menu.Items.Add($itemEstado)
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
[void]$menu.Items.Add($itemReiniciar)
[void]$menu.Items.Add($itemPausar)
[void]$menu.Items.Add($itemRegistros)
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
[void]$menu.Items.Add($itemSair)
$itemEstado.DropDown.Renderer = $menu.Renderer
$itemEstado.DropDown.Font = $fonteDoMenu

function Montar-Estado($e) {
  $itemEstado.DropDownItems.Clear()
  foreach ($m in @($e.motores)) {
    if (-not $m) { continue }
    $i = New-Object System.Windows.Forms.ToolStripMenuItem ("{0}: {1}" -f $m.nome, $m.texto)
    $i.Enabled = $false
    [void]$itemEstado.DropDownItems.Add($i)
  }
  if ($itemEstado.DropDownItems.Count) { [void]$itemEstado.DropDownItems.Add((New-Object System.Windows.Forms.ToolStripSeparator)) }
  $ver = New-Object System.Windows.Forms.ToolStripMenuItem 'Ver no painel'
  $ver.add_Click({ Mandar 'ver-estado' })
  [void]$itemEstado.DropDownItems.Add($ver)
}

$script:icones = @{}
function Icone([string]$cor) {
  if (-not $CORES.ContainsKey($cor)) { $cor = 'cinza' }
  if (-not $script:icones.ContainsKey($cor)) { $script:icones[$cor] = Novo-Icone $cor }
  return $script:icones[$cor]
}

function Aplicar($e) {
  if ($e.painel) { $script:painel = [string]$e.painel }
  $script:pausado = [bool]$e.pausado
  $itemPausar.Text = $(if ($script:pausado) { 'Retomar' } else { 'Pausar' })
  if ($e.titulo) { $itemTitulo.Text = [string]$e.titulo }
  if ($e.dica) { $itemResumo.Text = [string]$e.dica }
  Montar-Estado $e
  if ($script:bandeja) {
    $script:bandeja.Icon = Icone ([string]$e.cor)
    $dica = [string]$e.dica
    if (-not $dica) { $dica = 'Aceleriq Motores' }
    # O Windows corta a dica em 63 caracteres.
    if ($dica.Length -gt 63) { $dica = $dica.Substring(0, 62) + [char]0x2026 }
    $script:bandeja.Text = $dica
  }
}

# ── Ícone do atalho (.ico com PNG dentro, Windows Vista ou mais novo) ────────
if ($Icone) {
  $b = Novo-Bitmap 'verde' 64 -SemPonto
  $ms = New-Object System.IO.MemoryStream
  $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $png = $ms.ToArray()
  $fs = [System.IO.File]::Create($Icone)
  $w = New-Object System.IO.BinaryWriter $fs
  $w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]1)
  $w.Write([Byte]64); $w.Write([Byte]64); $w.Write([Byte]0); $w.Write([Byte]0)
  $w.Write([UInt16]1); $w.Write([UInt16]32); $w.Write([UInt32]$png.Length); $w.Write([UInt32]22)
  $w.Write($png)
  $w.Close()
  exit 0
}

# ── Amostra: PNGs para conferência, sem ícone de verdade na bandeja ──────────
if ($Amostra) {
  New-Item -ItemType Directory -Force -Path $Amostra | Out-Null
  foreach ($cor in 'verde', 'amarelo', 'vermelho') {
    foreach ($lado in 16, 32, 128) {
      $b = Novo-Bitmap $cor $lado
      $b.Save((Join-Path $Amostra "icone-$cor-$lado.png"), [System.Drawing.Imaging.ImageFormat]::Png)
      $b.Dispose()
    }
  }
  $exemplo = '{"cor":"verde","titulo":"Aceleriq Motores","dica":"Tudo ligado: 3 motores","pausado":false,"motores":[{"nome":"Render (Motion e Edição)","texto":"ligado"},{"nome":"Motor de código (Site)","texto":"trabalhando"},{"nome":"Navegador do agente","texto":"ligado"}]}' | ConvertFrom-Json
  Aplicar $exemplo
  foreach ($par in @(@($menu, 'menu.png'), @($itemEstado.DropDown, 'menu-estado.png'))) {
    $c = $par[0]
    $c.Show(-4000, -4000)
    [System.Windows.Forms.Application]::DoEvents()
    $bmp = New-Object System.Drawing.Bitmap $c.Width, $c.Height
    $c.DrawToBitmap($bmp, (New-Object System.Drawing.Rectangle 0, 0, $c.Width, $c.Height))
    $bmp.Save((Join-Path $Amostra $par[1]), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $c.Hide()
  }
  exit 0
}

# ── Ícone de verdade ─────────────────────────────────────────────────────────
$script:bandeja = New-Object System.Windows.Forms.NotifyIcon
$script:bandeja.Icon = Icone 'cinza'
$script:bandeja.Text = 'Aceleriq Motores'
$script:bandeja.ContextMenuStrip = $menu
$script:bandeja.Visible = $true
# Clique simples também abre o menu (o direito já abre sozinho); duplo abre o painel.
$script:bandeja.add_MouseUp({
  param($s, $a)
  if ($a.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
    $m = [System.Windows.Forms.NotifyIcon].GetMethod('ShowContextMenu', [System.Reflection.BindingFlags]'Instance,NonPublic')
    if ($m) { $m.Invoke($script:bandeja, $null) }
  }
})
$script:bandeja.add_DoubleClick({ Mandar 'abrir' })

$entrada = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), [System.Text.Encoding]::UTF8)
$script:leitura = $entrada.ReadLineAsync()

function Fechar {
  try { $script:bandeja.Visible = $false; $script:bandeja.Dispose() } catch { }
  [System.Windows.Forms.Application]::Exit()
}

$relogio = New-Object System.Windows.Forms.Timer
$relogio.Interval = 200
$relogio.add_Tick({
  while ($script:leitura.IsCompleted) {
    if ($script:leitura.IsFaulted) { Fechar; return }
    $linha = $script:leitura.Result
    if ($null -eq $linha) { Fechar; return }
    try {
      $e = $linha | ConvertFrom-Json
      if ($e.tipo -eq 'estado') { Aplicar $e }
      elseif ($e.tipo -eq 'aviso') { $script:bandeja.ShowBalloonTip(4000, [string]$e.titulo, [string]$e.texto, [System.Windows.Forms.ToolTipIcon]::None) }
      elseif ($e.tipo -eq 'fechar') { Fechar; return }
    } catch { }
    $script:leitura = $entrada.ReadLineAsync()
  }
})
$relogio.Start()
[System.Windows.Forms.Application]::Run()
try { $script:bandeja.Visible = $false; $script:bandeja.Dispose() } catch { }
