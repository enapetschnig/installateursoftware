# B4Y SuperAPP - Claude-Fix-Prompt in die Zwischenablage kopieren
# Verwendung:
#   powershell -ExecutionPolicy Bypass -File scripts/Copy-Claude-Fix-Prompt.ps1

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent
$promptPath = Join-Path $repoRoot ".codex\claude_fix_prompt.md"

if (-not (Test-Path -LiteralPath $promptPath)) {
  Write-Host "ABBRUCH: .codex\claude_fix_prompt.md wurde nicht gefunden." -ForegroundColor Red
  exit 1
}

$content = Get-Content -LiteralPath $promptPath -Raw
if ([string]::IsNullOrWhiteSpace($content)) {
  Write-Host "ABBRUCH: .codex\claude_fix_prompt.md ist leer." -ForegroundColor Red
  exit 1
}

$content | Set-Clipboard
Write-Host "Claude-Korrekturprompt wurde in die Zwischenablage kopiert." -ForegroundColor Green
