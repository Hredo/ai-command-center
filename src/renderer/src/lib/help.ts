/**
 * La documentación de la app, la que abre el botón de ayuda.
 *
 * Va escrita aquí, en los dos idiomas, y no en ficheros sueltos: se enseña sin
 * red, se busca dentro de ella y cada tema sabe a qué sección lleva. El texto
 * es Markdown sencillo (párrafos, listas, negritas) y los atajos van aparte,
 * como tabla, para que cambien solos entre Ctrl y ⌘.
 *
 * Regla para quien la toque: cada frase describe algo que la app hace de
 * verdad y con el nombre que tiene en pantalla. Lo que no se puede, se dice.
 */
import type React from 'react'
import {
  Bot, Boxes, CircleHelp, Columns2, Compass, FolderGit2, History, Home, Keyboard, KeyRound, LayoutDashboard,
  MessageSquare, Palette, Rocket, ShieldCheck, SquareKanban, Swords, TerminalSquare, UserCircle2, Wrench, Zap
} from 'lucide-react'
import type { PageId } from './nav'

type Lang = 'es' | 'en'

export interface HelpTopic {
  id: string
  icon: React.ElementType
  group: 'start' | 'sections' | 'more'
  /** La sección a la que lleva el botón «Abrir». */
  page?: PageId
  /** Y su pestaña, si hace falta. */
  tab?: string
  title: Record<Lang, string>
  summary: Record<Lang, string>
  body: Record<Lang, string>
  /** Atajos de este tema: se pintan como tabla, con ⌘ en macOS. */
  keys?: { keys: string; es: string; en: string }[]
}

