# Privacy policy

**English** · [Español](#política-de-privacidad)

AI Command Center is a desktop application that runs entirely on your own computer. It has
no account, no server of its own and no telemetry: the maintainer never receives anything
about you or about how you use it.

## What stays on your computer

Everything the app stores lives in its data folder (see
[Where your data lives](README.md#where-your-data-lives)): your providers, agents and
projects, the conversations, the metrics of every run and the model catalog. API keys are
encrypted with your system's keyring (DPAPI on Windows, the Keychain on macOS, Secret
Service on Linux).

To show costs and tokens, the app also reads the local history of other tools you use, such
as Claude Code, Codex, OpenCode or Gemini CLI. It only reads it on your machine and never
sends it anywhere.

## What does leave your computer

The app only connects to other services in these cases:

- **The AI providers you configure.** When you talk to a model, the app sends your prompt,
  the context you attach and your API key to that provider, and nowhere else. What happens
  next is governed by that provider's own privacy policy.
- **Model catalogs.** To list models and prices it downloads the public catalogs of
  [models.dev](https://models.dev) and [OpenRouter](https://openrouter.ai), and, for local
  models, the public Ollama registry. These requests carry no personal data.
- **New version notice.** At startup and every six hours it asks the public GitHub API for
  the latest release. It sends nothing about you and can be turned off in Settings.
- **OpenRouter sign-in**, only if you choose it, uses OpenRouter's standard OAuth flow.

The command-line agents the app launches (Claude Code, Codex, OpenCode, Aider…) are separate
programs that talk to their own services under their own terms.

## Contact

Questions about this policy go to the
[repository issues](https://github.com/Hredo/ai-command-center/issues). Security problems go
through the [security policy](SECURITY.md).

---

# Política de privacidad

[English](#privacy-policy) · **Español**

AI Command Center es una aplicación de escritorio que funciona entera en tu ordenador. No
tiene cuenta, ni servidor propio, ni telemetría: el autor no recibe nada sobre ti ni sobre
cómo la usas.

## Lo que se queda en tu ordenador

Todo lo que guarda la app vive en su carpeta de datos (ver
[Dónde guarda los datos](README.es.md#dónde-guarda-los-datos)): tus proveedores, agentes y proyectos, las
conversaciones, las métricas de cada ejecución y el catálogo de modelos. Las claves de API
van cifradas con el llavero del sistema (DPAPI en Windows, el Llavero en macOS, Secret
Service en Linux).

Para mostrar costes y tokens, la app también lee el historial local de otras herramientas
que uses, como Claude Code, Codex, OpenCode o Gemini CLI. Sólo lo lee en tu equipo y no lo
envía a ningún sitio.

## Lo que sí sale de tu ordenador

La app sólo se conecta a otros servicios en estos casos:

- **Los proveedores de IA que configures.** Cuando hablas con un modelo, la app envía tu
  mensaje, el contexto que adjuntes y tu clave de API a ese proveedor, y a nadie más. Lo que
  pase después lo rige la política de privacidad de ese proveedor.
- **Catálogos de modelos.** Para listar modelos y precios descarga los catálogos públicos de
  [models.dev](https://models.dev) y [OpenRouter](https://openrouter.ai) y, para los modelos
  locales, el registro público de Ollama. Estas peticiones no llevan datos personales.
- **Aviso de versión nueva.** Al arrancar y cada seis horas pregunta a la API pública de
  GitHub por la última versión. No envía nada sobre ti y se puede desactivar en Ajustes.
- **El acceso con OpenRouter**, sólo si lo eliges, usa el OAuth estándar de OpenRouter.

Los agentes de línea de comandos que lanza la app (Claude Code, Codex, OpenCode, Aider…) son
programas aparte que hablan con sus propios servicios según sus propias condiciones.

## Contacto

Las dudas sobre esta política, en los
[issues del repositorio](https://github.com/Hredo/ai-command-center/issues). Los problemas
de seguridad, por la [política de seguridad](SECURITY.md).
