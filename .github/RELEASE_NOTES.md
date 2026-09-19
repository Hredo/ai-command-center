## ⬇ Descargar · Download

**Windows · macOS · Linux.** Elige la línea de tu sistema · *Pick the line for your system*:

| Sistema · System | Archivo · File | |
|---|---|---|
| **Windows** 10 (22H2+) / 11, 64 bits | `AI-Command-Center-Setup-*.exe` | **Instalador**, lo normal · **Installer**, the usual choice |
| | `AI-Command-Center-*-x64.zip` | **Portátil**, sin instalar · **Portable**, nothing to install |
| **macOS** 13+ con chip de Apple · *with an Apple chip* (M1–M4…) | `AI-Command-Center-*-mac-arm64.dmg` | Arrástrala a Aplicaciones · *Drag it into Applications* |
| **macOS** 13+ con Intel · *with Intel* | `AI-Command-Center-*-mac-x64.dmg` | Arrástrala a Aplicaciones · *Drag it into Applications* |
| **Ubuntu, Debian, Mint, Pop!_OS**… (x64) | `AI-Command-Center-*-linux-amd64.deb` | `sudo apt install ./<archivo · file>.deb` |
| **Cualquier Linux** · *Any Linux* (x64) | `AI-Command-Center-*-linux-x86_64.AppImage` | `chmod +x` y a ejecutar · *and run it* |
| Linux **ARM64** | `…-linux-arm64.deb` · `…-linux-arm64.AppImage` | Igual · *Same* |
| | `SHA256SUMS.txt` | Para verificar la descarga · *To verify your download* |

No necesitas Node, Python ni compiladores · *No Node, Python or compilers required*.
Cada paquete se instaló y se probó en GitHub Actions antes de publicarse · *Every package was installed and tested on GitHub Actions before being published*.

---

## ✨ Novedades en 0.7.0 · What's new in 0.7.0

