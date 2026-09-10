# Verify an existing Windows artifact set. Does not rebuild.
[CmdletBinding()]
param(
  [string] $Directory
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Artifacts = if ($Directory) { (Resolve-Path $Directory).Path } else { Join-Path $Root "artifacts" }

function Fail([string] $Message) {
  Write-Error $Message
  exit 1
}

function Get-ProductVersion {
  $pkg = Get-Content (Join-Path $Root "package.json") -Raw | ConvertFrom-Json
  return [string] $pkg.version
}

function ArtifactName([string] $Version, [string] $Spec) {
  return "fulvid_${Version}_win-x64$Spec"
}

function Get-Sha256([string] $Path) {
  return (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

if (-not (Test-Path $Artifacts -PathType Container)) {
  Fail "release directory does not exist: $Artifacts"
}

$version = Get-ProductVersion
$installer = ArtifactName $version "-Setup.zip"
$bundle = ArtifactName $version ".tar.zst"
$update = ArtifactName $version "-update.json"
$expected = @($installer, $bundle, $update, "build.log", "release-manifest.json", "SHA256SUMS") | Sort-Object
$found = Get-ChildItem -Path $Artifacts -File | ForEach-Object { $_.Name } | Sort-Object
if (($found -join "|") -ne ($expected -join "|")) {
  Fail "Windows artifact set is incomplete or contains stale files"
}

Get-Content (Join-Path $Artifacts "SHA256SUMS") | Where-Object { $_.Trim() -ne "" } | ForEach-Object {
  $hash, $name = $_ -split "\s+", 2
  $path = Join-Path $Artifacts $name.Trim()
  if ((Get-Sha256 $path) -ne $hash.ToLowerInvariant()) {
    Fail "SHA256 mismatch for $name"
  }
}

$manifest = Get-Content (Join-Path $Artifacts "release-manifest.json") -Raw | ConvertFrom-Json
if ($manifest.project -ne "fulvid") { Fail "release-manifest.json is not a Fulvid release manifest" }
if ($manifest.platform -ne "windows") { Fail "release-manifest.json is not a Windows release" }
if ($manifest.architecture -ne "win-x64") { Fail "manifest architecture does not match win-x64" }
if ($manifest.version -ne $version) { Fail "manifest version does not match package.json" }
if ($manifest.package.filename -ne $installer) { Fail "manifest primary artifact is not the canonical installer" }
$installerPath = Join-Path $Artifacts $installer
if ([int64] $manifest.package.size_bytes -ne (Get-Item $installerPath).Length) { Fail "manifest package size mismatch" }
if ($manifest.package.sha256 -ne (Get-Sha256 $installerPath)) { Fail "manifest package sha256 mismatch" }

$updateData = Get-Content (Join-Path $Artifacts $update) -Raw | ConvertFrom-Json
if ([string] $updateData.version -ne $version) { Fail "update.json version does not match package.json" }
if ([string] $updateData.artifact.file -ne $bundle) { Fail "update.json artifact.file is not the canonical bundle name" }

Get-ChildItem $Artifacts -File | ForEach-Object {
  $text = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
  if ($text -match "BEGIN PGP PRIVATE KEY BLOCK" -or $text -match "BEGIN OPENSSH PRIVATE KEY") {
    Fail "private key material must not appear in artifacts: $($_.Name)"
  }
}

if ($manifest.signing.pgp.enabled) {
  Fail "this verifier does not check PGP; a signed Windows PGP set is out of scope for package verification"
}

Write-Host "windows package verification: PASS"
