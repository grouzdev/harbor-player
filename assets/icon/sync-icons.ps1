$ErrorActionPreference = "Stop"

function Get-Sha256Hash([string] $path) {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.IO.File]::ReadAllBytes($path)
        return ([System.BitConverter]::ToString($sha256.ComputeHash($bytes))).Replace("-", "")
    }
    finally {
        $sha256.Dispose()
    }
}

$sourceDirectory = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $sourceDirectory "..\..")).Path

$requiredSources = @(
    "icon.png",
    "icon.ico",
    "icon-1.png",
    "icon-2.png",
    "icon-3.png",
    "icon-4.png",
    "icon-5.png",
    "icon-6.png",
    "icon-7.png",
    "icon-8.png",
    "icon-9.png"
)

$missingSources = @(
    $requiredSources |
        Where-Object { -not (Test-Path -LiteralPath (Join-Path $sourceDirectory $_) -PathType Leaf) }
)

if ($missingSources.Count -gt 0) {
    Write-Error ("Missing icon source file(s): " + ($missingSources -join ", "))
    exit 1
}

$copyPlan = @(
    @{ Source = "icon.ico"; Destination = "assets\icon.ico" },
    @{ Source = "icon.ico"; Destination = "public\favicon.ico" },
    @{ Source = "icon-1.png"; Destination = "assets\icon.png" },
    @{ Source = "icon-1.png"; Destination = "public\icon-512.png" }
)

foreach ($item in $copyPlan) {
    $sourcePath = Join-Path $sourceDirectory $item.Source
    $destinationPath = Join-Path $projectRoot $item.Destination
    $destinationDirectory = Split-Path -Parent $destinationPath

    if (-not (Test-Path -LiteralPath $destinationDirectory -PathType Container)) {
        New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
    }

    $sourceHash = Get-Sha256Hash $sourcePath
    if (Test-Path -LiteralPath $destinationPath -PathType Leaf) {
        $destinationHash = Get-Sha256Hash $destinationPath
        if ($sourceHash -eq $destinationHash) {
            Write-Host ("Already up to date: {0}" -f $item.Destination)
            continue
        }
    }

    $copied = $false
    for ($attempt = 1; $attempt -le 5; $attempt++) {
        try {
            Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
            $copied = $true
            break
        }
        catch {
            if ($attempt -eq 5) {
                throw
            }
            Start-Sleep -Milliseconds 500
        }
    }

    $destinationHash = Get-Sha256Hash $destinationPath

    if ($sourceHash -ne $destinationHash) {
        throw "Hash verification failed after copying $($item.Source) to $($item.Destination)."
    }

    Write-Host ("Updated {0} from {1}" -f $item.Destination, $item.Source)
}

Write-Host "Icon synchronization completed successfully."
