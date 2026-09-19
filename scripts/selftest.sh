#!/usr/bin/env bash
# Autoprueba de la app en macOS o Linux, abierta como la abriría un usuario.
#
# Uso: scripts/selftest.sh <carpeta de resultados> <ejecutable> [argumentos…]
#
# Una app abierta desde el Dock o desde el menú del escritorio no hereda el
# entorno de la terminal: su PATH se queda en /usr/bin:/bin. Para probar eso de
# verdad, se deja un CLI falso («claude») en una carpeta que sólo añade la
# configuración de la shell (.zshrc, .bashrc…) y se lanza la app con un entorno
# vacío. La app tiene que encontrarlo igual.
#
# La propia app hace las comprobaciones (ver src/main/selftest.ts): este script
# sólo prepara el terreno, la lanza y enseña el resultado. Sale con el código
# de la app: 0 si todo pasa.
set -u

out="$1"
shift
mkdir -p "$out"

bin="$HOME/acc-selftest-bin"
mkdir -p "$bin"
printf '#!/bin/sh\necho "claude de prueba 1.0"\n' > "$bin/claude"
chmod +x "$bin/claude"
for rc in .zshrc .bashrc .bash_profile .profile; do
  grep -qs acc-selftest-bin "$HOME/$rc" || echo 'export PATH="$HOME/acc-selftest-bin:$PATH"' >> "$HOME/$rc"
done

run=("$@")
# Linux sin pantalla (la CI): un servidor X virtual.
if [ "$(uname)" = Linux ] && [ -z "${DISPLAY:-}" ]; then run=(xvfb-run -a "${run[@]}"); fi

env -i \
  HOME="$HOME" USER="${USER:-$(id -un)}" LOGNAME="${USER:-$(id -un)}" \
  SHELL="${SELFTEST_SHELL:-${SHELL:-/bin/bash}}" \
  PATH=/usr/bin:/bin:/usr/sbin:/sbin \
  TMPDIR="${TMPDIR:-/tmp}" DISPLAY="${DISPLAY:-}" \
  ACC_SELFTEST="$out" ACC_SELFTEST_EXPECT_PATH="$bin" ACC_SELFTEST_EXPECT_CLI=claude \
  ACC_SELFTEST_EXPECT_SANDBOX="${ACC_SELFTEST_EXPECT_SANDBOX:-}" \
  "${run[@]}" > "$out/log.txt" 2>&1
code=$?

grep '\[selftest\]' "$out/log.txt" || true
if [ ! -f "$out/selftest.json" ]; then
  echo "La app no llegó a escribir su informe. Últimas líneas:"
  tail -40 "$out/log.txt"
  [ "$code" -eq 0 ] && code=1
fi
echo "código de salida: $code"
exit "$code"
