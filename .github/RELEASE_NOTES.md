## ⬇ Descargar · Download

| Archivo · File | Español | English |
|---|---|---|
| `AI Command Center-Setup-*.exe` | **Instalador.** Lo normal: crea accesos directos y desinstalador. No pide permisos de administrador. | **Installer.** The normal choice: creates shortcuts and an uninstaller. No admin rights needed. |
| `AI Command Center-*-x64.zip` | **Portátil.** Descomprime y ejecuta. No instala nada. | **Portable.** Extract and run. Installs nothing. |
| `SHA256SUMS.txt` | Para verificar la descarga. | To verify your download. |

Windows 10 (22H2+) u 11, 64 bits · *Windows 10 (22H2+) or 11, 64-bit*
No necesitas Node, Python ni Visual Studio · *No Node, Python or Visual Studio required*

---

## 🇪🇸 Español

### Windows te va a avisar, y es normal

**La aplicación no está firmada digitalmente.** Firmarla exige un certificado de pago de
200-400 € al año, y este proyecto es gratuito y no tiene ninguno. El aviso **no dice que
el programa sea peligroso**: dice que nadie ha pagado por acreditar quién lo publica.

Al abrirlo verás *«Windows protegió su PC»*. Pulsa **Más información** y después
**Ejecutar de todas formas**. Sólo pasa la primera vez.

**¿No aparece ese botón?** Tienes **Smart App Control** activado, que viene de fábrica en
las instalaciones limpias de Windows 11 y no ofrece ninguna opción. Entonces:

1. Prueba el **`.zip` portátil**. Antes de descomprimirlo: clic derecho → **Propiedades**
   → marca **Desbloquear**.
2. O **compílalo tú mismo**, que es la vía que siempre funciona:
   `git clone` → `pnpm install` → `pnpm dist`.
3. Desactivar Smart App Control es **irreversible sin reinstalar Windows**. No lo hagas
   por una aplicación.

### Verificar lo que has descargado

```powershell
Get-FileHash '.\AI Command Center-Setup-0.4.0.exe' -Algorithm SHA256
```

Tiene que coincidir con la línea correspondiente de `SHA256SUMS.txt`. Si no coincide, no
lo ejecutes.

### La primera vez

Arranca vacía a propósito: sin claves, sin cuenta y sin conectarse a nada. Necesitas al
menos una de estas tres cosas:

- **Una clave de API** — en Ajustes → Proveedores. Se guarda cifrada con DPAPI en tu
  perfil de Windows y no sale de tu equipo.
- **Un agente de línea de comandos** ya instalado (Claude Code, Codex, Aider, OpenCode,
  Gemini CLI…). Se detecta solo, y no hace falta ninguna clave.
- **Ollama** corriendo, para modelos locales sin pagar nada.

Opcionales: `git` para el panel de git, la CLI `gh` para el de GitHub. Lo que falte se
señala en su pantalla y el resto funciona igual.

📖 [Instrucciones completas](https://github.com/Hredo/ai-command-center#instalación)

---

## 🇬🇧 English

### Windows will warn you, and that's expected

**The application is not code-signed.** Signing requires a paid certificate costing
€200–400 a year, and this project is free and doesn't have one. The warning **does not say
the program is dangerous**: it says nobody has paid to certify who publishes it.

On opening it you'll see *"Windows protected your PC"*. Click **More info**, then
**Run anyway**. It only happens the first time.

**No such button?** You have **Smart App Control** enabled — it ships on by default on
clean Windows 11 installations and offers no choice. In that case:

1. Try the **portable `.zip`**. Before extracting: right-click → **Properties** → tick
   **Unblock**.
2. Or **build it yourself**, which always works:
   `git clone` → `pnpm install` → `pnpm dist`.
3. Turning Smart App Control off **cannot be undone without reinstalling Windows**. Don't
   do it for one application.

### Verifying your download

```powershell
Get-FileHash '.\AI Command Center-Setup-0.4.0.exe' -Algorithm SHA256
```

It must match the corresponding line in `SHA256SUMS.txt`. If it doesn't, don't run it.

### First run

It starts empty on purpose: no keys, no account, no connections of its own. You need at
least one of these three:

- **An API key** — in Settings → Providers. Stored encrypted with DPAPI in your Windows
  profile; it never leaves your machine.
- **A command-line agent** you already have (Claude Code, Codex, Aider, OpenCode, Gemini
  CLI…). Detected automatically, and no key required.
- **Ollama** running, for local models at no cost.

Optional: `git` for the git panel, the `gh` CLI for the GitHub panel. Anything missing is
flagged on its own screen and everything else works the same.

📖 [Full instructions](https://github.com/Hredo/ai-command-center/blob/main/README.en.md#installation)
