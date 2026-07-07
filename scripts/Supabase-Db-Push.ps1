param(
  [switch]$DryRun,
  [switch]$IncludeAll,
  [switch]$LinkOnly,
  [switch]$SkipLink
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $Root
$PolicyPath = Join-Path $Root "scripts\supabase-migration-policy.json"
$MigrationsDir = Join-Path $Root "supabase\migrations"
$TempDir = Join-Path $Root "tmp\supabase-migration-runner"

function Import-DotEnvFile {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) { return }

  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
    if ($trimmed -notmatch '^(?:export\s+)?([^=]+)=(.*)$') { continue }

    $name = $Matches[1].Trim()
    $value = $Matches[2].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

Import-DotEnvFile (Join-Path $Root ".env.local")
Import-DotEnvFile (Join-Path $Root ".env.supabase.local")

$ProjectRef = if ($env:SUPABASE_PROJECT_REF) { $env:SUPABASE_PROJECT_REF } else { "pqwcpgmsutpbuvdzslbc" }
$DbPassword = $env:SUPABASE_DB_PASSWORD

if (-not $DbPassword) {
  throw @"
SUPABASE_DB_PASSWORD fehlt.

Lege lokal eine gitignored Datei .env.supabase.local oder .env.local an/ergaenze sie:
SUPABASE_PROJECT_REF=$ProjectRef
SUPABASE_DB_PASSWORD=<Datenbank-Passwort aus Supabase>

Optional fuer frische Maschinen ohne CLI-Login:
SUPABASE_ACCESS_TOKEN=<Supabase Personal Access Token>
"@
}

if (-not (Test-Path -LiteralPath (Join-Path $Root "node_modules\.bin\supabase.cmd"))) {
  throw "Supabase CLI fehlt lokal. Bitte zuerst ausfuehren: npm install"
}

function Invoke-Supabase {
  param(
    [string[]]$Arguments,
    [switch]$Json,
    [switch]$Quiet
  )

  $output = & npx.cmd @("supabase") @Arguments 2>&1
  $exitCode = $LASTEXITCODE
  $text = ($output | Out-String)
  if ($DbPassword) {
    $text = $text.Replace($DbPassword, "<aus .env.supabase.local>")
  }

  if ($exitCode -ne 0) {
    $SafeArguments = $Arguments
    for ($i = 0; $i -lt $SafeArguments.Count; $i++) {
      if ($SafeArguments[$i] -eq "--password" -and ($i + 1) -lt $SafeArguments.Count) {
        $SafeArguments[$i + 1] = "<aus .env.supabase.local>"
      }
    }
    throw "Supabase CLI fehlgeschlagen: supabase $($SafeArguments -join ' ')`n$text"
  }

  if ($Json) {
    $start = $text.IndexOf("{")
    $end = $text.LastIndexOf("}")
    if ($start -lt 0 -or $end -le $start) {
      throw "Supabase CLI lieferte kein JSON fuer: supabase $($Arguments -join ' ')`n$text"
    }
    return ($text.Substring($start, $end - $start + 1) | ConvertFrom-Json)
  }

  if (-not $Quiet -and $text.Trim()) {
    Write-Host $text.TrimEnd()
  }
}

function Invoke-DbQuery {
  param([string]$Sql)
  return Invoke-Supabase @("db", "query", "--linked", "--output", "json", $Sql) -Json
}

function Escape-SqlLiteral {
  param([AllowNull()][string]$Value)
  if ($null -eq $Value) { return "" }
  return $Value.Replace("'", "''")
}

function Get-Sha256 {
  param([string]$Path)
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $bytes = $sha.ComputeHash($stream)
    return (($bytes | ForEach-Object { $_.ToString("x2") }) -join "")
  } finally {
    if ($sha) { $sha.Dispose() }
    $stream.Dispose()
  }
}

function Get-MigrationVersionNumber {
  param([string]$FileName)
  if ($FileName -match '^(\d+)_') {
    return [int]$Matches[1]
  }
  return $null
}

if (-not $SkipLink) {
  $LinkedRefPath = Join-Path $Root "supabase\.temp\project-ref"
  $LinkedRef = if (Test-Path -LiteralPath $LinkedRefPath) { (Get-Content -LiteralPath $LinkedRefPath -Raw).Trim() } else { "" }

  if ($LinkedRef -ne $ProjectRef) {
    Write-Host "Verlinke Supabase-Projekt $ProjectRef ..."
    Invoke-Supabase @("link", "--project-ref", $ProjectRef, "--password", $DbPassword, "--yes")
  } else {
    Write-Host "Supabase-Projekt bereits verlinkt: $ProjectRef"
  }
}

if ($LinkOnly) {
  Write-Host "Supabase-Link ist eingerichtet."
  exit 0
}

if ($IncludeAll) {
  Write-Host "Hinweis: -IncludeAll wird im B4Y-Runner ignoriert; die Policy entscheidet, was angewendet wird."
}

if (-not (Test-Path -LiteralPath $PolicyPath)) {
  throw "Migrationspolicy fehlt: $PolicyPath"
}
if (-not (Test-Path -LiteralPath $MigrationsDir)) {
  throw "Migrationsordner fehlt: $MigrationsDir"
}

