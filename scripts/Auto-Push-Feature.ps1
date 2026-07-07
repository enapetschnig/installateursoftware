# ============================================================
# B4Y SuperAPP – Kontrollierter Auto-Push (NUR Feature-Branches)
# ------------------------------------------------------------
# Entfernt den manuellen `git push` beim Entwickeln – OHNE die Schutzschicht
# aufzugeben. Es wird ausschließlich der AKTUELLE Aufgaben-Branch gepusht.
#
#   NIE auf main/master.  KEIN Merge.  KEIN Deploy.
#   PR → CI → Codex → Freigabe (Merge) bleiben unverändert manuell.
#
# Verwendung (in F:\Users\baranowski4\Projekte\b4y-superapp):
#   .\scripts\Auto-Push-Feature.ps1                  # einmal: add + commit + push (aktueller Branch)
#   .\scripts\Auto-Push-Feature.ps1 -Message "..."   # mit eigener Commit-Nachricht
#   .\scripts\Auto-Push-Feature.ps1 -Watch           # beobachtet Änderungen, pusht automatisch (debounced)
#
# Sicherheit: pusht NUR auf erlaubten Aufgaben-Branch-Praefixen
# (feature/ fix/ security/ refactor/ chore/ test/) – sonst Abbruch (schuetzt main/master
# UND geteilte Branches wie develop/release/*). Committet NICHT, wenn moegliche Secrets im
# Stage landen wuerden (.env*, Schluessel/Zertifikate, .npmrc, SSH-Keys, .netrc/.pgpass,
# Keystores, credentials/secret/service-account-JSON, AWS-Credentials). Pusht nur den
# aktuellen Branch. node_modules/dist/.env sind ueber .gitignore ausgeschlossen.
# ============================================================
param(
  [string]$Message = "",
  [switch]$Watch,
  [int]$DebounceSeconds = 4
)
$ErrorActionPreference = "Stop"
# Repo-Wurzel (dieses Skript liegt in scripts/)
Set-Location -Path (Split-Path $PSScriptRoot -Parent)

function Get-CurrentBranch { (git rev-parse --abbrev-ref HEAD).Trim() }

function Test-FeatureBranch {
  $b = Get-CurrentBranch
  # NUR ausdruecklich erlaubte Aufgaben-Branch-Praefixe zulassen (gemaess Branch-Regeln).
  # Schuetzt nicht nur vor main/master, sondern auch vor geteilten Branches
  # (z. B. develop, release/*, work, staging) – dort wuerde Auto-Push den PR-Workflow umgehen.
  if ($b -notmatch '^(feature|fix|security|refactor|chore|test)/.+') {
    Write-Host "ABBRUCH: aktueller Branch ist '$b'. Auto-Push ist nur fuer Aufgaben-Branches erlaubt" -ForegroundColor Red
    Write-Host "         (feature/ fix/ security/ refactor/ chore/ test/). Nach main nur per Pull Request + Freigabe." -ForegroundColor DarkGray
    return $false
  }
  return $true
}

