param([Parameter(Mandatory=$true)][string]$PostgresBin)
$ErrorActionPreference='Stop'
$repoMembros=Split-Path -Parent $PSScriptRoot
$binMembros=[IO.Path]::GetFullPath($PostgresBin)
foreach($exe in @('initdb.exe','pg_ctl.exe','psql.exe','createdb.exe')){if(!(Test-Path -LiteralPath (Join-Path $binMembros $exe))){throw "Runtime PostgreSQL existente incompleto: $exe"}}
$runMembros=Join-Path $repoMembros ('outputs/membros-sql-'+[DateTime]::UtcNow.ToString('yyyyMMddHHmmss'))
New-Item -ItemType Directory -Path $runMembros | Out-Null
$dataMembros=Join-Path $runMembros 'data'
$socketMembros=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
$socketMembros.Start();$portMembros=$socketMembros.LocalEndpoint.Port;$socketMembros.Stop()
$startedMembros=$false
function Run-PgMembros([string]$program,[string[]]$arguments){
  $stdoutMembros=Join-Path $runMembros ($program+'.stdout.log')
  $stderrMembros=Join-Path $runMembros ($program+'.stderr.log')
  $quotedMembros=@($arguments | ForEach-Object {'"'+$_.Replace('"','\"')+'"'})
  $processoMembros=Start-Process -FilePath (Join-Path $binMembros $program) -ArgumentList $quotedMembros -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutMembros -RedirectStandardError $stderrMembros
  # Start-Process -Wait espera também o postgres filho do pg_ctl no Windows.
  # Aqui aguardamos apenas o comando iniciado; o servidor é encerrado no finally.
  $processoMembros.WaitForExit()
  Get-Content -LiteralPath $stdoutMembros
  Get-Content -LiteralPath $stderrMembros
  if($processoMembros.ExitCode -ne 0){throw "Falha no verificador $program"}
}
try {
  Run-PgMembros 'initdb.exe' @('-D',$dataMembros,'-U','postgres','--auth-local=trust','--auth-host=trust','--encoding=UTF8','--no-locale','--no-sync')
  # O processo de fundo é iniciado pelo pg_ctl sem abrir janela de terminal.
  Run-PgMembros 'pg_ctl.exe' @('-D',$dataMembros,'-l',(Join-Path $runMembros 'postgres.log'),'-o',"-h 127.0.0.1 -p $portMembros",'-w','start')
  $startedMembros=$true
  Run-PgMembros 'createdb.exe' @('-h','127.0.0.1','-p',"$portMembros",'-U','postgres','membros_test')
  foreach($sqlMembros in @('supabase/tests/membros/bootstrap.sql','supabase/migrations/20261020150633_area_membros_biblioteca.sql','supabase/tests/membros/permissoes.sql')){
    Run-PgMembros 'psql.exe' @('-X','-h','127.0.0.1','-p',"$portMembros",'-U','postgres','-d','membros_test','-v','ON_ERROR_STOP=1','-f',(Join-Path $repoMembros $sqlMembros))
  }
  Run-PgMembros 'pg_ctl.exe' @('-D',$dataMembros,'-m','fast','-w','stop')
  $startedMembros=$false
  Run-PgMembros 'pg_ctl.exe' @('-D',$dataMembros,'-l',(Join-Path $runMembros 'postgres.log'),'-o',"-h 127.0.0.1 -p $portMembros",'-w','start')
  $startedMembros=$true
  Run-PgMembros 'psql.exe' @('-X','-h','127.0.0.1','-p',"$portMembros",'-U','postgres','-d','membros_test','-v','ON_ERROR_STOP=1','-f',(Join-Path $repoMembros 'supabase/tests/membros/persistencia.sql'))
} finally {if($startedMembros){Run-PgMembros 'pg_ctl.exe' @('-D',$dataMembros,'-m','fast','-w','stop')}}
Write-Output "Teste isolado concluído; PostgreSQL encerrado. Relatórios locais: $runMembros"