export const HELP_GROUPS: { id: HelpTopic['group']; title: Record<Lang, string> }[] = [
  { id: 'start', title: { es: 'Para empezar', en: 'Getting started' } },
  { id: 'sections', title: { es: 'Cada sección', en: 'Each section' } },
  { id: 'more', title: { es: 'Más', en: 'More' } }
]

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: 'start',
    icon: Rocket,
    group: 'start',
    title: { es: 'Primeros pasos', en: 'First steps' },
    summary: { es: 'Qué es la app y cómo dejarla lista en tres pasos.', en: 'What the app is and how to get it ready in three steps.' },
    body: {
      es: `AI Command Center reúne en una sola ventana todas tus IAs: los **modelos por API** (con tu clave), los **modelos locales** (Ollama, LM Studio…) y los **agentes de línea de comandos** que tengas instalados (Claude Code, Codex, Gemini CLI, OpenCode…). Desde aquí hablas con ellos, les mandas trabajo sobre tus proyectos y ves cuánto gastas con cada uno.

**1. Conecta tus IAs.** En **Ajustes › Cuentas** se inicia sesión con GitHub, con cada agente y con OpenRouter. Las claves de los demás proveedores se pegan en **Ajustes › Proveedores**. Los agentes instalados se añaden en **Agentes › Línea de comandos**, con «Importar los detectados». Un modelo local aparece solo en cuanto su motor está encendido.

**2. Añade un proyecto.** En **Proyectos**, «Añadir proyecto» (una carpeta de tu disco) o «Clonar de GitHub». Con un proyecto abierto, los agentes trabajan dentro de esa carpeta y ves sus archivos, su git y su terminal.

**3. Pregunta o lanza un agente.** En la **Consola**, «Chat» abre una conversación con un modelo y «Agente» una sesión con uno de tus agentes sobre un proyecto. Lo que hagas queda en el **Histórico** y se suma en el **Panel**.

Todo se guarda en tu equipo. No hay cuenta de la app ni servidor propio.`,
      en: `AI Command Center brings all your AIs into one window: **API models** (with your key), **local models** (Ollama, LM Studio…) and the **command-line agents** you have installed (Claude Code, Codex, Gemini CLI, OpenCode…). From here you talk to them, send them work on your projects and see how much you spend with each.

**1. Connect your AIs.** In **Settings › Accounts** you sign in to GitHub, to each agent and to OpenRouter. Keys for other providers are pasted in **Settings › Providers**. Installed agents are added in **Agents › Command line** with "Import detected". A local model shows up by itself as soon as its engine is running.

**2. Add a project.** In **Projects**, "Add project" (a folder on your disk) or "Clone from GitHub". With a project open, agents work inside that folder and you see its files, its git and its terminal.

**3. Ask or launch an agent.** In the **Console**, "Chat" opens a conversation with a model and "Agent" a session with one of your agents on a project. What you do is kept in **History** and added up in the **Dashboard**.

Everything is stored on your machine. There is no app account and no server of its own.`
    }
  },
  {
    id: 'move',
    icon: Compass,
    group: 'start',
    title: { es: 'Moverte por la app', en: 'Getting around' },
    summary: { es: 'El menú, la paleta, la búsqueda y la barra de arriba.', en: 'The menu, the palette, search and the top bar.' },
    body: {
      es: `**El menú de la izquierda** tiene las secciones. Un clic abre la sección; si ya está a la vista en otro panel, te lleva a él. El botón de abajo lo encoge a sólo iconos. Un número verde al lado de una sección dice cuántas cosas tiene en marcha; uno naranja en Tareas, cuántas esperan tu respuesta.

**«Ir a…»** (la paleta) es la forma más rápida de llegar a cualquier sitio: escribe unas letras y salta a una sección, un proyecto, una conversación, un agente o un script del proyecto. También lanza acciones como «Conversación nueva» o «Dividir a la derecha».

**«Buscar»** busca texto dentro de tus conversaciones y del histórico.

**La barra de arriba** enseña siempre lo esencial: cuántas cosas hay en marcha, cuántos proveedores tienes listos, cuántos modelos y el gasto del mes (sube mientras algo genera). A su lado están la distribución de la mesa y esta ayuda.

Cambiar de sección no para nada: una respuesta que se está generando, un agente trabajando o una orden en la terminal siguen aunque mires otra cosa.`,
      en: `**The menu on the left** holds the sections. One click opens a section; if it is already visible in another pane, it takes you there. The button at the bottom shrinks it to icons only. A green number next to a section says how many things it has running; an orange one on Tasks, how many are waiting for your answer.

**"Go to…"** (the palette) is the fastest way anywhere: type a few letters and jump to a section, a project, a conversation, an agent or a project script. It also runs actions like "New conversation" or "Split right".

**"Search"** looks for text inside your conversations and history.

**The top bar** always shows the essentials: how many things are running, how many providers are ready, how many models, and this month's spend (it moves while something is generating). Next to it are the workbench layout and this help.

Switching sections stops nothing: a reply being generated, an agent at work or a command in the terminal keep going while you look at something else.`
    },
    keys: [
      { keys: 'Ctrl+K', es: 'Ir a… (la paleta)', en: 'Go to… (the palette)' },
      { keys: 'Ctrl+Shift+F', es: 'Buscar en conversaciones e histórico', en: 'Search conversations and history' },
      { keys: 'Ctrl+1 … Ctrl+9', es: 'La sección de ese puesto del menú', en: 'The section in that menu position' },
      { keys: 'Ctrl+,', es: 'Ajustes', en: 'Settings' },
      { keys: 'F1', es: 'Esta ayuda', en: 'This help' }
    ]
  },
  {
    id: 'workbench',
    icon: Columns2,
    group: 'start',
    title: { es: 'La mesa de trabajo: varias secciones a la vez', en: 'The workbench: several sections at once' },
    summary: { es: 'Divide la ventana, arrastra secciones y guarda tu distribución.', en: 'Split the window, drag sections and save your layout.' },
    body: {
      es: `Puedes tener hasta **cuatro secciones a la vista**: la Consola junto a la Terminal, un proyecto con sus Tareas debajo, el Panel al lado del Histórico.

**Dividir.** El botón de distribución de la barra de arriba (el dibujo de los paneles) tiene las distribuciones de partida y «Dividir a la derecha» y «Dividir abajo». Con más de un panel, cada uno lleva una cabecera con los mismos botones y una ✕ para cerrarlo.

**Abrir al lado.** Ctrl+clic en una sección del menú (o el botón central del ratón) la abre a la derecha del panel activo. Con el botón derecho eliges «Abrir a la derecha» o «Abrir abajo».

**Arrastrar.** Arrastra una sección desde el menú, o un panel por el asa de su cabecera, y suéltala donde quieras: en el centro de un panel ocupa su sitio (y si venía de otro, se intercambian); en un borde, lo parte por ese lado.

**Repartir el espacio.** Arrastra la línea entre dos paneles. Doble clic la deja a la mitad.

**El panel activo** es el de la línea de color arriba: lo que abras desde el menú o la paleta entra en él. Cambia con un clic o con F6.

**Guardar.** En el mismo botón, escribe un nombre y «Guardar» para volver a esa distribución cuando quieras. La app recuerda cómo la dejaste al cerrar.

Cada sección existe una sola vez (su conversación abierta, su terminal activa): pedir una que ya está a la vista te lleva a su panel en vez de duplicarla. Cuando un panel es estrecho, las listas laterales de su sección se pliegan en una pestaña en el borde; un clic las abre por encima.`,
      en: `You can keep up to **four sections in view**: the Console beside the Terminal, a project with its Tasks below, the Dashboard next to History.

**Split.** The layout button in the top bar (the drawing of the panes) has the starting layouts plus "Split right" and "Split down". With more than one pane, each has a header with the same buttons and a ✕ to close it.

**Open beside.** Ctrl+click a section in the menu (or middle-click) to open it to the right of the active pane. Right-click to choose "Open to the right" or "Open below".

**Drag.** Drag a section from the menu, or a pane by the grip in its header, and drop it where you want: in the middle of a pane it takes its place (and if it came from another, they swap); on an edge, it splits the pane on that side.

**Share out the space.** Drag the line between two panes. Double-click evens it out.

**The active pane** is the one with the coloured line on top: whatever you open from the menu or the palette goes into it. Change it with a click or with F6.

**Save.** In the same button, type a name and "Save" to come back to that layout whenever you like. The app remembers how you left it when you closed.

Each section exists only once (its open conversation, its active terminal): asking for one already in view takes you to its pane instead of duplicating it. When a pane is narrow, the side lists of its section fold into a tab on the edge; one click opens them on top.`
    },
    keys: [
      { keys: 'Ctrl+\\', es: 'Dividir a la derecha', en: 'Split right' },
      { keys: 'Ctrl+Shift+\\', es: 'Dividir abajo', en: 'Split down' },
      { keys: 'Ctrl+Shift+W', es: 'Cerrar el panel activo', en: 'Close the active pane' },
      { keys: 'F6', es: 'Pasar al panel siguiente (Mayús+F6, al anterior)', en: 'Next pane (Shift+F6, previous)' }
    ]
  },
  {
    id: 'accounts',
    icon: UserCircle2,
    group: 'start',
    page: 'settings',
    tab: 'accounts',
    title: { es: 'Cuentas y claves', en: 'Accounts and keys' },
    summary: { es: 'Iniciar sesión con GitHub, con cada agente y con los proveedores.', en: 'Signing in to GitHub, to each agent and to providers.' },
    body: {
      es: `**Ajustes › Cuentas** dice con qué tienes sesión y deja entrar en lo que falta. Se actualiza solo: si entras o sales desde otra terminal, la fila cambia.

- **GitHub.** «Iniciar sesión» enseña un código de un solo uso; lo pegas en github.com, autorizas y la ventana se cierra sola. El token lo recibe y lo guarda la herramienta oficial de GitHub (gh): la app no lo ve. «Usarla también en git» hace que \`git push\` y \`git pull\` usen esa sesión.
- **Claude Code, Codex, Gemini CLI y OpenCode.** «Iniciar sesión» lanza su comando oficial en una terminal de la app. Sigue lo que te pida y la fila pasará a «con sesión». Tu plan de Claude o de ChatGPT se usa a través de ellos, no con clave.
- **OpenRouter.** Autorizas en su web y te crea una clave para esta app.
- **Los demás proveedores** (Anthropic, OpenAI, Google, Groq, DeepSeek…) no ofrecen inicio de sesión a aplicaciones como ésta: se usa una **clave de API**, que se pega en **Ajustes › Proveedores**. El icono de enlace de cada uno abre la página donde se crea.

Las claves se guardan cifradas con el almacén de tu sistema y sólo se envían a su propio proveedor. La app nunca te pide una contraseña.`,
      en: `**Settings › Accounts** shows what you are signed in to and lets you sign in to the rest. It updates by itself: if you sign in or out from another terminal, the row changes.

- **GitHub.** "Sign in" shows a single-use code; paste it at github.com, authorize and the window closes by itself. The token is received and stored by GitHub's official tool (gh): the app never sees it. "Use it in git too" makes \`git push\` and \`git pull\` use that session.
- **Claude Code, Codex, Gemini CLI and OpenCode.** "Sign in" runs their official command in an app terminal. Follow what it asks and the row turns to "signed in". Your Claude or ChatGPT plan is used through them, not with a key.
- **OpenRouter.** You authorize on its website and it creates a key for this app.
- **Other providers** (Anthropic, OpenAI, Google, Groq, DeepSeek…) don't offer sign-in to apps like this one: you use an **API key**, pasted in **Settings › Providers**. The link icon on each row opens the page where you create it.

Keys are stored encrypted with your system's vault and are only sent to their own provider. The app never asks you for a password.`
    }
  },
  {
    id: 'chat',
    icon: MessageSquare,
    group: 'sections',
    page: 'chat',
    title: { es: 'Consola', en: 'Console' },
    summary: { es: 'Conversaciones con modelos y sesiones con agentes.', en: 'Conversations with models and sessions with agents.' },
    body: {
      es: `La Consola tiene tres partes: a la izquierda tus conversaciones, en el centro la conversación y a la derecha sus ajustes.

**Chat** habla con un modelo por API o local. Con un proyecto elegido puedes activar el **modo agente**: el modelo lee, busca y edita archivos del proyecto con herramientas y, si le dejas, ejecuta comandos.

**Agente** abre una sesión con un agente de línea de comandos (Claude Code, Codex, OpenCode, Gemini CLI…) dentro de un proyecto. Ves lo que va haciendo paso a paso: lo que piensa, cada herramienta, los archivos que toca y su lista de tareas.

A la derecha eliges el **modelo**, el **esfuerzo** de razonamiento, los **permisos** y si **sigue en la misma sesión** del agente (recuerda lo anterior) o la bifurca. «Abrir en su terminal» lanza el agente original en una terminal de la app, con esa misma sesión, para lo que sólo existe allí.

**En cada mensaje** puedes copiar, editar y reenviar, regenerar o bifurcar la conversación desde ese punto. **Deshacer este turno** devuelve los archivos a como estaban antes de que el agente los tocara.

**Adjuntos**: el clip añade archivos; una imagen pegada va como imagen si el modelo ve. Escribe **/** para insertar un prompt de tu biblioteca.

**«Seguir con…»** pasa el trabajo a medias a otra IA con su contexto (objetivo, últimos mensajes, tareas, archivos tocados). La app lo propone sola cuando un agente se queda sin cupo.

**Revisar** enseña el diff del turno; puedes comentar líneas y los comentarios vuelven al agente como el siguiente mensaje.`,
      en: `The Console has three parts: your conversations on the left, the conversation in the middle and its settings on the right.

**Chat** talks to an API or local model. With a project selected you can turn on **agent mode**: the model reads, searches and edits the project's files with tools and, if you allow it, runs commands.

**Agent** opens a session with a command-line agent (Claude Code, Codex, OpenCode, Gemini CLI…) inside a project. You see what it does step by step: what it thinks, each tool, the files it touches and its to-do list.

On the right you choose the **model**, the reasoning **effort**, the **permissions** and whether it **continues in the same session** (it remembers what came before) or forks it. "Open in its terminal" starts the original agent in an app terminal, on that same session, for whatever only exists there.

**On each message** you can copy, edit and resend, regenerate or fork the conversation from that point. **Undo this turn** puts the files back as they were before the agent touched them.

**Attachments**: the clip adds files; a pasted image goes as an image if the model can see. Type **/** to insert a prompt from your library.

**"Continue with…"** hands unfinished work to another AI with its context (goal, latest messages, to-dos, touched files). The app suggests it by itself when an agent runs out of quota.

**Review** shows the turn's diff; you can comment on lines and the comments go back to the agent as the next message.`
    },
    keys: [
      { keys: 'Ctrl+Enter', es: 'Enviar', en: 'Send' },
      { keys: '/', es: 'Biblioteca de prompts', en: 'Prompt library' }
    ]
  },
  {
    id: 'permissions',
    icon: ShieldCheck,
    group: 'sections',
    page: 'chat',
    title: { es: 'Permisos de los agentes', en: 'Agent permissions' },
    summary: { es: 'Cada agente pregunta aquí lo mismo que preguntaría en su terminal.', en: 'Each agent asks here what it would ask in its terminal.' },
    body: {
      es: `Cuando un agente necesita permiso (editar un archivo, ejecutar un comando, entrar en una carpeta de fuera del proyecto, salir a la red), la pregunta sale **en la conversación** con tres botones:

- **Permitir**: sólo esta vez.
- **Siempre…**: no vuelve a preguntar por eso. Según el agente vale para la sesión, para el proyecto o para todos tus proyectos; el botón lo dice.
- **Rechazar**: el agente se entera y sigue sin ello.

La misma pregunta aparece en **Tareas › Necesita tu respuesta**, así que no hace falta tener la conversación delante.

**Cuánto puede hacer sin preguntar** se elige en «Permisos», a la derecha de la conversación. Los modos son los de cada agente:

- **Claude Code**: Edita solo, Automático, Sólo plan, Pregunta, Sin límites.
- **Codex**: Edita solo (su modo Auto: trabaja dentro del proyecto y pregunta para salir de él o usar la red), Pregunta, Sólo lectura, Sin límites.
- **OpenCode y Gemini CLI**: Pregunta (lo que su configuración pide confirmar), Sólo plan, Sin límites.
- **Modelos por API en modo agente**: Edita solo, Pregunta, Sólo plan, Sin límites.

En la **Arena** nadie puede contestar a una pregunta: lo que necesite permiso se niega y se dice.`,
      en: `When an agent needs permission (to edit a file, run a command, enter a folder outside the project, reach the network), the question appears **in the conversation** with three buttons:

- **Allow**: just this once.
- **Always…**: it stops asking for that. Depending on the agent it applies to the session, the project or all your projects; the button says which.
- **Deny**: the agent is told and carries on without it.

The same question shows up in **Tasks › Needs your answer**, so you don't need the conversation in front of you.

**How much it can do without asking** is chosen under "Permissions", to the right of the conversation. The modes are each agent's own:

- **Claude Code**: Edits alone, Automatic, Plan only, Ask, No limits.
- **Codex**: Edits alone (its Auto mode: it works inside the project and asks to leave it or use the network), Ask, Read only, No limits.
- **OpenCode and Gemini CLI**: Ask (whatever their config sets to confirm), Plan only, No limits.
- **API models in agent mode**: Edits alone, Ask, Plan only, No limits.

In the **Arena** nobody can answer a question: whatever needs permission is denied, and it says so.`
    }
  },
  {
    id: 'arena',
    icon: Swords,
    group: 'sections',
    page: 'arena',
    title: { es: 'Arena', en: 'Arena' },
    summary: { es: 'El mismo encargo a varias IAs a la vez, para comparar.', en: 'The same job to several AIs at once, to compare.' },
    body: {
      es: `La Arena manda **el mismo prompt a varios contendientes** (modelos por API o agentes) y los pone lado a lado con sus tokens, el tiempo hasta el primer token, la velocidad y el coste.

Marca un **ganador**: con tus elecciones la app calcula una clasificación personal (Elo) que luego usa el recomendador.

Con un **proyecto elegido** es la **Arena de código**: cada contendiente trabaja en su propia copia del proyecto (un worktree de git), sin pisarse ni tocar tu carpeta. Se pueden pasar las pruebas en cada una y **fusionar la que gane**.

Las **baterías** son conjuntos de prompts con comprobaciones (una expresión regular, JSON válido, «pasan las pruebas») que se relanzan cuando quieras y dan una tabla de resultados. Un modelo local puede hacer de **juez** con una rúbrica; su nota se marca como opinión.`,
      en: `The Arena sends **the same prompt to several contenders** (API models or agents) and shows them side by side with their tokens, time to first token, speed and cost.

Pick a **winner**: from your choices the app works out a personal ranking (Elo) that the recommender then uses.

With a **project selected** it becomes the **code Arena**: each contender works on its own copy of the project (a git worktree), without stepping on each other or touching your folder. Tests can run in each and you **merge the winner**.

**Batteries** are sets of prompts with checks (a regular expression, valid JSON, "tests pass") you can rerun whenever you like to get a results table. A local model can act as **judge** with a rubric; its score is marked as an opinion.`
    }
  },
  {
    id: 'terminal',
    icon: TerminalSquare,
    group: 'sections',
    page: 'terminal',
    title: { es: 'Terminal', en: 'Terminal' },
    summary: { es: 'Terminales de verdad, en pestañas, dentro de la app.', en: 'Real terminals, in tabs, inside the app.' },
    body: {
      es: `Cada pestaña es una **shell real** (PowerShell en Windows; la tuya en macOS y Linux) con su carpeta y su historial. Siguen ejecutando aunque cambies de sección.

**+** abre otra: en un proyecto (arranca en su carpeta), en una carpeta cualquiera o en la tuya de usuario. **Atajos** escribe por ti órdenes de siempre (git status, pnpm install…).

Aquí se abren también los comandos que la app lanza a la vista: iniciar sesión en un agente, instalar GitHub CLI o «Abrir en su terminal» desde una conversación.

Cada proyecto tiene además su propia terminal, en su pestaña **Terminal**.`,
      en: `Each tab is a **real shell** (PowerShell on Windows; yours on macOS and Linux) with its folder and its history. They keep running when you switch sections.

**+** opens another: in a project (it starts in its folder), in any folder or in your home. **Shortcuts** types the usual commands for you (git status, pnpm install…).

Commands the app runs in plain sight also open here: signing in to an agent, installing GitHub CLI or "Open in its terminal" from a conversation.

Each project also has its own terminal, in its **Terminal** tab.`
    }
  },
  {
    id: 'tasks',
    icon: SquareKanban,
    group: 'sections',
    page: 'tasks',
    title: { es: 'Tareas', en: 'Tasks' },
    summary: { es: 'Todo lo que tienen entre manos tus agentes, en un tablero.', en: 'Everything your agents are working on, on a board.' },
    body: {
      es: `Un tablero con cuatro columnas: **En marcha**, **Necesita tu respuesta**, **Para revisar** y **Hecho**. Cada tarjeta es un agente trabajando, con su proyecto, su rama, lo que lleva gastado y las líneas que ha cambiado. Se mueve sola.

Desde la tarjeta contestas sin abrir la conversación: **dar o negar un permiso**, responder a lo que pregunta, **revisar el diff** y devolverle comentarios, o darla por hecha.

**Nueva tarea** lanza un agente sobre un proyecto, por omisión en **su propio worktree**: una copia aparte del proyecto, para que no toque tu carpeta hasta que fusiones su trabajo.

**Programar** repite una tarea sola: cada día a una hora, los laborables, una vez por semana o cada tantas horas. Sólo corren con la app abierta; escondida en la bandeja vale. En Ajustes › Preferencias puedes hacer que la app se abra al iniciar sesión.

Con el aviso de Claude Code activado (Ajustes › Preferencias), también salen aquí las sesiones de Claude Code de otras terminales que esperan tu respuesta.`,
      en: `A board with four columns: **Running**, **Needs your answer**, **To review** and **Done**. Each card is an agent at work, with its project, its branch, what it has spent and the lines it has changed. It moves by itself.

From the card you answer without opening the conversation: **allow or deny a permission**, reply to what it asks, **review the diff** and send comments back, or mark it done.

**New task** launches an agent on a project, by default in **its own worktree**: a separate copy of the project, so it doesn't touch your folder until you merge its work.

**Schedule** repeats a task by itself: every day at a time, on weekdays, once a week or every few hours. They only run while the app is open; hidden in the tray counts. In Settings › Preferences you can make the app open when you log in.

With the Claude Code notice turned on (Settings › Preferences), Claude Code sessions from other terminals that are waiting for you also show up here.`
    }
  },
  {
    id: 'projects',
    icon: FolderGit2,
    group: 'sections',
    page: 'projects',
    title: { es: 'Proyectos', en: 'Projects' },
    summary: { es: 'Tus carpetas de trabajo: archivos, git, GitHub y agentes.', en: 'Your working folders: files, git, GitHub and agents.' },
    body: {
      es: `Un proyecto es una carpeta de tu disco. Al abrirlo tienes pestañas:

- **Resumen**: qué es, cuánto se ha gastado en él y lo último que pasó.
- **Archivos**: el árbol y un editor. El buscador encuentra por nombre en todo el proyecto y Ctrl+S guarda.
- **Git**: lo que ha cambiado, preparar y confirmar. Un botón escribe el mensaje del commit a partir de los cambios, y «Revisar con IA» los repasa antes de confirmar.
- **Árbol**: el historial de commits y ramas, dibujado.
- **Terminal** y **Agente**: una shell y un agente dentro de la carpeta.
- **Instrucciones**: AGENTS.md y CLAUDE.md, lo que leen los agentes al empezar. Se pueden mantener iguales.
- **Ajustes**: su nombre, el agente que se preselecciona y unas instrucciones propias del proyecto.

**GitHub** (el botón de arriba): tus repositorios para clonar y, en la pestaña Git, las **pull requests** del proyecto con su CI. Se crean desde aquí con la descripción ya escrita.

**Worktrees**: copias del proyecto en otra rama para que un agente trabaje aparte. Se crean solas con cada tarea y se fusionan o se borran desde el proyecto.

**Puntos de control**: antes de cada turno de un agente se guarda cómo estaban los archivos, sin tocar tu git, para poder deshacerlo.`,
      en: `A project is a folder on your disk. Opening it gives you tabs:

- **Overview**: what it is, how much has been spent on it and what happened last.
- **Files**: the tree and an editor. The search finds by name across the project and Ctrl+S saves.
- **Git**: what changed, staging and committing. A button writes the commit message from the changes, and "Review with AI" checks them before you commit.
- **Graph**: the history of commits and branches, drawn.
- **Terminal** and **Agent**: a shell and an agent inside the folder.
- **Instructions**: AGENTS.md and CLAUDE.md, what agents read when they start. They can be kept identical.
- **Settings**: its name, the agent preselected for it and instructions specific to the project.

**GitHub** (the button at the top): your repositories to clone and, in the Git tab, the project's **pull requests** with their CI. You create them from here with the description already written.

**Worktrees**: copies of the project on another branch so an agent can work apart. They are created with each task and merged or deleted from the project.

**Checkpoints**: before each agent turn the state of the files is saved, without touching your git, so it can be undone.`
    },
    keys: [{ keys: 'Ctrl+S', es: 'Guardar el archivo abierto', en: 'Save the open file' }]
  },
  {
    id: 'agents',
    icon: Bot,
    group: 'sections',
    page: 'agents',
    title: { es: 'Agentes', en: 'Agents' },
    summary: { es: 'Tus agentes, sus herramientas (MCP), Skills y prompts.', en: 'Your agents, their tools (MCP), Skills and prompts.' },
    body: {
      es: `- **Por API**: agentes que tú defines con un modelo, unas instrucciones y un nivel de permisos. Hay plantillas para empezar (revisor de código, documentación…).
- **Línea de comandos**: los agentes instalados en tu equipo. «Importar los detectados» añade los que encuentra (Claude Code, Codex, Gemini CLI, OpenCode, Aider…). Cada uno se lanza con su propio programa, así que se comporta igual que en su terminal.
- **MCP**: los servidores de herramientas que tiene configurados cada agente, en una tabla. Un servidor se copia de uno a otro con un clic, con copia de seguridad antes de escribir; los secretos pasan como referencias a variables de entorno, nunca copiados. Los agentes por API de la app también pueden usar servidores MCP.
- **Skills**: las habilidades de cada agente, y copiarlas entre ellos.
- **Prompts**: tu biblioteca de prompts con variables \`{{así}}\`, que se inserta con **/** en la Consola y la Arena.`,
      en: `- **API**: agents you define with a model, instructions and a permission level. There are templates to start from (code reviewer, documentation…).
- **Command line**: the agents installed on your machine. "Import detected" adds the ones it finds (Claude Code, Codex, Gemini CLI, OpenCode, Aider…). Each runs through its own program, so it behaves just as in its terminal.
- **MCP**: the tool servers each agent has configured, in a table. A server is copied from one to another with a click, with a backup before writing; secrets travel as references to environment variables, never copied. The app's API agents can use MCP servers too.
- **Skills**: each agent's skills, and copying them between agents.
- **Prompts**: your prompt library with \`{{variables}}\`, inserted with **/** in the Console and the Arena.`
    }
  },
  {
    id: 'models',
    icon: Boxes,
    group: 'sections',
    page: 'models',
    title: { es: 'Modelos', en: 'Models' },
    summary: { es: 'Qué modelos tienes, cuánto cuestan y cuál conviene.', en: 'Which models you have, what they cost and which one fits.' },
    body: {
      es: `- **Disponibles**: los modelos que puedes usar ahora mismo (proveedores con clave y motores locales encendidos), con precio, ventana de contexto y lo que has medido tú (latencia, velocidad, coste). Marca favoritos y **compara** varios lado a lado.
- **Catálogo global**: todos los modelos conocidos, con precios y puntuaciones públicas. Se ordena por calidad, por precio o por calidad por dólar.
- **Recomendar**: describe la tarea y la app propone tres opciones (suficiente, equilibrada y máxima) con coste y tiempo estimados y un botón «Usar».

**Modelos locales**: en Ajustes › Local se instala y arranca Ollama, se descargan modelos y se ve qué cabe en tu equipo. Un motor local encendido se detecta solo.`,
      en: `- **Available**: the models you can use right now (providers with a key and local engines that are running), with price, context window and what you have measured yourself (latency, speed, cost). Mark favourites and **compare** several side by side.
- **Global catalogue**: every known model, with public prices and scores. Sort by quality, by price or by quality per dollar.
- **Recommend**: describe the task and the app suggests three options (enough, balanced and maximum) with estimated cost and time and a "Use" button.

**Local models**: in Settings › Local you install and start Ollama, download models and see what fits on your machine. A running local engine is detected by itself.`
    }
  },
  {
    id: 'dashboard',
    icon: LayoutDashboard,
    group: 'sections',
    page: 'dashboard',
    title: { es: 'Panel y cupos', en: 'Dashboard and quotas' },
    summary: { es: 'Cuánto usas y cuánto te queda de cada IA, en vivo.', en: 'How much you use and how much you have left of each AI, live.' },
    body: {
      es: `El Panel resume lo que ha pasado: ejecuciones, gasto, tokens, latencia y velocidad, con gráficas por día y el reparto por proyecto, agente o proveedor.

**Cupos de tus IAs** reúne lo que te queda de cada una, y cada dato dice de dónde sale:

- **Oficial**: lo dice el propio proveedor (el % de tu plan de Claude o de ChatGPT/Codex, el saldo de OpenRouter, DeepSeek o Moonshot, las peticiones de GitHub Copilot).
- **Medido**: la app cuenta lo que has usado contra un tope publicado (Gemini CLI, OpenCode Go).
- **Propio**: un presupuesto que has puesto tú.

Con el ritmo actual se calcula **cuándo llegarías al tope**, y hay avisos al 50, 80 y 95 %. Si un cupo se agota, la app propone seguir con la IA que más margen tenga.

**Todo se mueve solo**, también con lo que usas fuera de la app: una sesión de Claude Code, Codex, Gemini CLI u OpenCode en otra terminal (o en la app de escritorio de Claude) entra al histórico y a los cupos mientras ocurre, en uno o dos segundos. Los saldos por API se preguntan cada minuto con la app a la vista.

**Lo que no se puede saber** se dice en el propio panel: el saldo de OpenCode Zen y el uso de Cursor sólo están en su web; lo que hables en claude.ai o chatgpt.com no deja rastro en tu equipo.

Los **presupuestos** (Ajustes › Cupos) avisan y, si quieres, frenan antes de lanzar: por mes, por día, por proyecto, por proveedor o por agente.`,
      en: `The Dashboard sums up what has happened: runs, spend, tokens, latency and speed, with daily charts and the split by project, agent or provider.

**Your AI quotas** gathers what you have left of each, and every figure says where it comes from:

- **Official**: the provider itself reports it (the % of your Claude or ChatGPT/Codex plan, the balance at OpenRouter, DeepSeek or Moonshot, GitHub Copilot requests).
- **Measured**: the app counts what you have used against a published limit (Gemini CLI, OpenCode Go).
- **Own**: a budget you set yourself.

From the current pace it works out **when you would hit the limit**, and there are alerts at 50, 80 and 95 %. If a quota runs out, the app suggests continuing with the AI that has the most room.

**Everything moves by itself**, including what you use outside the app: a Claude Code, Codex, Gemini CLI or OpenCode session in another terminal (or in Claude's desktop app) enters history and quotas while it happens, within a second or two. API balances are checked every minute while the app is in view.

**What can't be known** is stated in the panel itself: the OpenCode Zen balance and Cursor usage are only on their websites; what you chat on claude.ai or chatgpt.com leaves no trace on your machine.

**Budgets** (Settings › Quotas) warn and, if you want, block before launching: per month, per day, per project, per provider or per agent.`
    }
  },
  {
    id: 'history',
    icon: History,
    group: 'sections',
    page: 'history',
    title: { es: 'Histórico', en: 'History' },
    summary: { es: 'Cada ejecución, con sus cifras, para buscar y exportar.', en: 'Every run, with its figures, to search and export.' },
    body: {
      es: `Una fila por cada ejecución: lo que lanzaste desde la app y las sesiones de tus agentes fuera de ella. Se filtra por tipo, estado, fecha, proyecto y proveedor, y se busca por texto.

Al abrir una fila ves el prompt, la respuesta, los pasos del agente, los archivos que tocó y sus cifras (tokens, tiempo, coste). Desde ahí se puede **seguir el trabajo con otra IA**.

**CSV** y **JSON** exportan lo que estás viendo. Las conversaciones se exportan e importan desde la Consola, en Markdown o JSON.

El histórico se compacta solo con el tiempo para no crecer sin límite; también se puede compactar a mano en Ajustes › Preferencias.`,
      en: `One row per run: what you launched from the app and your agents' sessions outside it. Filter by type, status, date, project and provider, and search by text.

Opening a row shows the prompt, the reply, the agent's steps, the files it touched and its figures (tokens, time, cost). From there you can **continue the work with another AI**.

**CSV** and **JSON** export what you are looking at. Conversations are exported and imported from the Console, as Markdown or JSON.

History compacts itself over time so it doesn't grow without limit; you can also compact it by hand in Settings › Preferences.`
    }
  },
  {
    id: 'house',
    icon: Home,
    group: 'sections',
    page: 'house',
    title: { es: 'La Casa', en: 'The House' },
    summary: { es: 'Tus IAs, dibujadas: de un vistazo, quién está trabajando.', en: 'Your AIs, drawn: at a glance, who is working.' },
    body: {
      es: `La Casa no configura nada: sirve para mirar. Cada IA que la app detecta (cada agente, cada modelo local, cada proveedor con clave) vive en ella. Cuando le mandas trabajo se levanta y se pone a ello; cuando no, descansa.

Si le mandas dos cosas a la vez a la misma, entra por la puerta un vecino idéntico para la segunda y se marcha al terminar. Así se ve de un vistazo cuánto tienes en marcha y quién lo lleva. La lista de la derecha dice quién es cada uno y qué está haciendo.`,
      en: `The House configures nothing: it is there to look at. Every AI the app detects (each agent, each local model, each provider with a key) lives in it. When you send it work it gets up and gets on with it; when not, it rests.

If you send two things at once to the same one, an identical neighbour comes in through the door for the second and leaves when it is done. So you can see at a glance how much is running and who has it. The list on the right says who each one is and what it is doing.`
    }
  },
  {
    id: 'quick',
    icon: Zap,
    group: 'more',
    page: 'settings',
    tab: 'prefs',
    title: { es: 'Prompt rápido y bandeja', en: 'Quick prompt and tray' },
    summary: { es: 'Preguntar desde cualquier app y dejar la app trabajando de fondo.', en: 'Ask from any app and leave the app working in the background.' },
    body: {
      es: `**Prompt rápido.** Un atajo del sistema abre una ventanita encima de cualquier aplicación para preguntar a un modelo sin buscar la ventana. La respuesta queda guardada como una conversación más y «Seguir en la Consola» la abre allí. El atajo se cambia en Ajustes › Preferencias. En Linux con Wayland el atajo global puede no llegar: Ajustes enseña la orden que puedes asignar en los atajos de tu escritorio.

**Bandeja.** Cerrar la ventana no corta lo que está en marcha: la app se esconde en la bandeja del sistema y los agentes, las terminales y las tareas programadas siguen. Desde el icono se vuelve a abrir o se sale de verdad. Si hay trabajo en marcha, salir pregunta antes. Se puede cambiar a «cerrar sale» en Ajustes › Preferencias. En un escritorio de Linux sin bandeja de iconos, cerrar la ventana sale (preguntando si hay algo en marcha).

**Versiones.** La app avisa cuando hay una versión nueva en GitHub y enseña la descarga para tu sistema; no se actualiza sola.`,
      en: `**Quick prompt.** A system shortcut opens a small window on top of any application to ask a model without looking for the window. The reply is kept as one more conversation and "Continue in the Console" opens it there. The shortcut is changed in Settings › Preferences. On Linux with Wayland the global shortcut may not arrive: Settings shows the command you can bind in your desktop's shortcuts.

**Tray.** Closing the window doesn't stop what is running: the app hides in the system tray and agents, terminals and scheduled tasks keep going. From the icon you reopen it or really quit. If work is in progress, quitting asks first. You can switch to "closing quits" in Settings › Preferences. On a Linux desktop with no icon tray, closing the window quits (asking if something is running).

**Versions.** The app tells you when a new version is on GitHub and shows the download for your system; it doesn't update itself.`
    },
    keys: [
      { keys: 'Ctrl+Alt+Space', es: 'Prompt rápido (Option+Espacio en macOS)', en: 'Quick prompt (Option+Space on macOS)' }
    ]
  },
  {
    id: 'customize',
    icon: Palette,
    group: 'more',
    page: 'settings',
    tab: 'appearance',
    title: { es: 'Personalizar', en: 'Customize' },
    summary: { es: 'Tema, letra, tamaño, menú y distribución, a tu gusto.', en: 'Theme, type, size, menu and layout, your way.' },
    body: {
      es: `**Ajustes › Apariencia**:

- **Tema**: oscuros y claros. «Mesa» es el de fábrica.
- **Acento**: el color de botones y resaltes.
- **Letra y tamaño**, y la **escala** de toda la ventana (como el zoom de un editor).
- **Densidad**: compacta, normal o cómoda. **Esquinas**: rectas, suaves o redondas.
- Animaciones, rejilla de fondo, barras de desplazamiento finas y opacidad de los paneles.
- **Idioma**: español o inglés.

**El menú lateral** se ordena arrastrando una sección sobre otra. Con el botón derecho se esconde lo que no uses; el botón derecho en un hueco del menú lo vuelve a mostrar o lo deja como venía.

**Los paneles** de dentro de cada sección (listas, detalle) se ensanchan arrastrando su borde; doble clic vuelve al tamaño de fábrica.

**La distribución** de la mesa se guarda con nombre (ver «La mesa de trabajo»).

**Ajustes › Editor** cambia la letra, el tamaño y el comportamiento del editor de código.`,
      en: `**Settings › Appearance**:

- **Theme**: dark and light ones. "Mesa" is the default.
- **Accent**: the colour of buttons and highlights.
- **Typeface and size**, and the **scale** of the whole window (like an editor's zoom).
- **Density**: compact, normal or comfortable. **Corners**: square, soft or round.
- Animations, background grid, slim scrollbars and panel opacity.
- **Language**: Spanish or English.

**The side menu** is reordered by dragging one section onto another. Right-click hides what you don't use; right-clicking an empty spot of the menu shows it again or restores it.

**The panels** inside each section (lists, detail) are widened by dragging their edge; double-click returns to the default size.

**The layout** of the workbench is saved by name (see "The workbench").

**Settings › Editor** changes the typeface, size and behaviour of the code editor.`
    }
  },
  {
    id: 'keys',
    icon: Keyboard,
    group: 'more',
    title: { es: 'Atajos de teclado', en: 'Keyboard shortcuts' },
    summary: { es: 'Todos los atajos en un sitio.', en: 'Every shortcut in one place.' },
    body: {
      es: `En macOS, donde pone Ctrl se usa ⌘.`,
      en: `On macOS, use ⌘ where it says Ctrl.`
    },
    keys: [
      { keys: 'Ctrl+K', es: 'Ir a… (la paleta)', en: 'Go to… (the palette)' },
      { keys: 'Ctrl+Shift+F', es: 'Buscar en conversaciones e histórico', en: 'Search conversations and history' },
      { keys: 'Ctrl+1 … Ctrl+9', es: 'La sección de ese puesto del menú', en: 'The section in that menu position' },
      { keys: 'Ctrl+,', es: 'Ajustes', en: 'Settings' },
      { keys: 'F1', es: 'Ayuda', en: 'Help' },
      { keys: 'Ctrl+\\', es: 'Dividir a la derecha', en: 'Split right' },
      { keys: 'Ctrl+Shift+\\', es: 'Dividir abajo', en: 'Split down' },
      { keys: 'Ctrl+Shift+W', es: 'Cerrar el panel activo', en: 'Close the active pane' },
      { keys: 'F6', es: 'Pasar al panel siguiente', en: 'Next pane' },
      { keys: 'Ctrl+Enter', es: 'Enviar el mensaje', en: 'Send the message' },
      { keys: '/', es: 'Biblioteca de prompts (al escribir)', en: 'Prompt library (while typing)' },
      { keys: 'Ctrl+S', es: 'Guardar el archivo abierto', en: 'Save the open file' },
      { keys: 'Esc', es: 'Cerrar un diálogo o la paleta', en: 'Close a dialog or the palette' },
      { keys: 'Ctrl+Alt+Space', es: 'Prompt rápido, desde cualquier app', en: 'Quick prompt, from any app' }
    ]
  },
  {
    id: 'privacy',
    icon: KeyRound,
    group: 'more',
    page: 'settings',
    tab: 'security',
    title: { es: 'Privacidad y seguridad', en: 'Privacy and security' },
    summary: { es: 'Qué se guarda, dónde, y qué no hace nunca la app.', en: 'What is stored, where, and what the app never does.' },
    body: {
      es: `- **Todo es local.** Conversaciones, histórico y configuración están en la carpeta de datos de la app, en tu equipo. No hay cuenta ni servidor de la app, ni telemetría.
- **Las claves de API** se guardan cifradas con el almacén del sistema (DPAPI en Windows, el Llavero en macOS, el llavero de la sesión en Linux) y sólo se envían al servidor de su propio proveedor.
- **GitHub**: la app no ve tu token; todo pasa por la herramienta oficial (gh).
- **Los agentes**: la app lanza sus programas oficiales y lee lo que escriben en tu equipo para contar el uso. No abre sus ficheros de credenciales.
- **Lo que toca de otros programas** está apagado de fábrica y se activa a mano: la barra de estado y el aviso de Claude Code escriben en su configuración con copia de seguridad y la dejan como estaba al quitarlos.
- **Tu git**: los puntos de control y los worktrees no tocan tu índice, tu stash ni tus ramas sin una acción tuya.
- **Lo que sí sale de tu equipo**: lo que mandas a un modelo por API va a su proveedor; lo que hace un agente, a quien él use. Un modelo local no manda nada fuera. Por su cuenta, la app sólo descarga el catálogo público de modelos y mira en GitHub si hay versión nueva; las dos cosas se apagan en Ajustes.

**Ajustes › Seguridad** enseña el estado de las protecciones y dónde está la carpeta de datos.`,
      en: `- **Everything is local.** Conversations, history and settings live in the app's data folder, on your machine. There is no app account or server, and no telemetry.
- **API keys** are stored encrypted with the system vault (DPAPI on Windows, Keychain on macOS, the session keyring on Linux) and are only sent to their own provider's server.
- **GitHub**: the app never sees your token; everything goes through the official tool (gh).
- **Agents**: the app runs their official programs and reads what they write on your machine to count usage. It doesn't open their credential files.
- **What it touches in other programs** is off by default and turned on by hand: Claude Code's status line and notice write to its settings with a backup and leave them as they were when removed.
- **Your git**: checkpoints and worktrees don't touch your index, stash or branches without an action from you.
- **What does leave your machine**: what you send to an API model goes to its provider; what an agent does, to whoever it uses. A local model sends nothing out. On its own, the app only downloads the public model catalogue and checks GitHub for a new version; both can be turned off in Settings.

**Settings › Security** shows the state of the protections and where the data folder is.`
    }
  },
  {
    id: 'trouble',
    icon: Wrench,
    group: 'more',
    title: { es: 'Si algo no va', en: 'If something is not working' },
    summary: { es: 'Los problemas más habituales y cómo salir de ellos.', en: 'The most common problems and how to get past them.' },
    body: {
      es: `**No aparece ningún modelo.** Falta conectar un proveedor: una clave en Ajustes › Proveedores, una sesión en Ajustes › Cuentas o un motor local encendido. «Reescanear» vuelve a buscar.

**Un agente no aparece o no arranca.** Tiene que estar instalado y en el PATH. En Agentes › Línea de comandos, «Importar los detectados». Si pide iniciar sesión, Ajustes › Cuentas.

**Un agente dice que no tiene permiso.** Mira el modo de «Permisos» de la conversación. En «Sólo plan» o «Sólo lectura» no edita. Si la pregunta se te pasó, está en Tareas › Necesita tu respuesta.

**«Sin cupo» o un error 429.** Has llegado al tope de ese plan. El Panel dice cuándo se repone; «Seguir con…» pasa el trabajo a otra IA.

**El gasto no coincide con la factura.** Lo de los planes de suscripción es una estimación a precio de API (sirve para comparar, no es lo que pagas). Lo de las claves de API sale del precio publicado; el saldo oficial, cuando el proveedor lo da, está en el Panel.

**GitHub no funciona.** Hace falta GitHub CLI (gh) y una sesión: Ajustes › Cuentas.

**La terminal no abre.** Ajustes › Preferencias deja elegir otra shell.

**Nada de esto ayuda.** Ajustes › Seguridad enseña la carpeta de datos, donde está el fichero de diagnóstico de cada arranque.`,
      en: `**No model shows up.** A provider still needs connecting: a key in Settings › Providers, a session in Settings › Accounts or a running local engine. "Rescan" looks again.

**An agent is missing or won't start.** It has to be installed and on the PATH. In Agents › Command line, "Import detected". If it asks you to sign in, Settings › Accounts.

**An agent says it lacks permission.** Check the conversation's "Permissions" mode. In "Plan only" or "Read only" it doesn't edit. If you missed the question, it is in Tasks › Needs your answer.

**"Out of quota" or a 429 error.** You have hit that plan's limit. The Dashboard says when it resets; "Continue with…" hands the work to another AI.

**Spend doesn't match the bill.** Subscription plans are an estimate at API prices (useful for comparing, not what you pay). API keys use the published price; the official balance, when the provider gives it, is in the Dashboard.

**GitHub isn't working.** You need GitHub CLI (gh) and a session: Settings › Accounts.

**The terminal won't open.** Settings › Preferences lets you choose another shell.

**None of this helps.** Settings › Security shows the data folder, where the diagnostics file of each start is kept.`
    }
  },
  {
    id: 'about-help',
    icon: CircleHelp,
    group: 'more',
    title: { es: 'El recorrido de bienvenida', en: 'The welcome tour' },
    summary: { es: 'Volver a ver la presentación del primer día.', en: 'See the first-day introduction again.' },
    body: {
      es: `La primera vez que abres la app, un recorrido corto te enseña dónde está cada cosa. Puedes repetirlo cuando quieras con el botón de abajo.`,
      en: `The first time you open the app, a short tour shows you where everything is. You can run it again whenever you like with the button below.`
    }
  }
]
