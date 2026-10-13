/**
 * English strings for everything added in 0.9: Laya and the router, the
 * dashboard you can rearrange and the extra accounts.
 *
 * Merged into the same dictionary as i18n.en.ts and i18n.en.v08.ts (Spanish
 * source text as the key).
 */
export const enV09: Record<string, string> = {
  /* ------------------------------------------------ Laya y el enrutador */
  Enrutador: 'Router',
  'Escribe el prompt y Laya decide modelo, esfuerzo y proveedor': 'Write the prompt and Laya picks the model, effort and provider',
  'Escribe el prompt: Laya decide modelo, esfuerzo y proveedor…': 'Write the prompt: Laya picks the model, effort and provider…',
  'Enrutar con Laya': 'Route with Laya',
  'Laya lee el prompt y lo lanza en una conversación nueva con el modelo, el esfuerzo y el proveedor que convienen':
    'Laya reads the prompt and launches it in a new conversation with the right model, effort and provider',
  'Laya está listo: ya decide en tu equipo': 'Laya is ready: it now decides on your computer',
  'No se pudo instalar Laya:': 'Could not install Laya:',
  'Laya {v} en tu equipo': 'Laya {v} on your computer',
  '¿Quitarlo? Se borran el entorno y el modelo.': 'Remove it? The environment and the model are deleted.',
  'Sí, quitar': 'Yes, remove',
  No: 'No',
  Quitar: 'Remove',
  'Laya decide por ti, en tu equipo': 'Laya decides for you, on your computer',
  'Un modelo de decisiones (Apache-2.0) que lee el prompt y dice qué tipo de tarea es, cuánto cuesta y si hay que tocar archivos. Se instala aparte: un entorno de Python con PyTorch sólo CPU y el modelo multilingüe (unos 1,5 GB en total). No abre ningún puerto y, descargado, funciona sin red.':
    'A decision model (Apache-2.0) that reads the prompt and says what kind of task it is, how hard it is and whether files need touching. It is installed separately: a Python environment with CPU-only PyTorch and the multilingual model (about 1.5 GB in total). It opens no port and, once downloaded, works offline.',
  'Instalar Laya': 'Install Laya',
  'Buscando Python': 'Looking for Python',
  'Creando el entorno con Python {v}': 'Creating the environment with Python {v}',
  'Actualizando pip': 'Updating pip',
  'Instalando PyTorch (sólo CPU)': 'Installing PyTorch (CPU only)',
  'Descargando laya {v}': 'Downloading laya {v}',
  'Instalando laya {v} y sus dependencias': 'Installing laya {v} and its dependencies',
  'Descargando el modelo multilingüe (680 MB)': 'Downloading the multilingual model (680 MB)',
  'Cargando el modelo por primera vez': 'Loading the model for the first time',
  'de tu plan ({n} % libre)': 'from your plan ({n} % left)',
  'de tu plan': 'from your plan',
  'Laya no contestó': 'Laya did not answer',
  'Con proyecto, la tarea se hace sobre sus archivos.': 'With a project, the task works on its files.',
  'Laya + reglas · Laya contestó en {ms} ms': 'Laya + rules · Laya answered in {ms} ms',
  'Por reglas; Laya lo afina al dejar de escribir': 'By rules; Laya refines it when you stop typing',
  'Sólo reglas: instala Laya para que decida él': 'Rules only: install Laya so it decides',
  Decisión: 'Decision',
  'esfuerzo {e}': 'effort {e}',
  'nivel {n}': 'level {n}',
  'Esfuerzo {e}: {why}.': 'Effort {e}: {why}.',
  'el suyo': 'its own',
  'su modelo por omisión': 'its default model',
  'No hay nada con qué lanzarlo: pon una clave de API, inicia sesión en un CLI o arranca Ollama.':
    'Nothing to launch it with: add an API key, sign in to a CLI or start Ollama.',
  'También valdrían': 'These would also work',
  'Lo que contestó Laya': 'What Laya answered',
  'Medido con 70 tareas etiquetadas a mano: el tipo lo acierta en la mitad de los casos nuevos y la dificultad, a un punto, en 9 de cada 10. Por eso se junta con las reglas y puedes lanzar cualquier alternativa.':
    'Measured on 70 hand-labelled tasks: it gets the kind right in half of the unseen cases and the difficulty, within one point, in 9 out of 10. That is why it is combined with the rules and you can launch any alternative.',
  'Proyecto entero': 'Whole project',
  Razonar: 'Reasoning',
  Texto: 'Text',
  'Diseño visual': 'Visual design',
  'Tocar archivos': 'Touch files',
  'Mirar imágenes': 'Look at images',
  'Pensar con calma': 'Think it through',
  'Muy difícil': 'Very hard',
  'dificultad {d} de 5': 'difficulty {d} of 5',
  'dificultad {d} de 5 y Laya ve que hay que razonar ({p} %)': 'difficulty {d} of 5 and Laya sees it needs reasoning ({p} %)',
  'dificultad {d} de 5 y es de razonar': 'difficulty {d} of 5 and it is a reasoning task',
  'dificultad {d} de 5 y no hace falta pensar': 'difficulty {d} of 5 and no thinking needed',
  'Hay que trabajar con archivos y comandos: un agente de consola lo hace y gasta de tu plan, no de dinero.':
    'It needs files and commands: a command-line agent does that and spends from your plan, not money.',
  'Es sencilla: un modelo local la resuelve gratis y sin que el prompt salga del equipo.':
    'It is simple: a local model solves it for free and the prompt never leaves your computer.',
  'El más barato de tus modelos que llega al nivel que pide la tarea.': 'The cheapest of your models that reaches the level the task needs.',
  'Ninguna de tus opciones llega al nivel que pide: va la de más nivel que tienes.':
    'None of your options reaches the level it needs: going with your strongest one.',
  'Le queda un {n} % de {what}.': '{n} % of {what} left.',
  'Este no deja elegir el esfuerzo: va con el suyo.': 'This one does not let you choose the effort: it uses its own.',
  cupo: 'quota',
  'Laya (si no, el modelo local más pequeño)': 'Laya (otherwise the smallest local model)',
  'Laya, en tu equipo': 'Laya, on your computer',
  'Laya (instálalo en Modelos › Enrutador)': 'Laya (install it in Models › Router)',
  'Laya no está instalado': 'Laya is not installed',
  'Laya se está instalando': 'Laya is being installed',

  /* ------------------------------------------------ Panel organizable */
  Organizar: 'Arrange',
  'Ordenar, redimensionar y esconder recuadros': 'Reorder, resize and hide boxes',
  'Arrastra cada recuadro por su asa, cambia su tamaño desde la esquina o escóndelo. Se guarda solo.':
    'Drag each box by its handle, resize it from the corner or hide it. It saves itself.',
  Restablecer: 'Reset',
  'Vuelve al orden y los tamaños de siempre, con todo a la vista': 'Back to the default order and sizes, with everything visible',
  Listo: 'Done',
  'Escondidos:': 'Hidden:',
  '{title}: todavía sin datos': '{title}: no data yet',
  '{title}: arrastra para moverlo · con el teclado: ← →, y con Mayús cambia el tamaño':
    '{title}: drag to move it · with the keyboard: ← →, and with Shift to resize',
  'Mover {title}': 'Move {title}',
  'Esconder este recuadro': 'Hide this box',
  'Arrastra para cambiar ancho y alto · doble clic: tamaño por omisión': 'Drag to change width and height · double-click: default size',
  'Cambiar el tamaño de {title}': 'Resize {title}',
  'Gasto por día': 'Spend per day',
  'Tokens por día': 'Tokens per day',

  /* ------------------------------------------------ Cuentas */
  'Esta vez no contestó: es lo que se supo {when}.': 'It did not answer this time: this is what was known {when}.',
  'No contestó al preguntarle; vuelve a comprobarlo en un momento.': 'It did not answer; check again in a moment.',
  'Al abrirlo escribe /login y sigue los pasos; /logout para salir.': 'Open it, type /login and follow the steps; /logout to sign out.',
  'Al abrirlo elige «Qwen OAuth» (gratis con cuenta de qwen.ai); dentro, /auth cambia de cuenta.':
    'Open it and choose “Qwen OAuth” (free with a qwen.ai account); inside, /auth switches account.',
  'Hace falta para sus modelos en la nube; los locales van sin cuenta.': 'Needed for its cloud models; local models work without an account.',
  'Ollama está apagado: arráncalo para saber si hay sesión.': 'Ollama is not running: start it to know whether you are signed in.',
  'Pega la clave': 'Paste the key',
  'Conseguir clave': 'Get a key',
  'Pegar clave': 'Paste key',
  Cambiar: 'Change',
  'Todos los ajustes': 'All settings',
  '¿Autorizaste y el navegador no volvió a la app? Copia la dirección que se quedó en su barra (empieza por http://localhost) y pégala aquí.':
    'Authorized but the browser did not come back to the app? Copy the address left in its bar (it starts with http://localhost) and paste it here.',
  'No hay ningún inicio de sesión de OpenRouter en marcha': 'There is no OpenRouter sign-in in progress',
  'Eso no parece un código de OpenRouter': 'That does not look like an OpenRouter code',
  'Este inicio de sesión ya terminó': 'This sign-in has already finished',
  'No se pudo guardar': 'Could not save',
  'Lo instala y, al terminar, abre su inicio de sesión en la misma terminal': 'Installs it and, when done, opens its sign-in in the same terminal',
  'Hay que instalarlo antes: te llevo a cómo hacerlo': 'It has to be installed first: I will take you to how',
  'Instala {name} primero; después podrás iniciar sesión desde aquí.': 'Install {name} first; then you can sign in from here.'
}
