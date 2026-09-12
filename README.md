# AI Command Center

Aplicación de escritorio para Windows que unifica en un solo sitio el acceso a tus IAs,
la analítica de lo que gastas y tardas, y la gestión de tus proyectos y agentes.

Todo corre en local: las claves se guardan cifradas con DPAPI en tu perfil de usuario y
el histórico vive en ficheros tuyos. No hay servidor, ni cuenta, ni telemetría.

[![ci](https://github.com/Hrval/ai-command-center/actions/workflows/ci.yml/badge.svg)](https://github.com/Hrval/ai-command-center/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/release/Hrval/ai-command-center)](https://github.com/Hrval/ai-command-center/releases/latest)
[![licencia](https://img.shields.io/badge/licencia-MIT-blue)](LICENSE)

## Descargar

**[→ Última versión](https://github.com/Hrval/ai-command-center/releases/latest)**

Windows 10 u 11 de 64 bits. No necesitas Node, ni Python, ni Visual Studio: el
instalador lo trae todo.

| Archivo | Para quién |
|---|---|
| `AI Command Center-Setup-<versión>.exe` | Lo normal: instala, crea el acceso directo y deja desinstalador. |
| `AI Command Center-<versión>-x64.zip` | Portátil. Descomprime y ejecuta. No instala nada ni toca el registro. |
| `SHA256SUMS.txt` | Para verificar la descarga. |

### Windows te va a avisar, y es normal

La aplicación **no está firmada digitalmente**: firmarla exige un certificado de
pago que este proyecto todavía no tiene. Eso no dice nada sobre si el programa es
seguro, sólo que nadie ha pagado por acreditar quién lo publica. El código está
entero aquí y puedes compilarlo tú mismo si prefieres no fiarte del binario.

Al abrirlo verás *«Windows protegió su PC»*. Pulsa **Más información** →
**Ejecutar de todas formas**.

Si ese botón no aparece, tienes **Smart App Control** activado —viene de fábrica
en las instalaciones limpias de Windows 11— y bloquea todo ejecutable sin firmar
sin dar opción. Entonces: prueba el `.zip` portátil, o compílalo tú con
`pnpm install && pnpm dist`. Desactivar Smart App Control es irreversible sin
reinstalar Windows, así que no lo recomiendo por una aplicación.

### La primera vez

Arranca vacía a propósito: no trae ninguna clave ni se conecta a nada por su
cuenta. Para que haga algo necesitas **al menos una** de estas dos cosas:

- **Una clave de API** de cualquier proveedor, pegada en Ajustes. Se guarda
  cifrada con DPAPI en tu perfil de Windows y no sale de tu equipo.
- **Un agente de línea de comandos** ya instalado (Claude Code, Codex, Aider,
  OpenCode, Gemini CLI…). La aplicación detecta los que tengas; los que no,
  aparecen como no encontrados y el resto sigue funcionando.

Complementos opcionales: `git` en el PATH para el panel de git, la CLI `gh` para
el de GitHub, y Ollama corriendo en `localhost:11434` si quieres modelos locales.
Sin ellos esas pantallas lo dicen y ya está; no rompen nada.

## Qué hace

**Panel** — gasto por día, tokens de entrada y salida, latencia media hasta el primer token,
velocidad de generación, tasa de error y ranking de modelos por coste y rendimiento.

**Consola** — conversaciones con cualquier modelo o con un agente de línea de comandos.
Mientras responde se ven sus métricas en vivo (tiempo, primer token, tokens y velocidad
estimados); al terminar se sustituyen por las reales del proveedor. Cada conversación es
una sesión que puedes cerrar, reabrir, renombrar, fijar o borrar, y que sobrevive al
cierre de la aplicación.

Alrededor de cada turno se ve lo que el modelo o el agente informa de verdad:

- **Razonamiento** desplegable, cuando lo publica. De la API salen los bloques de
  pensamiento de Anthropic, el `reasoning_content` de los compatibles con OpenAI, los
  *thoughts* de Gemini y el `thinking` de Ollama. De los agentes de línea de comandos,
  los bloques `thinking` de Claude Code y los eventos `reasoning` de OpenCode. Si un
  agente no lo publica, se dice; no se reconstruye adivinando sobre su salida.
- **Contexto** consumido sobre la ventana del modelo, en tokens y en porcentaje.
- **Límite de uso**: lo que queda de peticiones y de tokens, y cuándo se repone. Sale de
  las cabeceras de la respuesta del proveedor, así que sólo aparece si él lo manda.

Y en la barra lateral de la conversación, un panel de **consumo** con las tres cosas
separadas: cuánto contexto llevas gastado y cuánto te cabe todavía, cuántas peticiones y
tokens te quedan del plan, y una cuenta atrás hasta que se repongan. Lo que el proveedor
no publica se dice con esas palabras, en vez de dibujar una barra a medias. El Panel
recoge lo mismo de todos los proveedores que hayan contestado desde que abriste la app.

Para **Claude Code** hay además su propio apartado: lo que llevas gastado en la ventana de
cinco horas y en los últimos siete días, con los mensajes y las sesiones de cada una, y la
cuenta atrás hasta el reinicio cuando el propio agente lo anuncia. Cuenta también lo que
lanzas fuera de la aplicación, porque sale de las transcripciones que Claude Code deja en
`~/.claude/projects`. Dos avisos que el panel da por escrito: los tokens releídos de caché
van aparte —si se sumaran con los demás saldrían cientos de millones en una tarde— y el
dinero es lo que costaría a precio de API, que con plan de pago no es lo que pagas. El
tope del plan no lo publica nadie, así que no se pinta ningún porcentaje: se enseña el
gasto real y la hora del reinicio, y ahí se para.
- **Archivos que toca**: los que cambiaron de verdad, medidos comparando el repositorio
  antes y después, con sus líneas añadidas y quitadas; y aparte los que el agente dice
  haber abierto, distinguiendo lo que sólo leyó de lo que editó.
- **Rama** en la que se ejecutó, con un selector para cambiar de rama o crear una nueva.
- **Adjuntos**: eliges ficheros y van con el prompt. A un modelo por API se le manda el
  contenido (recortado si se pasa de tamaño, y avisando); a un agente de línea de
  comandos, las rutas, que ya sabe abrirlas.
- **Esfuerzo** de razonamiento, de mínimo a máximo. Cada proveedor lo pide a su manera y
  se traduce solo: presupuesto de pensamiento en Anthropic y Gemini, `reasoning_effort`
  en OpenAI, `think` en Ollama, y la opción propia del CLI en claude, codex y aider. En
  «Automático» no se manda nada, así que la petición sale igual que siempre. Si el
  proveedor rechaza el campo, se reintenta sin él en vez de fallar.
- **Qué está haciendo el agente**, paso a paso y mientras lo hace: cada pensamiento y cada
  herramienta con su nombre, sobre qué fichero o qué comando, cuánto tardó, si salió bien
  o mal y el **+N −M** de lo que editó. Arriba, el resumen de la tanda: cuántas acciones,
  cuánto se añadió y se quitó y en cuántos ficheros. Mientras corre está abierto para que
  se vea que no se ha colgado; al terminar se pliega y deja la respuesta limpia. Lo que
  el agente no cuenta no se dibuja: si una herramienta no dice cuántas líneas tocó, no
  sale el contador.
- **Modelo y permisos del agente de consola**, cuando su CLI los admite. En Claude Code se
  elige el modelo (Fable, Opus, Sonnet, Haiku) y con qué manga ancha trabaja: que edite
  solo, que haga todo sin preguntar, que se quede en el plan o que pregunte. Los permisos
  denegados aparecen en la línea de tiempo como lo que son, un paso que no se dejó hacer.

**Arena** — el mismo prompt contra dos, tres o cuatro contendientes a la vez, en columnas
y en streaming simultáneo. Un contendiente puede ser un modelo por API o un agente de
línea de comandos: los dos acaban en la misma tabla comparativa, que resalta el mejor en
cada métrica. Marcas un ganador y queda guardado.

**Terminal** — terminales de verdad dentro de la aplicación, en pestañas. Detrás hay una
consola real (ConPTY), así que funcionan las aplicaciones de pantalla completa: opencode,
vim, los agentes en modo interactivo, todo con sus colores y su interfaz. Ctrl+C es un
Ctrl+C auténtico. La ruta de cada pestaña y la duración de cada comando salen de una
integración de shell que sólo añade marcadores invisibles al prompt.

**Proyectos** — registras carpetas y desde ahí las abres en VS Code o en el explorador,
tienes una terminal propia del proyecto, y lanzas agentes dentro con su salida en directo.
La app escanea el proyecto: rama de git, lenguajes, gestor de paquetes, dependencias de IA
y nombres (nunca valores) de las variables de su `.env`. Los scripts del `package.json` se
ejecutan pinchándolos, en la terminal integrada. Un proyecto se puede **cerrar**: sigue
guardado con su historial pero sale de la lista, y se reabre cuando quieras.

Cada proyecto tiene además:

- **Archivos** — árbol de carpetas que se abre por niveles (las pesadas, como
  `node_modules`, se marcan y sólo se leen si las abres tú), y un editor con Ctrl+S,
  numeración de líneas y aviso si el fichero cambió en disco desde que lo abriste, que es
  lo que pasa cuando un agente ha estado trabajando por detrás. El código va **coloreado**
  —comentarios, textos, números, palabras reservadas, tipos y llamadas— con **guías de
  indentación** que marcan cada nivel, y el Tabulador tabula en vez de saltar de control.
  El coloreado es propio, sin librería: unas cuantas expresiones regulares por familia de
  lenguaje (TypeScript, JavaScript, Python, shell, JSON, CSS, HTML, YAML, SQL, Go, Rust,
  C, Java, PHP, Ruby y Markdown). Los mismos colores se aplican a los bloques de código de
  las respuestas del chat, adivinando el lenguaje cuando la valla del markdown no lo dice.
  Crear, mandar a la papelera y mostrar en el explorador. Toda ruta se resuelve contra la
  raíz del proyecto: un `..` de más se rechaza.
- **Git** — qué ha cambiado con sus líneas, el diff de cada fichero, preparar, confirmar,
  apartar en el stash y recuperarlo, fetch, pull, push, y una caja para cualquier otro
  comando de git. La caja no es una shell: el comando se parte en argumentos y va directo
  a git, sólo se aceptan subcomandos de una lista, y los que pueden tirar trabajo (`reset
  --hard`, `push --force`) piden confirmación. Lo interactivo (un `rebase -i`, que abriría
  un editor) se manda a la terminal integrada, donde sí tiene sentido.
- **Árbol** — el histórico dibujado: un carril por rama, los merges con su curva, y las
  etiquetas de cada rama local, remota o `tag` sobre su commit. Pinchando un commit se
  hace **merge**, **rebase**, **cherry-pick**, **revert**, se crea una rama o una etiqueta
  ahí mismo, se va a ese punto o se vuelve a él conservando o tirando lo posterior. Si un
  merge o un rebase se queda a medias, arriba sale qué está pasando, por qué commit va y
  qué ficheros están en conflicto —se abren en el editor de un clic— con **continuar**,
  **saltar** y **abortar**. Las acciones no son texto libre: la interfaz dice qué quiere
  hacer y el proceso principal arma la llamada a git, así que un nombre de rama no puede
  colar una opción. Git corre sin editor y sin preguntas (`GIT_EDITOR=true`), de forma que
  nada se queda esperando a un teclado que no existe.
- **GitHub** — inicias sesión con su CLI oficial (`gh auth login --web`): se abre el
  navegador y autorizas tú. La aplicación no ve ni guarda tu contraseña ni tu token;
  sólo le pregunta a `gh` con qué cuenta está. Desde ahí ves tus repositorios, los
  buscas, y clonas cualquiera eligiendo carpeta: queda dado de alta como proyecto en el
  mismo gesto.

**Agentes** — dos tipos. Los de API son un preset de modelo, prompt de sistema y
parámetros. Los de línea de comandos son los CLIs que ya tienes instalados (Claude Code,
Codex, opencode, Aider, Gemini CLI…): la app los busca en tu PATH y los ejecuta dentro del
proyecto. De Claude Code extrae tokens y coste reales.

Y también las sesiones que **no** lanzaste desde aquí: si abres `claude` en una terminal
cualquiera, esa conversación entra igualmente en el histórico y en las estadísticas, con
su proyecto, su modelo, sus mensajes y sus ficheros tocados, marcada como venida de fuera.
Se lee de las transcripciones de Claude Code, que crecen por el final y nunca se
reescriben, así que se repasan una vez enteras y después sólo lo que se haya añadido;
mientras tanto se vigila la carpeta, de modo que una sesión que sigue viva aparece
mientras trabajas, no cuando te acuerdes de mirar.

**Modelos** — catálogo dinámico con más de 8.000 modelos de 200 proveedores y sus precios,
descargado de models.dev y OpenRouter. Pinchas un modelo y se abre su ficha: contexto,
precios, modalidades y enlaces a su página, a sus pesos o a su documentación. Cuando un
proveedor no publica página por modelo, se dice y se enlaza su lista en vez de inventar
una dirección.

**Local** (en Ajustes) — gestión de Ollama sin salir de la app: estado del servidor y
botón para arrancarlo, tu hardware, los modelos instalados con su peso, y recomendaciones
calculadas con la VRAM real de tu GPU y el peso real de cada modelo según el registro de
Ollama. Se instalan y se borran desde ahí, con barra de progreso.

**La Casa** — la única pantalla que no sirve para configurar nada: sirve para mirar. Cada
IA que la aplicación detecta —cada agente de consola, cada modelo local, cada proveedor con
llave— vive en una casa dibujada píxel a píxel, en planta y vista de tres cuartos, con
cocina, salón, despacho, dormitorio, sala de juegos, jardín, piscina y cancha de baloncesto.

Si no le mandas nada, cada uno anda descansando: en el sofá, echando una cabezada, en la
máquina recreativa, en el agua o tirando a canasta, y de vez en cuando se cambia de sitio.
Si le mandas una tarea, se levanta y se pone a hacer faena por la casa —cocinar, fregar,
barrer, regar, teclear en el despacho—. Y si le mandas dos a la vez, entra por la puerta
de la calle otro vecino idéntico para la segunda, que se marcha por donde vino en cuanto
esa tarea termina. Al pasar el ratón por encima dice quién es y qué está haciendo.

Todo el dibujo es propio: no hay imágenes, ni sprites descargados, ni nada generado fuera.
Se pinta en un lienzo de 768 por 640 puntos y se agranda por un número entero con el
suavizado apagado, que es lo que hace que los píxeles salgan cuadrados en vez de
emborronados. La animación se para sola cuando te vas a otra pestaña.

**Histórico** — todas las ejecuciones con filtros, ficha detallada y exportación a CSV o JSON.

**Notificaciones** — avisos del sistema al terminar un prompt, un agente, una comparativa,
una descarga de modelo o un comando de terminal que haya tardado más de doce segundos.

## Detalles que importan

**Nada se interrumpe al cambiar de pantalla, ni al cambiar de ventana.** Las
conversaciones, los agentes, las terminales y la Arena viven en un almacén global del
renderer, no en las páginas: una pantalla que has visitado se queda montada y sólo se
esconde, así que no se pierde el scroll, ni la pestaña de terminal abierta, ni lo que
tuvieras a medio escribir. Cada terminal mantiene su emulador vivo; al volver a ella se
reajusta al tamaño y recupera el foco, sin repintar el historial desde cero.

Y lo mismo si te vas a otra aplicación. Chromium deja de dar fotogramas cuando su ventana
está minimizada o tapada, y el texto que iba llegando se quedaba esperando un fotograma
que no llegaba nunca: al volver aparecía todo de golpe y parecía que la IA se había
colgado. Ahora hay un temporizador de respaldo —corre el que llegue antes— y la ventana
pide no ser frenada en segundo plano. Cuesta algo de batería y a cambio lo que corre por
detrás corre de verdad. La barra superior y la lateral muestran cuántas tareas hay en
marcha y dónde.

**La pantalla no se queda vieja.** El proceso principal vigila la carpeta de cada
proyecto —`fs.watch` para enterarse al momento y un repaso cada cuatro segundos por lo que
se le escape— y avisa a la interfaz cuando el repositorio cambia. Confirmar desde la app,
desde una terminal de fuera o desde un agente da igual: la lista de cambios, la rama, el
árbol y el explorador de ficheros se ponen al día solos, sin pulsar «releer». Sólo se manda
aviso cuando el estado cambia de verdad, así que un repaso que no encuentra nada no
repinta nada. Lo mismo con el gasto y el histórico: se releen al terminar cada ejecución.

**Los motores locales se detectan solos.** El proceso principal sondea sus puertos cada
pocos segundos y avisa al renderer cuando uno aparece o desaparece: arrancar Ollama con la
app abierta se nota sin pulsar nada. Si el motor sólo responde por una de las dos
direcciones (`127.0.0.1` o `localhost`), se guarda la que funciona.

## Proveedores

32 en el catálogo, hablando cuatro protocolos: Anthropic, OpenAI (y los ~20 compatibles),
Google Gemini y Ollama nativo.

En la nube: Anthropic, OpenAI, Google, OpenRouter, Groq, DeepSeek, xAI, Mistral, Together,
Fireworks, Cerebras, Perplexity, Cohere, Moonshot, Zhipu, Qwen, NVIDIA, SambaNova, Nebius,
Hyperbolic, Hugging Face, GitHub Models y Azure OpenAI.

En local, detectados por sondeo de puertos: Ollama, LM Studio, llama.cpp, vLLM, Jan,
LocalAI, GPT4All, KoboldCpp y Text generation WebUI.

## Desarrollo

Requiere Node 22 y **pnpm** (nunca npm: rompe el árbol de `node_modules`). Para el panel
de git hace falta `git` en el PATH, y para GitHub su CLI oficial (`winget install --id
GitHub.cli`); sin ella el resto de la aplicación funciona igual y el panel lo dice.

`pnpm dist` comprueba antes de empaquetar que los binarios de la consola real estén en su
sitio (`scripts/check-native.cjs`). Sin esa comprobación se puede generar un instalador
que arranca bien y deja la terminal colgada al abrir la primera pestaña: pasó una vez,
porque un `node-gyp` fallido había vaciado `build/Release`.

```bash
pnpm install
pnpm dev            # app en caliente con recarga
pnpm build          # compila a out/
pnpm dist           # genera el instalador en release/
```

Verificación:

```bash
pnpm exec tsc --noEmit -p tsconfig.node.json
pnpm exec tsc --noEmit -p tsconfig.web.json
pnpm exec electron scripts/smoke.cjs         # arranca y captura pantalla
pnpm exec electron scripts/test-engine.cjs   # motor de streaming, con un SSE falso
pnpm exec electron scripts/test-pty.cjs      # terminal real: opencode, Ctrl+C, códigos
pnpm exec electron scripts/test-terminal.cjs # el motor de respaldo por tuberías
pnpm exec electron scripts/test-features.cjs # sesiones, enlaces, detección, avisos
pnpm exec electron scripts/test-agents.cjs   # razonamiento, contexto, límites, archivos, esfuerzo
pnpm exec electron scripts/test-workspace.cjs # ficheros del proyecto, git y GitHub
pnpm exec electron scripts/shot.cjs Terminal # capturas de una sección
python scripts/make-icon.py                  # regenera build/icon.png
```

`scripts/ollama-setup.cjs` deja Ollama con los mejores modelos para el equipo. Con
`--dry-run` sólo informa de lo que haría.

Las pruebas usan un servidor SSE local y agentes de mentira —un script de Node que emite
los mismos eventos que Claude Code y OpenCode, capturados de las dos herramientas
reales—, así que no gastan tokens ni tocan ninguna cuenta. Las de git y ficheros montan un
repositorio temporal y lo borran al acabar.

## Publicar una versión

Los binarios los genera GitHub Actions, no esta máquina. La razón es concreta:
aquí Smart App Control está activado y en modo de imposición, así que el
instalador NSIS **no se puede ni generar** —electron-builder necesita lanzar un
ejecutable temporal para escribir el desinstalador y Windows no le deja— ni
ejecutar una vez hecho. El runner de GitHub es un Windows limpio sin esa
restricción: allí sale siempre, y sale igual cada vez.

Publicar es empujar una etiqueta:

```bash
git tag v0.4.0
git push origin v0.4.0
```

`.github/workflows/release.yml` comprueba tipos, verifica los binarios nativos,
compila, empaqueta el instalador y el zip portátil, calcula los SHA-256 y crea la
Release con todo dentro. `.github/workflows/ci.yml` hace lo mismo sin empaquetar
en cada empujón a `main`.

### Probar en esta máquina sin instalador

El zip portátil sí se puede generar en local, porque no lanza ningún ejecutable
durante el empaquetado:

```bash
pnpm dist:zip
```

Y para actualizar la copia ya instalada sin tocar el ejecutable —que Windows ya
tiene permitido— todo el código vive en `resources\app.asar`, así que basta con
sustituir eso:

```bash
pnpm build
pnpm exec electron-builder --win --dir
powershell -ExecutionPolicy Bypass -File .\scripts\actualizar-instalacion.ps1
```

El script pide elevación, cierra la aplicación si está abierta, guarda una copia
fechada en `release\respaldo-<fecha>` y copia lo nuevo. Para volver atrás, se
copia el `app.asar` del respaldo encima. Sólo vale mientras la versión de
Electron no cambie; si cambia, hace falta un instalador de verdad.

### Firma

Nada de lo anterior firma la aplicación, y sin firma Windows avisa a quien la
descargue (y Smart App Control directamente la bloquea). Cuando haya
certificado, se añade al workflow y deja de hacer falta explicarle nada a nadie.

## Dependencias nativas

Sólo una: `@homebridge/node-pty-prebuilt-multiarch`, que es la que da la consola real.
Trae binarios precompilados, así que **no** hace falta Visual Studio ni node-gyp. Si algún
día no cargara, la terminal cae sola a un motor por tuberías que organiza la salida en
bloques; se pierde lo interactivo pero la app sigue funcionando, y lo dice en pantalla.

El resto no tiene nada nativo a propósito: el histórico es JSONL en vez de SQLite.

pnpm 11 exige autorizar los scripts de instalación en `allowBuilds`, dentro de
`pnpm-workspace.yaml`. Sin eso el módulo se instala sin binario y en silencio.

## Estructura

```
src/
  shared/types.ts      contrato común entre los tres procesos
  main/
    index.ts           ventana, ciclo de vida y CSP
    ipc.ts             canales principales, con errores convertidos en mensajes
    ipcExtra.ts        terminales, sesiones, Ollama, enlaces y avisos
    config.ts          config.json
    secrets.ts         claves cifradas con DPAPI
    runs.ts            histórico en JSONL y agregación de métricas
    sessions.ts        conversaciones que se pueden cerrar y retomar
    terminal.ts        consola real (ConPTY) y respaldo por tuberías
    ollama.ts          estado, hardware, descargas y recomendaciones
    notify.ts          notificaciones del sistema
    detect.ts          detección de proveedores, CLIs y motores locales
    projects.ts        escaneo de proyectos
    files.ts           ficheros del proyecto, sin salir de su raíz
    git.ts             estado, ramas, diffs, árbol de commits y operaciones
    watch.ts           vigila cada proyecto y avisa cuando el repositorio cambia
    usage.ts           lo último que dijo cada proveedor sobre tus límites
    claudeSessions.ts  lee las transcripciones de Claude Code: ventanas de uso y
                       sesiones lanzadas fuera de la aplicación
    claudeWatch.ts     vigila esa carpeta para que una sesión viva salga en marcha
    github.ts          sesión y repositorios a través de gh
    attach.ts          adjuntos del prompt
    effort.ts          el esfuerzo, traducido a cada proveedor
    providers/
      catalog.ts       los 32 proveedores
      models.ts        catálogo dinámico y cálculo de precios
      links.ts         de un modelo a su página
      run.ts           motor de streaming: 4 dialectos y métricas
      limits.ts        límites de uso leídos de las cabeceras
    agents/cli.ts      ejecución de agentes de línea de comandos
  preload/index.ts     puente aislado hacia el renderer
  renderer/
    lib/engine.tsx     estado vivo de todo, fuera de las páginas
    lib/ansi.ts        intérprete de secuencias ANSI para el modo respaldo
    lib/highlight.ts   coloreado de código y guías de indentación, sin librería
    lib/house.ts       el plano de La Casa: habitaciones, puertas, sitios y el
                       vaivén de los vecinos
    lib/pixelArt.ts    el dibujo de La Casa, píxel a píxel, sin imágenes
    components/        Terminal (xterm.js), FilesPanel, Code (editor coloreado),
                       GitPanel, GitGraph (árbol, merges y rebases), GithubPanel,
                       AgentPanel (contexto, consumo, plan de Claude, ramas),
                       AgentActivity (lo que va haciendo el agente), HouseCanvas,
                       Stats…
    pages/             las diez secciones
```

## Dónde guarda los datos

`%APPDATA%\AI Command Center\data\`

- `config.json` — proveedores, agentes, proyectos y preferencias
- `secrets.json` — API keys cifradas con las credenciales de Windows
- `runs.jsonl` — una línea por ejecución, con todas sus métricas
- `sessions.json` — conversaciones y sesiones de agente
- `models-cache.json` — catálogo de modelos y precios
- `shell-init.ps1` — integración de shell que carga la terminal

Se abre desde Ajustes → Preferencias → Abrir carpeta de datos.