| Español | English |
|---|---|
| **macOS y Linux.** La app funciona en los tres sistemas: `.dmg` para Mac con chip de Apple y con Intel, y `.deb` y AppImage para Linux x64 y ARM64. | **macOS and Linux.** The app runs on all three systems: a `.dmg` for Apple-chip and Intel Macs, and a `.deb` and an AppImage for Linux x64 and ARM64. |
| **La terminal con tu shell.** bash, zsh y fish con su integración (código de salida y carpeta de cada comando), cargando antes tu configuración; en macOS, como terminal de inicio de sesión, igual que Terminal.app. | **The terminal with your shell.** bash, zsh and fish with their integration (each command's exit code and folder), loading your own configuration first; on macOS as a login shell, just like Terminal.app. |
| **Tus CLIs aunque abras la app desde el Dock.** La app lee el `PATH` de tu shell al arrancar, así que encuentra `claude`, `codex`, `opencode`, `gh` u `ollama` instalados con Homebrew, npm o pnpm. | **Your CLIs even when you open the app from the Dock.** The app reads your shell's `PATH` at startup, so it finds `claude`, `codex`, `opencode`, `gh` or `ollama` installed with Homebrew, npm or pnpm. |
| **Agentes que ejecutan con bash** fuera de Windows, y que al cortarlos por tiempo no dejan procesos vivos. | **Agents run commands with bash** outside Windows, and when timed out they leave no processes behind. |
| **Hecha para cada sistema:** semáforos de macOS y atajos con ⌘, Llavero de macOS y llavero de GNOME/KDE para las claves, memoria unificada de los chips de Apple para recomendar modelos locales, Finder o gestor de archivos, y Homebrew o apt para instalar `gh`. | **Made for each system:** macOS traffic lights and ⌘ shortcuts, the macOS Keychain and the GNOME/KDE keyring for keys, Apple chips' unified memory for local model recommendations, Finder or your file manager, and Homebrew or apt to install `gh`. |
| **La ventana cabe en tu pantalla** también en portátiles pequeños. | **The window fits your screen**, small laptops included. |

---

## ✨ Novedades en 0.6.0 · What's new in 0.6.0

| Español | English |
|---|---|
| **OpenCode con el proveedor que elijas.** En la pestaña Agente y en la Consola eliges OpenCode Zen o tus modelos de Ollama, el modelo y el esfuerzo. Con Ollama, la app lo enciende si hace falta. Para darle la ventana entera crea en Ollama una variante de cada modelo (por ejemplo `qwen3:8b-ctx40k`), que comparte sus pesos y no ocupa disco. | **OpenCode with the provider you choose.** In the Agent tab and the Console, pick OpenCode Zen or your Ollama models, the model and the effort. With Ollama, the app starts it if needed. To give it the full window it creates an Ollama variant of each model (for example `qwen3:8b-ctx40k`) that shares its weights and takes no disk space. |
| **Los agentes trabajan como agentes.** Un agente de la página Agentes ya no es un chat con instrucciones: siempre usa herramientas y da las vueltas que haga falta hasta acabar, con su esfuerzo y sus permisos. Con proyecto trabaja en sus archivos; sin proyecto, en su propia carpeta, que puedes abrir desde la Consola. | **Agents work as agents.** An agent from the Agents page is no longer a chat with instructions: it always uses tools and loops until the task is done, with its own effort and permissions. With a project it works on its files; without one, in its own folder, which you can open from the Console. |
| **Modelos locales y agentes en la pestaña Agente.** La pestaña Agente de cada proyecto trabaja también con tus modelos de Ollama y con los agentes de la página Agentes, con las herramientas de la app y sus permisos. | **Local models and agents in the Agent tab.** Each project's Agent tab also works with your Ollama models and with the agents from the Agents page, using the app's own tools and permissions. |
| **Contexto siempre al máximo con Ollama.** Chats, agente y OpenCode piden la ventana entera de cada modelo; antes Ollama se quedaba en 4.096 tokens y recortaba la conversación sin avisar. En GPUs pequeñas parte del modelo pasa a la CPU y va más lento. | **Always full context with Ollama.** Chats, agent and OpenCode request each model's full window; Ollama used to stop at 4,096 tokens and silently trim the conversation. On small GPUs part of the model moves to the CPU and runs slower. |
| **La terminal integrada** le pasa a OpenCode tus modelos de Ollama, que aparecen en su `/models`. | **The built-in terminal** hands your Ollama models to OpenCode, so they show up in its `/models`. |
| **Los agentes dicen por qué fallan.** Cuando OpenCode se rinde, la Consola enseña su mensaje en lugar de «Salió con código 1»; y si la causa es que tu red no resuelve el dominio de su API (hay redes que filtran dominios), lo dice. | **Agents say why they fail.** When OpenCode gives up, the Console shows its message instead of "exited with code 1"; and if the cause is that your network doesn't resolve its API's domain (some networks filter domains), it says so. |

---

## ✨ Novedades en 0.5.0 · What's new in 0.5.0

| Español | English |
|---|---|
| **La Consola trabaja como un agente.** Con un proyecto elegido, cualquier modelo por API (Ollama, OpenAI y compatibles, Anthropic, Gemini) lee, busca, edita y escribe archivos del proyecto y ejecuta comandos. Tú eliges los permisos: edita solo, pregunta antes, sólo plan o sin límites. | **The Console works as an agent.** With a project selected, any API model (Ollama, OpenAI and compatibles, Anthropic, Gemini) reads, searches, edits and writes project files and runs commands. You pick the permissions: edit freely, ask first, plan only or unrestricted. |
| **Todo en tiempo real.** El panel, el gasto, el histórico y la Arena se actualizan solos, también con lo que gastas en Claude Code desde otras terminales, en menos de un segundo. Lo que se está generando ya cuenta en el gasto. | **Everything live.** Dashboard, spend, history and Arena update on their own, including what you spend in Claude Code from other terminals, in under a second. Whatever is being generated already counts towards spend. |
| **Terminales con Smart App Control.** Si Windows bloquea el módulo nativo de consola, la terminal usa una consola real a través de PowerShell en lugar de quedarse en modo reducido. | **Terminals under Smart App Control.** If Windows blocks the native console module, the terminal uses a real console through PowerShell instead of falling back to reduced mode. |
| **Cabecera de la Consola sin solapes** mientras un agente trabaja, a cualquier ancho de ventana. | **Console header no longer overlaps** while an agent is working, at any window width. |

---

## 🇪🇸 Español

### La primera vez, tu sistema te va a avisar, y es normal

**La aplicación no está firmada con un certificado de pago** (200-400 € al año en
Windows, 99 dólares al año para notarizar en macOS), y este proyecto es gratuito y no
tiene ninguno. El aviso **no dice que el programa sea peligroso**: dice que nadie ha
pagado por acreditar quién lo publica. Sólo pasa la primera vez.

**Windows** — Sale *«Windows protegió su PC»*. Pulsa **Más información** y después
**Ejecutar de todas formas**. ¿No aparece ese botón? Tienes **Smart App Control**: prueba
el **`.zip` portátil** (antes de descomprimirlo: clic derecho → **Propiedades** → marca
**Desbloquear**) o compílala tú (`pnpm dist`). Desactivar Smart App Control es
**irreversible sin reinstalar Windows**; no lo hagas por una aplicación.

**macOS** — Arrastra la app a Aplicaciones y ábrela. macOS la bloquea:

1. Pulsa **OK** en el aviso (no *Trasladar a la Papelera*).
2. **Ajustes del Sistema → Privacidad y seguridad**, abajo del todo: **Abrir igualmente**.
3. Confirma con tu contraseña y otra vez **Abrir igualmente**.

En macOS 13 y 14 vale también clic derecho sobre la app → **Abrir** → **Abrir**. Desde la
Terminal, lo mismo en una línea:
`xattr -dr com.apple.quarantine "/Applications/AI Command Center.app"`

**Linux** — Sin avisos. Con el `.deb`: `sudo apt install ./` y el nombre del archivo. Con
el AppImage: `chmod +x` y a ejecutar; si se queja de `libfuse.so.2`, instala FUSE 2
(`sudo apt install libfuse2t64` en Ubuntu 24.04). En Ubuntu 23.10 y posteriores, mejor el
`.deb`: el AppImage arranca allí sin el aislamiento de Chromium, porque sólo el `.deb`
instala el perfil de AppArmor que lo permite.

### Verificar lo que has descargado

| Sistema | Orden |
|---|---|
| Windows | `Get-FileHash '.\AI-Command-Center-Setup-0.7.0.exe' -Algorithm SHA256` |
| macOS | `shasum -a 256 AI-Command-Center-0.7.0-mac-arm64.dmg` |
| Linux | `sha256sum -c SHA256SUMS.txt --ignore-missing` |

Tiene que coincidir con la línea correspondiente de `SHA256SUMS.txt`. Si no coincide, no
lo ejecutes.

### La primera vez

Arranca vacía a propósito: sin claves, sin cuenta y sin conectarse a nada. Necesitas al
menos una de estas tres cosas:

- **Una clave de API** — en Ajustes → Proveedores. Se guarda cifrada con el llavero de tu
  sistema (DPAPI, el Llavero de macOS o GNOME Keyring/KWallet) y no sale de tu equipo.
- **Un agente de línea de comandos** ya instalado (Claude Code, Codex, Aider, OpenCode,
  Gemini CLI…). Se detecta solo, y no hace falta ninguna clave.
- **Ollama** corriendo, para modelos locales sin pagar nada.

Opcionales: `git` para el panel de git, la CLI `gh` para el de GitHub. Lo que falte se
señala en su pantalla y el resto funciona igual.

📖 [Instrucciones completas para cada sistema](https://github.com/Hredo/ai-command-center/blob/main/README.es.md#instalación)

---

## 🇬🇧 English

### The first time, your system will warn you, and that's expected

**The application is not signed with a paid certificate** (€200–400 a year on Windows,
US$99 a year to notarize on macOS), and this project is free and has neither. The warning
**does not say the program is dangerous**: it says nobody has paid to certify who
publishes it. It only happens the first time.

**Windows** — You'll see *"Windows protected your PC"*. Click **More info**, then
**Run anyway**. No such button? You have **Smart App Control**: try the **portable
`.zip`** (before extracting: right-click → **Properties** → tick **Unblock**) or build it
yourself (`pnpm dist`). Turning Smart App Control off **cannot be undone without
reinstalling Windows**; don't do it for one application.

**macOS** — Drag the app into Applications and open it. macOS blocks it:

1. Click **Done** on the warning (not *Move to Trash*).
2. **System Settings → Privacy & Security**, at the bottom: **Open Anyway**.
3. Confirm with your password and click **Open Anyway** again.

On macOS 13 and 14, right-clicking the app → **Open** → **Open** works too. From the
Terminal, the same in one line:
`xattr -dr com.apple.quarantine "/Applications/AI Command Center.app"`

**Linux** — No warnings. With the `.deb`: `sudo apt install ./` followed by the file name.
With the AppImage: `chmod +x` and run it; if it complains about `libfuse.so.2`, install
FUSE 2 (`sudo apt install libfuse2t64` on Ubuntu 24.04). On Ubuntu 23.10 and later, prefer
the `.deb`: the AppImage starts there without Chromium's isolation, because only the
`.deb` installs the AppArmor profile that allows it.

### Verifying your download

| System | Command |
|---|---|
| Windows | `Get-FileHash '.\AI-Command-Center-Setup-0.7.0.exe' -Algorithm SHA256` |
| macOS | `shasum -a 256 AI-Command-Center-0.7.0-mac-arm64.dmg` |
| Linux | `sha256sum -c SHA256SUMS.txt --ignore-missing` |

It must match the corresponding line in `SHA256SUMS.txt`. If it doesn't, don't run it.

### First run

It starts empty on purpose: no keys, no account, no connections of its own. You need at
least one of these three:

- **An API key** — in Settings → Providers. Stored encrypted with your system's keyring
  (DPAPI, the macOS Keychain or GNOME Keyring/KWallet); it never leaves your machine.
- **A command-line agent** you already have (Claude Code, Codex, Aider, OpenCode, Gemini
  CLI…). Detected automatically, and no key required.
- **Ollama** running, for local models at no cost.

Optional: `git` for the git panel, the `gh` CLI for the GitHub panel. Anything missing is
flagged on its own screen and everything else works the same.

📖 [Full instructions for each system](https://github.com/Hredo/ai-command-center/blob/main/README.md#installation)
