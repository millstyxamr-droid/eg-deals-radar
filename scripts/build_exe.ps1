# PowerShell Build Script for Amazon Deals Radar Windows Desktop GUI (.exe)
$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"

if (-not (Test-Path $csc)) {
    Write-Error "Microsoft .NET Framework 4.0 C# compiler (csc.exe) not found at: $csc"
    exit 1
}

# 1. Ensure Icon exists
$iconPath = Join-Path $root "assets\app.ico"
if (-not (Test-Path $iconPath)) {
    Write-Host "[*] Generating assets\app.ico from avatar.jpg..."
    Add-Type -AssemblyName System.Drawing
    $img = [System.Drawing.Image]::FromFile((Join-Path $root "assets\avatar.jpg"))
    $bmp = New-Object System.Drawing.Bitmap $img, 64, 64
    $hIcon = $bmp.GetHicon()
    $icon = [System.Drawing.Icon]::FromHandle($hIcon)
    $fs = New-Object System.IO.FileStream $iconPath, ([System.IO.FileMode]::Create)
    $icon.Save($fs)
    $fs.Close()
    $icon.Dispose()
    $bmp.Dispose()
    $img.Dispose()
}

# 2. Source and Output Paths
$srcPath = Join-Path $root "gui\AmazonDealsRadar.cs"
$outExeRoot = Join-Path $root "AmazonDealsRadar.exe"
$distDir = Join-Path $root "dist"
if (-not (Test-Path $distDir)) {
    New-Item -ItemType Directory -Path $distDir -Force | Out-Null
}
$outExeDist = Join-Path $distDir "AmazonDealsRadar.exe"

Write-Host "[*] Compiling AmazonDealsRadar.exe using csc.exe..."

$refs = @(
    "System.dll",
    "System.Windows.Forms.dll",
    "System.Drawing.dll",
    "System.Web.Extensions.dll",
    "System.Data.dll"
) -join ","

$args = @(
    "/target:winexe",
    "/optimize+",
    "/platform:anycpu",
    "/win32icon:`"$iconPath`"",
    "/r:$refs",
    "/out:`"$outExeRoot`"",
    "`"$srcPath`""
)

$proc = Start-Process -FilePath $csc -ArgumentList ($args -join " ") -NoNewWindow -Wait -PassThru

if ($proc.ExitCode -eq 0 -and (Test-Path $outExeRoot)) {
    # Copy to dist as well
    Copy-Item -Path $outExeRoot -Destination $outExeDist -Force

    $sizeKb = [Math]::Round((Get-Item $outExeRoot).Length / 1024, 1)
    Write-Host "==============================================================="
    Write-Host "✅ تم بناء البرنامج بنجاح (EXE with Modern GUI)!" -ForegroundColor Green
    Write-Host "📄 ملف التشغيل الرئيسي: $outExeRoot"
    Write-Host "📁 نسخة المجلد: $outExeDist"
    Write-Host "📦 الحجم: $sizeKb KB (خفيف وسريع جداً وبدون أي متطلبات خارجية)"
    Write-Host "==============================================================="
} else {
    Write-Error "[-] فشل تجميع الكود المصدري للبرنامج."
    exit 1
}
