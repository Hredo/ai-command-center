## Descargar

| Archivo | Para quién |
|---|---|
| `AI Command Center-Setup-<versión>.exe` | Lo normal. Instalador con acceso directo y desinstalador. |
| `AI Command Center-<versión>-x64.zip` | Versión portátil. Descomprime y ejecuta el `.exe` de dentro. Sin instalar nada. |
| `SHA256SUMS.txt` | Para verificar la descarga (opcional, abajo se explica). |

Sólo Windows 10/11 de 64 bits. No hace falta Node, ni Python, ni Visual Studio:
va todo dentro.

---

## Windows va a avisarte, y es normal

**La aplicación no está firmada digitalmente.** Firmar cuesta un certificado de
pago, y este proyecto no tiene ninguno todavía. Eso no dice nada de si el
programa es seguro o no: dice que nadie ha pagado por acreditar quién lo
publica. El código está entero en este repositorio y puedes compilarlo tú mismo
(`pnpm install && pnpm dist`) si prefieres no fiarte del binario.

Lo que vas a ver al abrirlo:

> **Windows protegió su PC** — Windows Defender SmartScreen impidió el inicio de
> una aplicación no reconocida.

Pulsa **Más información** y luego **Ejecutar de todas formas**. Eso es todo.

### Si no aparece el botón «Ejecutar de todas formas»

Entonces tienes **Smart App Control** activado, que viene de fábrica en las
instalaciones limpias de Windows 11 y bloquea todo ejecutable sin firmar sin
dar opción. Tienes tres salidas:

1. **Prueba primero el `.zip` portátil.** A veces pasa donde el instalador no.
2. **Compílalo tú**: clona el repositorio y ejecuta `pnpm install && pnpm dist`.
   Lo que compilas en tu propia máquina no pasa por ese filtro.
3. Desactivar Smart App Control es posible, pero **es irreversible sin
   reinstalar Windows**, así que no lo recomiendo por una aplicación.

## Verificar la descarga

En PowerShell, en la carpeta donde la guardaste:

```powershell
Get-FileHash '.\AI Command Center-Setup-0.4.0.exe' -Algorithm SHA256
```

El resultado tiene que coincidir con la línea correspondiente de
`SHA256SUMS.txt`.

---

## Qué te vas a encontrar la primera vez

La aplicación arranca vacía a propósito: no trae ninguna clave ni se conecta a
nada por su cuenta.

- **Para hablar con modelos por API** ve a Ajustes y pega tu clave del proveedor
  que uses. Se guarda cifrada con DPAPI en tu perfil de Windows; no sale de tu
  equipo.
- **Para los agentes de línea de comandos** (Claude Code, Codex, Aider,
  OpenCode…) la aplicación detecta los que ya tengas instalados. Los que no
  tengas aparecen como no encontrados, y el resto funciona igual.
- **El panel de git** necesita `git` en el PATH; el de GitHub, la CLI `gh`.
  Sin ellos esas dos pantallas lo dicen y ya está.
- **Ollama**, si lo tienes corriendo, lo encuentra solo en `localhost:11434`.

No hay cuenta que crear, ni servidor, ni telemetría.
