# Package Windows Fulvid artifacts. Independent of Make and Linux packaging.
#   pwsh -File packaging/windows/package.ps1
#   pwsh -File packaging/windows/package.ps1 -RefreshHashes
[CmdletBinding()]
param(
  [switch] $RefreshHashes
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Artifacts = Join-Path $Root "artifacts"

function Fail([string] $Message) {
  Write-Error $Message
  exit 1
}

function Require-Windows {
  if (-not $IsWindows) {
    Fail "Windows packaging must run on Windows"
  }
}

function Get-ProductVersion {
  $pkg = Get-Content (Join-Path $Root "package.json") -Raw | ConvertFrom-Json
  if (-not $pkg.version) { Fail "package.json version is missing" }
  return [string] $pkg.version
}

function Get-ElectrobunVersion {
  $cfg = Get-Content (Join-Path $Root "electrobun.config.ts") -Raw
  if ($cfg -notmatch 'version:\s*"([^"]+)"') {
    Fail "electrobun.config.ts version is missing"
  }
  return $Matches[1]
}

function ArtifactName([string] $Version, [string] $Spec) {
  return "fulvid_${Version}_win-x64$Spec"
}

function Get-Sha256([string] $Path) {
  return (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Write-Sha256Sums([string[]] $Names) {
  New-Item -ItemType Directory -Force -Path $Artifacts | Out-Null
  $lines = foreach ($name in $Names) {
    $path = Join-Path $Artifacts $name
    if (-not (Test-Path $path -PathType Leaf)) { Fail "missing $name" }
    "{0}  {1}" -f (Get-Sha256 $path), $name
  }
  $sums = Join-Path $Artifacts "SHA256SUMS"
  Set-Content -Path $sums -Value ($lines -join "`n") -Encoding ascii -NoNewline
  Add-Content -Path $sums -Value "`n" -Encoding ascii
}

function Assert-ExactFiles([string[]] $Expected) {
  $found = Get-ChildItem -Path $Artifacts -File | ForEach-Object { $_.Name } | Sort-Object
  $want = $Expected | Sort-Object
  if (($found -join "|") -ne ($want -join "|")) {
    Fail "artifact set is incomplete or contains stale files"
  }
}

function Move-Canonical([string] $Dest, [string] $Filter) {
  $destPath = Join-Path $Artifacts $Dest
  if (Test-Path $destPath) { return }
  # StrictMode: a single FileInfo has no .Count. @() is always an array:
  # zero files -> Length 0, one file -> Length 1, several -> Length N.
  $found = @(Get-ChildItem -Path $Artifacts -File -Filter $Filter)
  if ($found.Length -ne 1) {
    Fail "expected exactly one artifacts/$Filter (found $($found.Length))"
  }
  Move-Item -Force $found[0].FullName $destPath
}

function Rewrite-UpdateJson([string] $JsonName, [string] $Bundle, [string] $Version) {
  $path = Join-Path $Artifacts $JsonName
  $data = Get-Content $path -Raw | ConvertFrom-Json
  if ([string] $data.version -ne $Version) {
    Fail "update.json version $($data.version) does not match $Version"
  }
  if (-not $data.artifact) { Fail "update.json is missing artifact.file" }
  $data.artifact.file = $Bundle
  ($data | ConvertTo-Json -Compress) + "`n" | Set-Content -Path $path -Encoding utf8NoBOM
}

function Write-ReleaseMetadata([string] $Version) {
  $installer = ArtifactName $Version "-Setup.zip"
  $bundle = ArtifactName $Version ".tar.zst"
  $update = ArtifactName $Version "-update.json"
  $installerPath = Join-Path $Artifacts $installer
  $stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  $gitCommit = ""
  $gitTag = ""
  $gitDescribe = ""
  if (Get-Command git -ErrorAction SilentlyContinue) {
    $gitCommit = (git -C $Root rev-parse HEAD 2>$null)
    $gitTag = (git -C $Root describe --exact-match --tags HEAD 2>$null)
    $gitDescribe = (git -C $Root describe --always --dirty 2>$null)
  }

  $log = @(
    "Fulvid Windows package"
    "build_timestamp_utc: $stamp"
    "product: fulvid"
    "version: $Version"
    "architecture: win-x64"
    "installer: $installer"
    "installer_size_bytes: $((Get-Item $installerPath).Length)"
    "installer_sha256: $(Get-Sha256 $installerPath)"
    "signing_pgp: not-applied"
    "platform_native_signing: not-applied (authenticode is a separate step)"
    "git_commit: $gitCommit"
    "git_tag: $gitTag"
    "git_describe: $gitDescribe"
  )
  Set-Content -Path (Join-Path $Artifacts "build.log") -Value ($log -join "`n") -Encoding utf8

  $payloads = @($installer, $bundle, $update, "build.log") | ForEach-Object {
    $p = Join-Path $Artifacts $_
    $role = if ($_ -like "*-Setup.zip") { "installer" }
      elseif ($_ -like "*.tar.zst") { "bundle" }
      elseif ($_ -like "*-update.json") { "update" }
      else { "log" }
    [pscustomobject]@{
      name       = $_
      role       = $role
      size_bytes = (Get-Item $p).Length
      sha256     = Get-Sha256 $p
    }
  }

  $primary = $payloads | Where-Object { $_.role -eq "installer" } | Select-Object -First 1
  $manifest = [ordered]@{
    schema          = 1
    project         = "fulvid"
    version         = $Version
    platform        = "windows"
    architecture    = "win-x64"
    package         = @{
      filename     = $primary.name
      format       = "installer"
      architecture = "win-x64"
      size_bytes   = $primary.size_bytes
      sha256       = $primary.sha256
    }
    payloads        = $payloads
    build_timestamp = $stamp
    git             = @{ commit = "$gitCommit"; tag = "$gitTag"; describe = "$gitDescribe" }
    signing         = @{
      pgp             = @{
        enabled      = $false
        status       = "SKIPPED"
        fingerprint    = ""
        verification = "skipped"
      }
      platform_native = @{
        mechanism = "authenticode"
        status    = "not-applied"
        note      = "Authenticode is a separate step. Fulvid PGP, when used, is not Authenticode."
      }
    }
    artifacts       = @($installer, $bundle, $update, "build.log", "release-manifest.json", "SHA256SUMS") | Sort-Object
  }
  $json = $manifest | ConvertTo-Json -Depth 8
  Set-Content -Path (Join-Path $Artifacts "release-manifest.json") -Value ($json.TrimEnd() + "`n") -Encoding utf8NoBOM
}

if (-not $RefreshHashes) {
  Require-Windows
}

$version = Get-ProductVersion
$installer = ArtifactName $version "-Setup.zip"
$bundle = ArtifactName $version ".tar.zst"
$update = ArtifactName $version "-update.json"

if ($RefreshHashes) {
  $manifestPath = Join-Path $Artifacts "release-manifest.json"
  if (Test-Path $manifestPath) {
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
    foreach ($payload in $manifest.payloads) {
      $p = Join-Path $Artifacts $payload.name
      $payload.size_bytes = (Get-Item $p).Length
      $payload.sha256 = Get-Sha256 $p
    }
    $primary = $manifest.payloads | Where-Object { $_.name -eq $manifest.package.filename } | Select-Object -First 1
    if ($primary) {
      $manifest.package.size_bytes = $primary.size_bytes
      $manifest.package.sha256 = $primary.sha256
    }
    $json = $manifest | ConvertTo-Json -Depth 8
    Set-Content -Path $manifestPath -Value ($json.TrimEnd() + "`n") -Encoding utf8NoBOM
  }
  Write-Sha256Sums @($installer, $bundle, $update, "build.log", "release-manifest.json")
  Assert-ExactFiles @($installer, $bundle, $update, "build.log", "release-manifest.json", "SHA256SUMS")
  Write-Host "checksums ready: $Artifacts"
  exit 0
}

$configured = Get-ElectrobunVersion
if ($configured -ne $version) {
  Fail "electrobun.config.ts version $configured does not match package.json $version"
}

Write-Host "==> windows package: cleaning generated output"
foreach ($path in @((Join-Path $Root "build"), (Join-Path $Root "dist"))) {
  if (Test-Path $path) { Remove-Item -Recurse -Force $path; Write-Host "removed $($path.Substring($Root.Length + 1))" }
}
New-Item -ItemType Directory -Force -Path $Artifacts | Out-Null
Get-ChildItem -Path $Artifacts -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force

$env:PATH = "$(Join-Path $Root 'node_modules\.bin');$env:PATH"
Write-Host "==> windows package: electrobun stable build"
Push-Location $Root
try {
  electrobun prepare --env=stable
  vite build
  electrobun build --env=stable
}
finally {
  Pop-Location
}

Move-Canonical $installer "*Setup*.zip"
Move-Canonical $bundle "*.tar.zst"
Move-Canonical $update "*-update.json"
Rewrite-UpdateJson $update $bundle $version
Write-ReleaseMetadata $version
Write-Sha256Sums @($installer, $bundle, $update, "build.log", "release-manifest.json")
Assert-ExactFiles @($installer, $bundle, $update, "build.log", "release-manifest.json", "SHA256SUMS")
Write-Host "windows artifacts ready: $Artifacts"
Get-ChildItem $Artifacts -File | ForEach-Object { Write-Host "  $($_.Name)" }