$Policy = Get-Content -LiteralPath $PolicyPath -Raw | ConvertFrom-Json
$BaselineThrough = [int]$Policy.baselineNumericPrefixThrough
$Skip = @{}
foreach ($entry in $Policy.skip.PSObject.Properties) {
  $Skip[$entry.Name] = [string]$entry.Value
}

$Tracked = @{}
try {
  $trackedResult = Invoke-DbQuery "select file_name, sha256, skipped, note from b4y_internal.migration_files order by file_name;"
  foreach ($row in @($trackedResult.rows)) {
    $Tracked[[string]$row.file_name] = $row
  }
} catch {
  Write-Host "Noch keine B4Y-Migrationstabelle gefunden; erster Lauf startet mit leerem Tracking."
}

$Files = Get-ChildItem -LiteralPath $MigrationsDir -Filter "*.sql" | Sort-Object Name
$Plan = @()

foreach ($file in $Files) {
  $name = $file.Name
  $version = Get-MigrationVersionNumber $name
  $sha = Get-Sha256 $file.FullName

  if ($null -ne $version -and $version -le $BaselineThrough) {
    $Plan += [pscustomobject]@{
      File = $name
      Path = $file.FullName
      Sha = $sha
      Action = "baseline"
      Note = "Remote-DB ist bis $BaselineThrough historisch anderweitig migriert."
    }
    continue
  }

  if ($Skip.ContainsKey($name)) {
    $Plan += [pscustomobject]@{
      File = $name
      Path = $file.FullName
      Sha = $sha
      Action = "skip"
      Note = $Skip[$name]
    }
    continue
  }

  if ($Tracked.ContainsKey($name)) {
    $trackedRow = $Tracked[$name]
    if ([string]$trackedRow.sha256 -ne $sha) {
      throw "Migration '$name' wurde nach Anwendung geaendert. Bitte neue Migration erstellen statt angewendete SQL-Datei zu aendern."
    }
    $Plan += [pscustomobject]@{
      File = $name
      Path = $file.FullName
      Sha = $sha
      Action = "tracked"
      Note = "Bereits vom B4Y-Runner angewendet."
    }
    continue
  }

  $Plan += [pscustomobject]@{
    File = $name
    Path = $file.FullName
    Sha = $sha
    Action = "apply"
    Note = "Noch nicht vom B4Y-Runner angewendet."
  }
}

$ToApply = @($Plan | Where-Object { $_.Action -eq "apply" })
$Skipped = @($Plan | Where-Object { $_.Action -in @("baseline", "skip", "tracked") })

Write-Host ""
Write-Host "B4Y Supabase Migration Runner"
Write-Host "Projekt: $ProjectRef"
Write-Host "Policy : $PolicyPath"
Write-Host "Offen  : $($ToApply.Count)"
Write-Host "Skip   : $($Skipped.Count)"

if ($ToApply.Count -gt 0) {
  Write-Host ""
  Write-Host "Anzuwenden:"
  foreach ($item in $ToApply) {
    Write-Host " - $($item.File)"
  }
}

if ($DryRun) {
  Write-Host ""
  Write-Host "Dry-Run: Es wurde nichts an der Datenbank geaendert."
  exit 0
}

if ($ToApply.Count -eq 0) {
  Write-Host ""
  Write-Host "Keine offenen B4Y-Migrationen."
  exit 0
}

New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

$InitSql = @"
create schema if not exists b4y_internal;
create table if not exists b4y_internal.migration_files (
  file_name text primary key,
  sha256 char(64) not null,
  skipped boolean not null default false,
  note text,
  applied_at timestamptz not null default now()
);
revoke all on schema b4y_internal from public, anon, authenticated;
revoke all on all tables in schema b4y_internal from public, anon, authenticated;
"@
$InitFile = Join-Path $TempDir "_init_b4y_internal_migration_files.sql"
Set-Content -LiteralPath $InitFile -Value $InitSql -Encoding UTF8
Invoke-Supabase @("db", "query", "--linked", "--file", $InitFile) -Quiet

foreach ($item in $ToApply) {
  Write-Host ""
  Write-Host "Wende Migration an: $($item.File)"

  $fileSql = Get-Content -LiteralPath $item.Path -Raw
  $fileNameSql = Escape-SqlLiteral $item.File
  $shaSql = Escape-SqlLiteral $item.Sha
  $noteSql = Escape-SqlLiteral $item.Note
  $trackingSql = "insert into b4y_internal.migration_files (file_name, sha256, skipped, note) values ('$fileNameSql', '$shaSql', false, '$noteSql') on conflict (file_name) do update set sha256 = excluded.sha256, skipped = false, note = excluded.note, applied_at = now();"

  $wrappedSql = @"
begin;
$fileSql

$trackingSql
commit;
"@
  $tempFile = Join-Path $TempDir $item.File
  Set-Content -LiteralPath $tempFile -Value $wrappedSql -Encoding UTF8
  Invoke-Supabase @("db", "query", "--linked", "--file", $tempFile) -Quiet
}

Write-Host ""
Write-Host "B4Y Supabase-Migrationen erfolgreich angewendet: $($ToApply.Count)"
