# Build the Microsoft Store MSIX from the Electrobun Windows update bundle.
# Runs after package.ps1 (CI) or after `bun run release` (local). Does not rebuild the app.
#   pwsh -File packaging/windows/package-msix.ps1
#   powershell -File packaging/windows/package-msix.ps1 -StageOnly   # no Windows SDK needed
# Store identity comes from Partner Center (Product identity); see docs/windows-store.md.
[CmdletBinding()]
param(
  [string] $Bundle,
  [string] $IdentityName = $env:MSIX_IDENTITY_NAME,
  [string] $Publisher = $env:MSIX_PUBLISHER,
  [string] $PublisherDisplayName = $env:MSIX_PUBLISHER_DISPLAY_NAME,
  [string] $MinVersion = "10.0.22000.0",
  [string] $MaxVersionTested = "10.0.26100.0",
  [string] $OutDir,
  [switch] $StageOnly,
  # CI: a pre-release tag still publishes GitHub assets; it just has no MSIX.
  [switch] $SkipPrerelease
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
if (-not $OutDir) { $OutDir = Join-Path $Root "artifacts-msix" }
$Stage = Join-Path $Root "build\msix-stage"
$Utf8 = New-Object System.Text.UTF8Encoding($false)

function Fail([string] $Message) {
  Write-Error $Message
  exit 1
}

function Get-Sha256([string] $Path) {
  return (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-PeMachine([string] $Path) {
  $stream = [IO.File]::OpenRead($Path)
  try {
    $reader = New-Object IO.BinaryReader($stream)
    if ($reader.ReadUInt16() -ne 0x5A4D) { return $null }
    $stream.Position = 0x3C
    $stream.Position = $reader.ReadInt32()
    if ($reader.ReadUInt32() -ne 0x00004550) { return $null }
    return $reader.ReadUInt16()
  }
  finally {
    $stream.Dispose()
  }
}

# Read the PE Security directory (DataDirectory[4]). Its first field is a file offset, not an RVA.
# Status: VALID, NO_CERTIFICATE, MALFORMED (table runs past end of file; repairable), FAIL.
function Get-PeCertificateInfo([string] $Path) {
  $bytes = [IO.File]::ReadAllBytes($Path)
  $len = [int64] $bytes.Length
  $info = [ordered]@{ Format = ""; Offset = [int64] 0; Size = [int64] 0; FileSize = $len; EntryOffset = [int64] -1; Status = "FAIL"; Reason = "" }
  if ($len -lt 0x40 -or [BitConverter]::ToUInt16($bytes, 0) -ne 0x5A4D) { $info.Reason = "not a PE file (no MZ header)"; return [pscustomobject] $info }
  $pe = [int64] [BitConverter]::ToInt32($bytes, 0x3C)
  if ($pe -lt 0x40 -or $pe + 24 -gt $len) { $info.Reason = "e_lfanew $pe is outside the file"; return [pscustomobject] $info }
  if ([BitConverter]::ToUInt32($bytes, $pe) -ne 0x00004550) { $info.Reason = "invalid PE signature"; return [pscustomobject] $info }
  $optSize = [int64] [BitConverter]::ToUInt16($bytes, $pe + 20)
  $opt = $pe + 24
  if ($optSize -lt 2 -or $opt + $optSize -gt $len) { $info.Reason = "optional header is truncated"; return [pscustomobject] $info }
  $magic = [BitConverter]::ToUInt16($bytes, $opt)
  if ($magic -eq 0x10B) { $info.Format = "PE32"; $countAt = $opt + 92; $dirs = $opt + 96 }
  elseif ($magic -eq 0x20B) { $info.Format = "PE32+"; $countAt = $opt + 108; $dirs = $opt + 112 }
  else { $info.Reason = ("unknown optional header magic 0x{0:X4}" -f $magic); return [pscustomobject] $info }
  if ($countAt + 4 -gt $opt + $optSize) { $info.Reason = "optional header too small for NumberOfRvaAndSizes"; return [pscustomobject] $info }
  $sizeOfHeaders = [int64] [BitConverter]::ToUInt32($bytes, $opt + 60)
  if ([BitConverter]::ToUInt32($bytes, $countAt) -le 4) { $info.Status = "NO_CERTIFICATE"; return [pscustomobject] $info }
  $entry = $dirs + 8 * 4
  if ($entry + 8 -gt $opt + $optSize) { $info.Reason = "Security directory entry lies outside the optional header"; return [pscustomobject] $info }
  $info.EntryOffset = $entry
  $info.Offset = [int64] [BitConverter]::ToUInt32($bytes, $entry)
  $info.Size = [int64] [BitConverter]::ToUInt32($bytes, $entry + 4)
  if ($info.Offset -eq 0 -and $info.Size -eq 0) { $info.Status = "NO_CERTIFICATE"; return [pscustomobject] $info }
  if ($info.Offset -eq 0 -or $info.Size -eq 0) { $info.Reason = "Security directory has offset $($info.Offset) with size $($info.Size)"; return [pscustomobject] $info }
  if ($info.Offset + $info.Size -gt [uint32]::MaxValue) { $info.Reason = "certificate offset + size overflows 32 bits"; return [pscustomobject] $info }
  if ($info.Offset % 8 -ne 0) { $info.Reason = "certificate table is not 8-byte aligned"; return [pscustomobject] $info }
  if ($info.Offset -lt $sizeOfHeaders) { $info.Reason = "certificate table overlaps the PE headers"; return [pscustomobject] $info }
  if ($info.Offset + $info.Size -gt $len) {
    $info.Status = "MALFORMED"
    $info.Reason = "certificate table extends beyond end of PE"
    return [pscustomobject] $info
  }
  # Table is inside the file: it must start with a sane WIN_CERTIFICATE.
  $certLength = [int64] [BitConverter]::ToUInt32($bytes, $info.Offset)
  $revision = [BitConverter]::ToUInt16($bytes, $info.Offset + 4)
  $certType = [BitConverter]::ToUInt16($bytes, $info.Offset + 6)
  if ($certLength -lt 8 -or $certLength -gt $info.Size -or ($revision -notin @(0x0100, 0x0200)) -or ($certType -notin @(1, 2, 3, 4))) {
    $info.Reason = ("invalid WIN_CERTIFICATE (dwLength {0}, wRevision 0x{1:X4}, wCertificateType {2})" -f $certLength, $revision, $certType)
    return [pscustomobject] $info
  }
  $info.Status = "VALID"
  return [pscustomobject] $info
}

# Electrobun 2.0.1 / Hutch 0.24.3 rewrites bun.exe to embed the app icon, drops Bun's Authenticode
# signature, and leaves DataDirectory[4] pointing past the end of the file. SignTool and the Store
# then refuse the package (0x800700C1, "File has malformed certificate"). Clear only that entry.
function Repair-MalformedPeCertificate([string] $Path, [string] $RelativePath) {
  $before = Get-PeCertificateInfo $Path
  if ($before.Status -eq "FAIL") { Fail "${RelativePath}: $($before.Reason)" }
  if ($before.Status -ne "MALFORMED") {
    return [pscustomobject] @{ Info = $before; Repair = $null }
  }
  $shaBefore = Get-Sha256 $Path
  $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite)
  try {
    $stream.Position = $before.EntryOffset
    $stream.Write((New-Object byte[] 8), 0, 8)
  }
  finally { $stream.Dispose() }
  $after = Get-PeCertificateInfo $Path
  $sizeAfter = (Get-Item -LiteralPath $Path).Length
  if ($sizeAfter -ne $before.FileSize) { Fail "${RelativePath}: file size changed during repair" }
  if ($after.Status -ne "NO_CERTIFICATE") { Fail "${RelativePath}: still $($after.Status) after repair" }
  $repair = [ordered]@{
    file                   = $RelativePath
    reason                 = $before.Reason
    certificateOffset      = $before.Offset
    certificateSize        = $before.Size
    fileSize               = $before.FileSize
    fileSizeAfter          = $sizeAfter
    certificateOffsetAfter = $after.Offset
    certificateSizeAfter   = $after.Size
    sha256Before           = $shaBefore
    sha256After            = Get-Sha256 $Path
  }
  $after.Status = "REPAIRED_MALFORMED_CERTIFICATE"
  return [pscustomobject] @{ Info = $after; Repair = [pscustomobject] $repair }
}

function Find-SdkTool([string] $Name) {
  $onPath = Get-Command $Name -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  $kits = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
  if (-not (Test-Path $kits)) { return $null }
  return Get-ChildItem -Path $kits -Recurse -Filter $Name -ErrorAction SilentlyContinue |
    Where-Object { $_.Directory.Name -eq "x64" } |
    Sort-Object FullName -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}

function Save-Logo([Drawing.Image] $Source, [string] $Path, [int] $Width, [int] $Height) {
  $bitmap = New-Object Drawing.Bitmap($Width, $Height)
  try {
    $g = [Drawing.Graphics]::FromImage($bitmap)
    try {
      $g.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.Clear([Drawing.Color]::Transparent)
      $side = [Math]::Min($Width, $Height)
      $g.DrawImage($Source, [int](($Width - $side) / 2), [int](($Height - $side) / 2), $side, $side)
    }
    finally { $g.Dispose() }
    $bitmap.Save($Path, [Drawing.Imaging.ImageFormat]::Png)
  }
  finally { $bitmap.Dispose() }
}

function Escape-Xml([string] $Value) {
  return [Security.SecurityElement]::Escape($Value)
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  Fail "MSIX packaging must run on Windows"
}

# Version: Store MSIX needs Major.Minor.Build.0 (the fourth part is reserved for the Store).
$pkg = Get-Content (Join-Path $Root "package.json") -Raw | ConvertFrom-Json
$version = [string] $pkg.version
if ($version -notmatch '^(\d+)\.(\d+)\.(\d+)$') {
  if ($SkipPrerelease) {
    Write-Warning "version '$version' is a pre-release; no MSIX is built"
    exit 0
  }
  Fail "package.json version '$version' is not Major.Minor.Patch; MSIX cannot represent pre-release versions"
}
foreach ($part in @($Matches[1], $Matches[2], $Matches[3])) {
  if ([int64] $part -gt 65535) { Fail "version part $part exceeds the MSIX limit of 65535" }
}
$msixVersion = "$version.0"

# Microsoft Store identity from Partner Center (Fulvid > Product management > Product identity).
# Public values, case-sensitive. MSIX_* (or the parameters) override all three together.
$StoreIdentityName = "imgildev.Fulvid"
$StorePublisher = "CN=A78087F6-DF94-4D2F-8347-B7436A28BB44"
$StorePublisherDisplayName = "imgildev"
$given = @($IdentityName, $Publisher, $PublisherDisplayName) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
if (@($given).Count -eq 0) {
  $identitySource = "store-default"
  $IdentityName = $StoreIdentityName
  $Publisher = $StorePublisher
  $PublisherDisplayName = $StorePublisherDisplayName
}
elseif (@($given).Count -eq 3) {
  $identitySource = "override"
}
else {
  Fail "set all of MSIX_IDENTITY_NAME, MSIX_PUBLISHER, MSIX_PUBLISHER_DISPLAY_NAME, or none of them"
}
$storeIdentity = ($IdentityName -ceq $StoreIdentityName) -and ($Publisher -ceq $StorePublisher) -and
  ($PublisherDisplayName -ceq $StorePublisherDisplayName)
if (-not $storeIdentity) {
  Write-Warning "identity override ($IdentityName / $Publisher) is not the Microsoft Store identity; Partner Center will reject this package"
}
if ($IdentityName -notmatch '^[A-Za-z0-9.-]{3,50}$') { Fail "identity name '$IdentityName' is not a valid MSIX package name" }
if ($Publisher -notmatch '^CN=') { Fail "publisher must be a distinguished name starting with CN=" }

if (-not $Bundle) {
  $candidates = @(
    (Join-Path $Root "artifacts\fulvid_${version}_win-x64.tar.zst"),
    (Join-Path $Root "artifacts\stable-win-x64-Fulvid.tar.zst")
  )
  $Bundle = $candidates | Where-Object { Test-Path $_ -PathType Leaf } | Select-Object -First 1
  if (-not $Bundle) { Fail "no Windows bundle found; run package.ps1 or 'bun run release' first" }
}
$Bundle = (Resolve-Path $Bundle).Path

# Git for Windows ships GNU tar, which reads "C:\..." as a remote host. bsdtar in System32 reads zstd.
$tar = Join-Path $env:SystemRoot "System32\tar.exe"
if (-not (Test-Path $tar)) { Fail "System32\tar.exe not found" }

Write-Host "==> msix: staging $Bundle"
if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
$extract = Join-Path $Root "build\msix-extract"
if (Test-Path $extract) { Remove-Item -Recurse -Force $extract }
New-Item -ItemType Directory -Force -Path $extract | Out-Null
& $tar -xf $Bundle -C $extract
if ($LASTEXITCODE -ne 0) { Fail "tar failed to extract $Bundle" }
$appTree = Join-Path $extract "Fulvid"
if (-not (Test-Path (Join-Path $appTree "bin\launcher.exe"))) { Fail "bundle does not contain Fulvid\bin\launcher.exe" }
Move-Item $appTree $Stage
Remove-Item -Recurse -Force $extract

$versionJson = Get-Content (Join-Path $Stage "Resources\version.json") -Raw | ConvertFrom-Json
if ([string] $versionJson.version -ne $version) { Fail "bundle version $($versionJson.version) does not match package.json $version" }
if ([string] $versionJson.identifier -ne "fulvid.imgil.dev") { Fail "bundle identifier $($versionJson.identifier) is not fulvid.imgil.dev" }

$badArch = Get-ChildItem $Stage -Recurse -File | Where-Object { $_.Extension -in ".exe", ".dll" } | Where-Object {
  (Get-PeMachine $_.FullName) -ne 0x8664
}
if ($badArch) { Fail "non-x64 PE files in bundle: $($badArch.Name -join ', ')" }

Write-Host "==> msix: PE certificate directories"
$peCertificateRepairs = @()
foreach ($pe in (Get-ChildItem $Stage -Recurse -File | Where-Object { $_.Extension -in ".exe", ".dll" } | Sort-Object FullName)) {
  $relative = $pe.FullName.Substring($Stage.Length + 1).Replace("\", "/")
  $result = Repair-MalformedPeCertificate $pe.FullName $relative
  if ($result.Repair) { $peCertificateRepairs += $result.Repair }
  Write-Host ("  {0,-26} {1,10} {2,-6} offset={3} size={4} {5}" -f $relative, $result.Info.FileSize, $result.Info.Format,
    $(if ($result.Repair) { $result.Repair.certificateOffset } else { $result.Info.Offset }),
    $(if ($result.Repair) { $result.Repair.certificateSize } else { $result.Info.Size }), $result.Info.Status)
}
foreach ($r in $peCertificateRepairs) {
  Write-Host "  repaired $($r.file): $($r.reason); sha256 $($r.sha256Before) -> $($r.sha256After)"
}

Write-Host "==> msix: visual assets"
Add-Type -AssemblyName System.Drawing
$assets = Join-Path $Stage "Assets"
New-Item -ItemType Directory -Force -Path $assets | Out-Null
$source = [Drawing.Image]::FromFile((Join-Path $Root "assets\fulvid.png"))
try {
  Save-Logo $source (Join-Path $assets "StoreLogo.png") 50 50
  Save-Logo $source (Join-Path $assets "Square44x44Logo.png") 44 44
  Save-Logo $source (Join-Path $assets "Square150x150Logo.png") 150 150
  Save-Logo $source (Join-Path $assets "Wide310x150Logo.png") 310 150
}
finally { $source.Dispose() }

Write-Host "==> msix: manifest $IdentityName $msixVersion"
$manifest = [IO.File]::ReadAllText((Join-Path $PSScriptRoot "msix\AppxManifest.xml.in"), $Utf8)
$manifest = $manifest.Replace("@IDENTITY_NAME@", (Escape-Xml $IdentityName)).
  Replace("@PUBLISHER@", (Escape-Xml $Publisher)).
  Replace("@PUBLISHER_DISPLAY_NAME@", (Escape-Xml $PublisherDisplayName)).
  Replace("@VERSION@", $msixVersion).
  Replace("@MIN_VERSION@", $MinVersion).
  Replace("@MAX_VERSION_TESTED@", $MaxVersionTested)
if ($manifest -match '@[A-Z_]+@') { Fail "unrendered manifest token: $($Matches[0])" }
[xml] $manifest | Out-Null
$manifestPath = Join-Path $Stage "AppxManifest.xml"
[IO.File]::WriteAllText($manifestPath, $manifest, $Utf8)

if ($StageOnly) {
  Write-Host "msix stage ready (not packed): $Stage"
  exit 0
}

$makeappx = Find-SdkTool "makeappx.exe"
if (-not $makeappx) { Fail "makeappx.exe not found; install the Windows SDK or rerun with -StageOnly" }

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Get-ChildItem -Path $OutDir -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
$msixName = "fulvid_${version}_win-x64.msix"
$msixPath = Join-Path $OutDir $msixName

Write-Host "==> msix: makeappx pack"
& $makeappx pack /o /h SHA256 /d $Stage /p $msixPath
if ($LASTEXITCODE -ne 0) { Fail "makeappx pack failed" }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($msixPath)
try {
  $entries = $zip.Entries | ForEach-Object { $_.FullName }
}
finally { $zip.Dispose() }
foreach ($required in @("AppxManifest.xml", "AppxBlockMap.xml", "bin/launcher.exe", "bin/bun.exe", "Resources/app/bun/glue.wasm", "Resources/app/views/mainview/index.html")) {
  if ($entries -notcontains $required) { Fail "MSIX is missing $required" }
}

$info = [ordered]@{
  schema               = 1
  project              = "fulvid"
  version              = $version
  msix_version         = $msixVersion
  architecture         = "win-x64"
  file                 = $msixName
  size_bytes           = (Get-Item $msixPath).Length
  sha256               = Get-Sha256 $msixPath
  artifact             = $(if ($storeIdentity) { "microsoft-store" } else { "not-for-store" })
  identity_name        = $IdentityName
  publisher            = $Publisher
  publisher_display_name = $PublisherDisplayName
  identity_source      = $identitySource
  store_identity       = $storeIdentity
  min_version          = $MinVersion
  max_version_tested   = $MaxVersionTested
  source_bundle        = (Split-Path $Bundle -Leaf)
  source_bundle_sha256 = Get-Sha256 $Bundle
  signing              = "unsigned (Microsoft Store signs Store packages)"
  peCertificateRepairs = @($peCertificateRepairs)
}
[IO.File]::WriteAllText((Join-Path $OutDir "msix-build.json"), (($info | ConvertTo-Json -Depth 5) + "`n"), $Utf8)
$sums = @($msixName, "msix-build.json") | ForEach-Object { "{0}  {1}" -f (Get-Sha256 (Join-Path $OutDir $_)), $_ }
[IO.File]::WriteAllText((Join-Path $OutDir "SHA256SUMS"), (($sums -join "`n") + "`n"), $Utf8)

Write-Host "msix ready: $msixPath"
if (-not $storeIdentity) { Write-Warning "identity override - not for Partner Center upload" }