function Invoke-AutoPush {
  if (-not (Test-FeatureBranch)) { return }
  $branch = Get-CurrentBranch
  git add -A | Out-Null
  $staged = @(git diff --cached --name-only)
  if ($staged.Count -eq 0) { return }
  # Secret-Schutz (Heuristik): blockt gaengige Geheimnis-Dateien, bevor etwas committet/gepusht wird.
  # Deckt ab: .env*, Schluessel/Zertifikate, .npmrc (Registry-Token), SSH-Keys (id_rsa/…),
  # .netrc/.pgpass, Keystores, credentials/secret/service-account-JSON, AWS-Credentials.
  $secretPattern = '(^|/)\.env|\.(key|pem|p12|pfx|pkcs12|keystore|jks|ppk|asc)$|(^|/)\.npmrc$|(^|/)\.(netrc|pgpass)$|(^|/)id_(rsa|dsa|ecdsa|ed25519)$|(^|/)(credentials|secret|secrets|service[-_]?account)[^/]*\.json$|(^|/)\.aws/credentials$'
  $secret = $staged | Where-Object { $_ -match $secretPattern }
  if ($secret) {
    git reset | Out-Null
    Write-Host "ABBRUCH: moegliche Secrets im Stage – nichts committet:" -ForegroundColor Red
    $secret | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    return
  }
  # Inhaltliche Secret-Heuristik: den gestagten Diff auf typische Geheimnis-Muster pruefen (NICHT nur
  # Dateinamen) – so wird ein versehentlich in eine normale Datei eingefuegtes Secret nicht mitgepusht.
  $diff = (git diff --cached --no-color) -join "`n"
  $contentPattern = '-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|(secret|token|api[_-]?key|passwort?|service_role)\s*[:=]\s*[''"]?[^\s''"]{12,}'
  if ($diff -match $contentPattern) {
    git reset | Out-Null
    Write-Host "ABBRUCH: moegliche Secrets im INHALT (gestagter Diff) – nichts committet. Bitte pruefen/entfernen." -ForegroundColor Red
    return
  }
  $msg = if ($Message) { $Message } else { "WIP: $branch $(Get-Date -Format 'yyyy-MM-dd HH:mm')" }
  # $ErrorActionPreference="Stop" faengt KEINE nativen git-Exitcodes ab → nach JEDEM git-Befehl
  # $LASTEXITCODE pruefen und bei Fehler abbrechen, BEVOR Erfolg gemeldet wird. So bleibt bei
  # Rebase-Konflikt / abgelehntem Push (Auth/Netz/kein Fast-Forward) kein falscher „Gepusht"-Status.
  git commit -m $msg | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Host "ABBRUCH: 'git commit' fehlgeschlagen – nichts gepusht." -ForegroundColor Red; return }
  # Upstream/Remote-Tracking vorhanden? Ein NEUER Branch hat noch keinen → dann erster Push mit -u,
  # KEIN Rebase auf eine nicht existierende Remote-Ref (sonst bricht der Helfer beim Erstpush ab).
  git rev-parse --abbrev-ref --symbolic-full-name "@{upstream}" 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    # Bestehender Branch: erst rebasen (fremde Pushes übernehmen), dann pushen
    git pull --rebase origin $branch
    if ($LASTEXITCODE -ne 0) {
      Write-Host "ABBRUCH: 'git pull --rebase' fehlgeschlagen (vermutlich Konflikt). Bitte manuell aufloesen" -ForegroundColor Red
      Write-Host "         (git rebase --abort bzw. Konflikte loesen) – es wurde NICHT gepusht." -ForegroundColor DarkGray
      return
    }
    git push origin $branch
  } else {
    # Erster Push des neuen Branches: Upstream setzen, nicht rebasen
    git push -u origin $branch
  }
  if ($LASTEXITCODE -ne 0) { Write-Host "ABBRUCH: 'git push' fehlgeschlagen (Auth/Netz/kein Fast-Forward) – bitte pruefen." -ForegroundColor Red; return }
  Write-Host ("Gepusht auf '{0}': {1} Datei(en). PR/CI/Codex/Preview aktualisieren sich – Merge bleibt manuell." -f $branch, $staged.Count) -ForegroundColor Green
}

if (-not $Watch) { Invoke-AutoPush; return }

# ── Watch-Modus: per Polling (gitignore-bewusst, ignoriert node_modules/dist) ──
if (-not (Test-FeatureBranch)) { return }
Write-Host ("Auto-Push Watch aktiv auf '{0}' – alle {1}s pruefen. Strg+C beendet." -f (Get-CurrentBranch), $DebounceSeconds) -ForegroundColor Cyan
while ($true) {
  Start-Sleep -Seconds $DebounceSeconds
  if (@(git status --porcelain).Count -gt 0) { Invoke-AutoPush }
}
