# Seurat/1 LAN run for Windows PowerShell: static viewer + Java server on one port. Offline-safe.
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

# Ensure runtime and build directories exist
New-Item -ItemType Directory -Force -Path ".seurat/runtime/inbox", ".seurat/runtime/obras", ".seurat/build/classes" | Out-Null

# Resolve Java if JAVA_HOME is configured but not yet in PATH
if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
    if ($env:JAVA_HOME -and (Test-Path "$env:JAVA_HOME\bin")) {
        $env:PATH = "$env:JAVA_HOME\bin;" + $env:PATH
    } elseif ($jh = [Environment]::GetEnvironmentVariable("JAVA_HOME", "Machine")) {
        $env:PATH = "$jh\bin;" + $env:PATH
    } elseif ($jh = [Environment]::GetEnvironmentVariable("JAVA_HOME", "User")) {
        $env:PATH = "$jh\bin;" + $env:PATH
    }
}

# Rebuild the viewer when a JS toolchain is available; otherwise serve the
# committed client/dist. Never fails the boot.
$hasPnpm = Get-Command pnpm -ErrorAction SilentlyContinue
$hasNpm = Get-Command npm -ErrorAction SilentlyContinue
if ((Test-Path "client/package.json") -and ($hasPnpm -or $hasNpm)) {
    $built = $false
    Push-Location client
    try {
        if ($hasPnpm) {
            & pnpm build 2>$null
            if ($LASTEXITCODE -eq 0) { $built = $true }
        }
        if (-not $built -and $hasNpm) {
            & npm run build 2>$null
            if ($LASTEXITCODE -eq 0) { $built = $true }
        }
    } catch {
        # Never fails the boot.
    } finally {
        Pop-Location
    }
    if (-not $built) {
        Write-Host "client build skipped"
    }
}

$compileFlags = @()
$runFlags = @()
$v = (& { $ErrorActionPreference = 'Continue'; java -version } 2>&1) -join ' '
if ($v -match 'version "20\.') {
    $compileFlags = @("--enable-preview", "--release", "20")
    $runFlags = @("--enable-preview")
}

$sources = Get-ChildItem -Path "server/src" -Recurse -Filter *.java | ForEach-Object { $_.FullName }
javac @compileFlags -cp "server/vendor/*" -d .seurat/build/classes $sources
jar -cf .seurat/build/seurat.jar -C .seurat/build/classes .

# Ingest heap grows with image width (~2.5 GB live at 196,608 px); 6G leaves GC headroom.
$heap = if ($env:SEURAT_HEAP) { $env:SEURAT_HEAP } else { "-Xmx6G" }
$javaOpts = if ($env:JAVA_OPTS) { $env:JAVA_OPTS -split '\s+' | Where-Object { $_ } } else { @() }
# Colours and the sticky progress bar only on a terminal: a redirected log stays plain text.
$logFlags = @("-Dseurat.log.tty=false")
if (-not [Console]::IsOutputRedirected) {
    $cols = 80
    try { $cols = [Console]::WindowWidth } catch {}
    $logFlags = @("-Dseurat.log.tty=true", "-Dseurat.log.columns=$cols")
}
& java @runFlags $heap "-XX:+HeapDumpOnOutOfMemoryError" "-XX:HeapDumpPath=.seurat/runtime/" @logFlags @javaOpts -cp ".seurat/build/seurat.jar;.seurat/build/classes;server/vendor/*" seurat.SeuratServer @args
exit $LASTEXITCODE
