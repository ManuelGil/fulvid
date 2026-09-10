# Optional Authenticode signing of the Windows Setup zip.
# Missing credentials skip signing; artifacts are kept.
[CmdletBinding()]
param(
  [string] $CertificateBase64 = $env:WINDOWS_CERTIFICATE,
  [string] $CertificatePassword = $env:WINDOWS_CERTIFICATE_PASSWORD
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Artifacts = Join-Path $Root "artifacts"

function Fail([string] $Message) {
  Write-Error $Message
  exit 1
}

if (-not $IsWindows) {
  Fail "Authenticode signing must run on Windows"
}

if ([string]::IsNullOrWhiteSpace($CertificateBase64)) {
  Write-Host "WINDOWS_CERTIFICATE unset - Windows artifacts remain without Authenticode"
  exit 0
}

$pfx = Join-Path $env:TEMP ("fulvid-windows-code-sign-" + [guid]::NewGuid().ToString() + ".pfx")
$stageRoots = New-Object System.Collections.Generic.List[string]

try {
  [IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($CertificateBase64))

  $signtool = Get-ChildItem -Path "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending |
    Select-Object -First 1 -ExpandProperty FullName
  if (-not $signtool) {
    Fail "signtool.exe not found"
  }

  $zips = Get-ChildItem -Path $Artifacts -File -Filter "fulvid_*_win-x64-Setup.zip"
  if (-not $zips) {
    Fail "No canonical Windows Setup zip found under artifacts/"
  }

  foreach ($zip in $zips) {
    $stage = Join-Path $env:TEMP ("fulvid-win-sign-" + [guid]::NewGuid().ToString())
    $stageRoots.Add($stage) | Out-Null
    New-Item -ItemType Directory -Path $stage | Out-Null
    Expand-Archive -Path $zip.FullName -DestinationPath $stage -Force
    Get-ChildItem -Path $stage -Recurse -Filter *.exe | ForEach-Object {
      & $signtool sign /f $pfx /p $CertificatePassword /tr http://timestamp.digicert.com /td sha256 /fd sha256 $_.FullName
      if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    Remove-Item $zip.FullName -Force
    Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip.FullName -Force
  }

  $manifestPath = Join-Path $Artifacts "release-manifest.json"
  if (Test-Path $manifestPath) {
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.signing.platform_native) {
      $manifest.signing.platform_native.status = "applied"
      $manifest.signing.platform_native.note = "Authenticode applied to Setup zip executables. This is not Fulvid PGP."
    }
    $json = $manifest | ConvertTo-Json -Depth 8
    Set-Content -Path $manifestPath -Value ($json.TrimEnd() + "`n") -Encoding utf8NoBOM
  }

  Write-Host "Windows Authenticode signing complete"
}
finally {
  if (Test-Path -LiteralPath $pfx) {
    Remove-Item -LiteralPath $pfx -Force -ErrorAction SilentlyContinue
  }
  foreach ($stage in $stageRoots) {
    if (Test-Path -LiteralPath $stage) {
      Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}
