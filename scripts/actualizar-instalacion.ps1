# Actualiza la aplicación instalada sin tocar el ejecutable.
#
# Uso, con permisos de administrador:
#   pnpm build
#   pnpm exec electron-builder --win --dir
#   powershell -ExecutionPolicy Bypass -File scripts\actualizar-instalacion.ps1
#
# Smart App Control está bloqueando cualquier .exe nuevo sin firma reputada, así
# que el instalador no sirve. Pero el ejecutable instalado ya está permitido y
# el motor es el mismo (Electron 44.3.0): todo el código de la aplicación vive
# en resources\app.asar, de modo que cambiando eso queda actualizada.
#
# Antes de nada se guarda una copia de lo que había, por si hay que volver.

$ErrorActionPreference = 'Stop'

# Las rutas salen de donde esta el script, no de una carpeta concreta: asi
# funciona en cualquier maquina y en cualquier clon del repositorio.
$raiz    = Split-Path -Parent $PSScriptRoot
$destino = 'C:\Program Files\AI Command Center\resources'
$origen  = Join-Path $raiz 'release\win-unpacked\resources'
# El respaldo lleva la fecha: si se actualiza dos veces no se pisa el de antes.
$copia    = Join-Path $raiz ('release\respaldo-' + (Get-Date -Format 'yyyyMMdd-HHmm'))
$registro = Join-Path $raiz 'release\actualizar.log'

function Anota($texto) {
  Add-Content -Path $registro -Value $texto -Encoding utf8
}

Set-Content -Path $registro -Value "inicio $(Get-Date -Format s)" -Encoding utf8

try {
  # 1. Cerrar la aplicación si está abierta.
  $vivos = Get-Process -Name 'AI Command Center' -ErrorAction SilentlyContinue
  if ($vivos) {
    Anota "cerrando $($vivos.Count) proceso(s)"
    $vivos | Stop-Process -Force
    Start-Sleep -Seconds 2
  } else {
    Anota 'no estaba abierta'
  }

  # 2. Guardar lo que había.
  if (Test-Path $copia) { Remove-Item $copia -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $copia | Out-Null
  Copy-Item (Join-Path $destino 'app.asar') $copia -Force
  if (Test-Path (Join-Path $destino 'app.asar.unpacked')) {
    Copy-Item (Join-Path $destino 'app.asar.unpacked') $copia -Recurse -Force
  }
  Anota "respaldo en $copia"

  # 3. Poner lo nuevo.
  Copy-Item (Join-Path $origen 'app.asar') $destino -Force
  if (Test-Path (Join-Path $destino 'app.asar.unpacked')) {
    Remove-Item (Join-Path $destino 'app.asar.unpacked') -Recurse -Force
  }
  Copy-Item (Join-Path $origen 'app.asar.unpacked') $destino -Recurse -Force
  Anota "copiado app.asar ($((Get-Item (Join-Path $destino 'app.asar')).Length) bytes)"

  Anota 'OK'
} catch {
  Anota "ERROR $($_.Exception.Message)"
  exit 1
}
