/**
 * English strings for everything added in 0.8.
 *
 * Kept apart from i18n.en.ts only so the new screens can be reviewed in one
 * place; it is merged into the same dictionary and works exactly the same way
 * (Spanish source text as the key, dotted keys for interpolation).
 */
export const enV08: Record<string, string> = {
  /* ------------------------------------------------ Historial y datos */
  'Detalle completo del histórico (días)': 'Full history detail (days)',
  'Pasado ese tiempo, cada ejecución se queda con sus métricas y pierde el paso a paso y la respuesta entera. 0: nunca.':
    'After that, each run keeps its metrics and drops the step-by-step and the full response. 0: never.',
  'Compactar ahora': 'Compact now',
  'No se pudo compactar el histórico': 'Could not compact the history',
  'Histórico compactado: {n} ejecuciones, de {from} a {to}': 'History compacted: {n} runs, from {from} to {to}',
  'No había nada que compactar ({size})': 'Nothing to compact ({size})',
  'Desde siempre': 'All time',
  Hoy: 'Today',
  'Últimos 7 días': 'Last 7 days',
  'Últimos 30 días': 'Last 30 days',
  'Este mes': 'This month',
  'Últimos 90 días': 'Last 90 days',
  'Todo proyecto': 'Any project',

  /* ------------------------------------------ Continuidad de sesión */
  Continuidad: 'Continuity',
  'Seguir en la misma sesión del agente': "Keep the agent's own session",
  'Cada turno empieza de cero: el agente no recuerda los anteriores.':
    'Each turn starts from scratch: the agent does not remember earlier ones.',
  'Retoma la sesión {id}: recuerda lo que hizo en los turnos anteriores.':
    'Resumes session {id}: it remembers what it did in earlier turns.',
  'Al primer turno el agente abre su sesión; los siguientes la retoman.':
    'The agent opens its session on the first turn; the next ones resume it.',
  '{cmd} retoma la conversación que guarda en el proyecto.': '{cmd} resumes the conversation it keeps in the project.',
  '{cmd} no sabe retomar su sesión: se le pasa la conversación anterior dentro del prompt.':
    "{cmd} can't resume its session: the earlier conversation is passed inside the prompt.",
  'El próximo turno sigue desde aquí en una sesión nueva; la original queda como está':
    'The next turn continues from here in a new session; the original stays as it is',
  'Bifurcará al enviar': 'Will fork on send',
  Bifurcar: 'Fork',
  'El próximo turno abre una sesión nueva del agente': 'The next turn opens a new agent session',
  'Empezar de cero': 'Start over',

  /* --------------------------------------------------------- Relevo */
  Relevo: 'Handoff',
  'Seguir con otra IA': 'Continue with another AI',
  'Pasar este trabajo a otra IA con todo su contexto': 'Hand this work to another AI with all its context',
  'Parece que se ha agotado un cupo o un límite. Puedes seguir con otra IA sin perder lo hecho.':
    'It looks like a quota or limit ran out. You can continue with another AI without losing what was done.',
  'No se pudo preparar el relevo': 'Could not prepare the handoff',
  'Seguir con {name}': 'Continue with {name}',
  Seguir: 'Continue',
  'Leyendo la sesión y el repositorio…': 'Reading the session and the repository…',
  'Lo estaba haciendo': 'It was being done by',
  'otra IA': 'another AI',
  Tareas: 'Tasks',
  '{done} de {total} hechas': '{done} of {total} done',
  'no llevaba lista': 'no task list',
  'Sin confirmar': 'Uncommitted',
  '{n} ficheros nuevos': '{n} new files',
  nada: 'nothing',
  Conversación: 'Conversation',
  'últimos {n} mensajes': 'last {n} messages',
  'Esta sesión no dice en qué carpeta trabajaba: un agente de consola no puede seguirla, uno por API sí.':
    "This session doesn't say which folder it worked in: a CLI agent can't continue it, an API one can.",
  '{folder} no es uno de tus proyectos: se dará de alta al lanzarlo.':
    "{folder} isn't one of your projects: it will be added when you launch.",
  'Quién lo sigue': 'Who continues',
  'Agente de consola': 'CLI agent',
  'Modelo por API': 'API model',
  'No tienes agentes de consola': 'You have no CLI agents',
  'Trabaja como agente: lee, edita y ejecuta en el proyecto': 'Works as an agent: reads, edits and runs commands in the project',
  'El que tenga configurado; se puede cambiar después en la Consola.': 'Whatever it has configured; you can change it later in the Console.',
  'Qué quieres que haga ahora': 'What you want it to do now',
  'Opcional: si lo dejas vacío, termina lo pendiente y dice qué ha hecho.':
    'Optional: if left empty, it finishes what is pending and reports what it did.',
  'Incluir el diff sin confirmar (recortado: es largo)': 'Include the uncommitted diff (trimmed: it is long)',
  'Incluir el diff sin confirmar': 'Include the uncommitted diff',
  'Lo que recibirá': 'What it will receive',
  'Editado a mano: ya no se regenera.': 'Edited by hand: no longer regenerated.',
  'Se puede editar antes de lanzarlo.': 'You can edit it before launching.',

  /* ------------------------------------------------- Cupos: el Panel */
  'Cupos de tus IAs': 'Your AI quotas',
  'planes, saldos, límites y presupuestos de todas las IAs que usas': 'plans, balances, limits and budgets for every AI you use',
  'Volver a preguntar a todas las fuentes': 'Ask every source again',
  'Leyendo los cupos…': 'Reading quotas…',
  'Todavía no hay ningún cupo que enseñar. Aparecen en cuanto usas Claude Code, Codex, Gemini CLI u OpenCode Go, pones una clave con saldo o creas un presupuesto.':
    'No quotas to show yet. They appear as soon as you use Claude Code, Codex, Gemini CLI or OpenCode Go, add a key with a balance, or create a budget.',
  'Sin dato desde aquí': 'No data from here',
  'quedan {n}': '{n} left',
  '{n} peticiones': '{n} requests',
  Oficial: 'Official',
  Medido: 'Measured',
  Tuyo: 'Yours',
  'se repone en {at}': 'resets in {at}',
  'ventana móvil': 'rolling window',
  'en el tope': 'at the limit',
  'a este ritmo, tope a las {at}': 'at this pace, limit at {at}',
  'a este ritmo no llegas al tope antes de reponerse': "at this pace you won't hit the limit before it resets",
  'ritmo: {r}': 'pace: {r}',
  'dato de {ago}': 'data from {ago}',
  'Ver cupos': 'See quotas',
  '{pct} % gastado: {who}': '{pct}% used: {who}',
  'Sin cupo: {who}.': 'Out of quota: {who}.',
  'Sin cupo: {who}. Puedes seguir con {agent}: {reason}.': 'Out of quota: {who}. You can continue with {agent}: {reason}.',
  'le queda un {n} % en {where}': 'it has {n}% left on {where}',
  'no tiene ningún cupo conocido agotado': 'none of its known quotas has run out',
  'Con más margen: {name} (le queda un {n} % en {where}).': 'Most headroom: {name} ({n}% left on {where}).',
  'Con más margen: {name} (no tiene ningún cupo conocido agotado).': 'Most headroom: {name} (none of its known quotas has run out).',

  /* ------------------------------------- Cupos: nombres que manda main */
  'Ventana de 5 h': '5-hour window',
  Semana: 'Week',
  'Últimas 5 h': 'Last 5 h',
  'Gasto extra': 'Extra usage',
  Día: 'Day',
  Ventana: 'Window',
  'Peticiones de hoy': "Today's requests",
  'Peticiones (ritmo)': 'Requests (rate)',
  'Tokens (ritmo)': 'Tokens (rate)',
  'Tope de la clave': 'Key limit',
  'Tope de la clave (día)': 'Key limit (day)',
  'Tope de la clave (semana)': 'Key limit (week)',
  'Tope de la clave (mes)': 'Key limit (month)',
  Créditos: 'Credits',
  'Modelos gratis hoy': 'Free models today',
  Saldo: 'Balance',
  'Peticiones premium': 'Premium requests',
  Completados: 'Completions',
  'Gasto de la organización este mes': 'Organization spend this month',
  'Sin datos': 'No data',
  'Esta semana': 'This week',
  Presupuestos: 'Budgets',
  gratuito: 'free',
  Todo: 'All',
  'Proyecto borrado': 'Deleted project',
  'Agente borrado': 'Deleted agent',
  'Saldo insuficiente': 'Insufficient balance',
  'Sin saldo': 'No balance',
  'ChatGPT (web y app)': 'ChatGPT (web and app)',
  'Gemini (app y web)': 'Gemini (app and web)',

  /* ------------------------------------------- Cupos: de dónde sale */
  'El porcentaje que Claude Code enseña en su barra de estado.': 'The percentage Claude Code shows in its status line.',
  'Cuenta todo lo que gastas con tu cuenta: la app, las terminales, claude.ai y la app de Claude.':
    'It counts everything you use with your account: this app, terminals, claude.ai and the Claude app.',
  'Se actualiza mientras tengas una sesión interactiva abierta.': 'It updates while you have an interactive session open.',
  'Tokens gastados en esta máquina (la app y las terminales).': 'Tokens used on this machine (this app and terminals).',
  'La lectura de la barra de estado está activada, pero no hay dato vigente de esta ventana: llega al abrir una sesión interactiva de Claude Code.':
    'Status-line reading is on, but there is no current figure for this window yet: it arrives when you open an interactive Claude Code session.',
  'Claude no publica el tope: activa en Ajustes › Cupos la lectura de la barra de estado para ver el % oficial.':
    "Claude doesn't publish the limit: turn on status-line reading in Settings › Quotas to see the official %.",
  'Claude ha avisado de que te acercas al tope.': 'Claude has warned that you are close to the limit.',
  'Claude ha rechazado peticiones hasta que se reponga.': 'Claude is rejecting requests until it resets.',
  'El tope de gasto extra de tu organización, según la barra de estado de Claude Code.':
    "Your organization's extra-usage limit, according to Claude Code's status line.",
  'La ventana ya se ha repuesto: el dato nuevo llega con la próxima sesión de Codex.':
    'The window has already reset: the new figure arrives with your next Codex session.',
  'El porcentaje que Codex apunta en sus sesiones (~/.codex/sessions).': 'The percentage Codex records in its sessions (~/.codex/sessions).',
  'Incluye lo que gastes en Codex desde cualquier sitio con tu cuenta.': 'It includes Codex use from anywhere with your account.',
  'Peticiones al modelo contadas en las conversaciones de Gemini CLI desde la medianoche del Pacífico.':
    'Model requests counted in Gemini CLI conversations since midnight Pacific time.',
  'El tope es el diario que publica Google para tu plan.': 'The limit is the daily one Google publishes for your plan.',
  'No cuenta lo que gastes desde el IDE (Gemini Code Assist), que comparte cupo.':
    "It doesn't count IDE use (Gemini Code Assist), which shares the quota.",
  'Se supone el plan gratuito: si tienes Google AI Pro o Ultra, elígelo en Ajustes › Cupos.':
    'The free plan is assumed: if you have Google AI Pro or Ultra, pick it in Settings › Quotas.',
  'Con clave de API o Vertex el tope depende de tu nivel de pago, que no se puede leer: sólo se cuenta.':
    "With an API key or Vertex the limit depends on your paid tier, which can't be read: it is only counted.",
  'No se sabe con qué cuenta entras: elige tu plan en Ajustes › Cupos para medirlo.':
    "It isn't known which account you sign in with: pick your plan in Settings › Quotas to measure it.",
  'El coste que OpenCode apunta en su base de datos para los modelos del plan Go.':
    'The cost OpenCode records in its database for Go plan models.',
  'Los topes son los que publica OpenCode: 12 $ cada 5 h, 30 $ a la semana y 60 $ al mes.':
    'The limits are the ones OpenCode publishes: $12 every 5 h, $30 a week and $60 a month.',
  'Cuenta por horas enteras.': 'It counts in whole hours.',
  'Lo que dijo el proveedor en las cabeceras de su última respuesta.': 'What the provider said in the headers of its last response.',
  'Lo dice OpenRouter de tu clave (/api/v1/key).': 'OpenRouter reports it for your key (/api/v1/key).',
  'Créditos comprados y gastados según OpenRouter (/api/v1/credits).': 'Credits bought and used according to OpenRouter (/api/v1/credits).',
  'Peticiones de hoy (UTC) a modelos «:free» lanzadas desde la app.': "Today's requests (UTC) to “:free” models launched from this app.",
  'El tope es el que publica OpenRouter: 50 al día sin créditos comprados y 1.000 con 10 $ o más.':
    'The limit is the one OpenRouter publishes: 50 a day without purchased credits and 1,000 with $10 or more.',
  'Lo que hagas con la misma clave fuera de la app no se ve.': "What you do with the same key outside the app isn't visible.",
  'No se ha podido saber cuántos créditos has comprado, así que no se da tope.':
    "It couldn't be determined how many credits you bought, so no limit is given.",
  'Saldo de la cuenta según DeepSeek (/user/balance).': 'Account balance according to DeepSeek (/user/balance).',
  'Saldo disponible según Moonshot (/v1/users/me/balance).': 'Available balance according to Moonshot (/v1/users/me/balance).',
  'Lo dice GitHub de tu cuenta (copilot_internal/user).': 'GitHub reports it for your account (copilot_internal/user).',
  'Se consulta con gh: la app no ve tu token.': "It is queried through gh: the app never sees your token.",
  'Informe de costes de tu organización en Anthropic (clave de administrador).':
    "Your organization's cost report at Anthropic (admin key).",
  'Anthropic no publica por API ni tu saldo ni tu tope de gasto.': "Anthropic doesn't publish your balance or spend limit through its API.",
  'Costes de tu organización en OpenAI (clave de administrador).': "Your organization's costs at OpenAI (admin key).",
  'OpenAI no publica por API tu saldo de créditos.': "OpenAI doesn't publish your credit balance through its API.",
  'No se ha podido consultar.': "It couldn't be queried.",
  'Suma todo el coste, también lo estimado de los planes de suscripción.': 'It adds up all cost, including the estimate for subscription plans.',
  'Suma sólo lo que pagas por uso: llamadas a API y lo que OpenCode cobra de Zen o de tus claves.':
    'It only adds up what you pay per use: API calls and what OpenCode charges from Zen or your keys.',
  'Al llegar al 100 % no deja lanzar nada que cuente en él.': "At 100% it won't let you launch anything that counts toward it.",
  'Cursor sólo enseña tu uso con la sesión iniciada en su web.': 'Cursor only shows your usage when signed in on its website.',
  'El saldo de Zen sólo se ve en la consola web de OpenCode.': "Your Zen balance is only visible in OpenCode's web console.",
  'Codex todavía no ha apuntado tu cupo: aparece tras tu primera sesión con él.':
    "Codex hasn't recorded your quota yet: it appears after your first session with it.",
  'Los mensajes de ChatGPT tienen su propio límite y OpenAI no lo publica.': "ChatGPT messages have their own limit and OpenAI doesn't publish it.",
  'La app de Gemini no publica cuánto llevas; Gemini CLI sí se cuenta arriba.':
    "The Gemini app doesn't publish your usage; Gemini CLI is counted above.",
  'Actívalo en Ajustes › Cupos para preguntar a GitHub con tu sesión de gh.':
    'Turn it on in Settings › Quotas to ask GitHub using your gh session.',
  'Tu saldo de créditos no se puede leer por API. Con una clave de administrador se ve el gasto del mes de la organización.':
    "Your credit balance can't be read through the API. With an admin key you can see the organization's spend this month.",
  'Tu saldo de créditos no se puede leer por API. Con una clave de administrador se ve el gasto del mes.':
    "Your credit balance can't be read through the API. With an admin key you can see this month's spend.",
  'No publican el saldo por API. Sus límites de ritmo aparecen aquí tras la primera petición, si los mandan.':
    "They don't publish the balance through their API. Their rate limits appear here after the first request, if they send them.",
  'El statusLine de settings.json ya no es el de la app: no se ha tocado.':
    "The statusLine in settings.json is no longer the app's: it was left untouched.",

  /* ------------------------------------------ Cupos: ajustes */
  Cupos: 'Quotas',
  'Los presupuestos, con avisos y freno, están en': 'Budgets, with alerts and a hard stop, are in',
  'Porcentaje oficial del plan de Claude': "Official Claude plan percentage",
  'lo que Claude Code enseña en su barra de estado': 'what Claude Code shows in its status line',
  Activo: 'On',
  Apagado: 'Off',
  'Claude no publica el tope de tu plan por ningún otro sitio. Si lo activas, la app pone en Claude Code una barra de estado suya que guarda el porcentaje de la ventana de 5 h y de la semana, y después ejecuta la barra que ya tuvieras con la misma entrada: la tuya se sigue viendo igual.':
    "Claude doesn't publish your plan's limit anywhere else. If you turn this on, the app sets a status line of its own in Claude Code that saves the 5-hour and weekly percentages, then runs the status line you already had with the same input: yours keeps looking the same.",
  'Escribe en tu settings.json de Claude Code; antes guarda una copia en la carpeta de datos de la app.':
    "It writes to your Claude Code settings.json; a copy is saved in the app's data folder first.",
  'Al desactivarlo se deja como estaba. Si lo has cambiado después, no se toca.':
    "Turning it off puts it back as it was. If you changed it afterwards, it isn't touched.",
  'El dato sólo llega mientras tienes abierta una sesión interactiva de Claude Code.':
    'The figure only arrives while you have an interactive Claude Code session open.',
  'Aplicando…': 'Applying…',
  'Leer el porcentaje del plan de Claude': "Read the Claude plan percentage",
  'Tu barra de estado anterior se sigue ejecutando detrás.': 'Your previous status line still runs behind it.',
  'Ya tienes una barra de estado: al activarlo se encadena, no se pierde.': "You already have a status line: turning this on chains it, it isn't lost.",
  'Último dato: {ago}': 'Last figure: {ago}',
  'Todavía no ha llegado ningún dato.': 'No figure has arrived yet.',
  'No hay Git Bash: la barra se ejecuta con PowerShell.': 'Git Bash was not found: the status line runs with PowerShell.',
  'Lectura del plan de Claude activada': 'Claude plan reading turned on',
  'Lectura del plan de Claude desactivada': 'Claude plan reading turned off',
  'No se pudo cambiar': "Couldn't change it",
  'Fuentes de cupo': 'Quota sources',
  'de dónde sale cada dato': 'where each figure comes from',
  'Plan de Gemini CLI': 'Gemini CLI plan',
  'De él sale el tope diario de peticiones que publica Google': 'It sets the daily request limit Google publishes',
  'Automático (según cómo entras)': 'Automatic (by how you sign in)',
  'Gratuito con cuenta de Google (1.000 al día)': 'Free with a Google account (1,000 a day)',
  'Google AI Pro (1.500 al día)': 'Google AI Pro (1,500 a day)',
  'Google AI Ultra (2.000 al día)': 'Google AI Ultra (2,000 a day)',
  'Code Assist Standard (1.500 al día)': 'Code Assist Standard (1,500 a day)',
  'Code Assist Enterprise (2.000 al día)': 'Code Assist Enterprise (2,000 a day)',
  'No lo uso': "I don't use it",
  'Plan Go de OpenCode': 'OpenCode Go plan',
  'Mide su gasto contra 12 $ cada 5 h, 30 $ a la semana y 60 $ al mes': 'Measures its spend against $12 every 5 h, $30 a week and $60 a month',
  'Automático (si hay uso del plan Go)': 'Automatic (if there is Go plan usage)',
  'Lo tengo': 'I have it',
  'No lo tengo': "I don't have it",
  'Preguntar a GitHub por el cupo de Copilot': 'Ask GitHub for the Copilot quota',
  'Lo consulta gh con tu sesión (la app no ve el token). Usa una ruta interna de GitHub, la misma que la extensión de Copilot: si cambia, se dirá que no hay dato.':
    "gh queries it with your session (the app never sees the token). It uses an internal GitHub route, the same one the Copilot extension uses: if it changes, you'll be told there is no data.",
  'Consultar el saldo de las claves (OpenRouter, DeepSeek, Kimi)': 'Check key balances (OpenRouter, DeepSeek, Kimi)',
  'Cada clave va sólo a su proveedor, como mucho cada diez minutos.': 'Each key only goes to its own provider, at most every ten minutes.',
  'Avisos de cupo': 'Quota alerts',
  'para cualquier cupo o presupuesto con tope conocido': 'for any quota or budget with a known limit',
  'Avisar al cruzar los umbrales y al agotarse': 'Alert when crossing thresholds and when running out',
  'Umbrales (%)': 'Thresholds (%)',
  'Separados por comas. Al 100 % siempre se avisa.': 'Comma-separated. You are always alerted at 100%.',
  'avisan al 50, 80 y 95 % y, si quieres, frenan al llegar al tope': 'they alert at 50, 80 and 95% and, if you want, stop at the limit',
  Añadir: 'Add',
  'Por omisión sólo cuenta el dinero que pagas por uso: las llamadas a API desde la app y lo que OpenCode cobra de Zen o de tus claves. Lo de los planes de suscripción (Claude, ChatGPT, Gemini, Copilot) es lo que costaría a precio de API; márcalo si quieres sumarlo. Los periodos son de calendario en tu hora: el día desde las 00:00, la semana desde el lunes y el mes desde el día 1.':
    'By default only money you pay per use counts: API calls from the app and what OpenCode charges from Zen or your keys. Subscription plans (Claude, ChatGPT, Gemini, Copilot) show what they would cost at API prices; tick it if you want to include them. Periods follow your local calendar: the day from 00:00, the week from Monday and the month from the 1st.',
  'No tienes ningún presupuesto.': "You don't have any budget.",
  Sobre: 'Applies to',
  Cuál: 'Which',
  'Elige…': 'Choose…',
  Periodo: 'Period',
  Mes: 'Month',
  'Tope (USD)': 'Limit (USD)',
  'Frenar al llegar al tope': 'Stop at the limit',
  'Contar también lo estimado de los planes': 'Also count plan estimates',
  '{used} de {limit} en este periodo': '{used} of {limit} this period',
  'Elige sobre qué es: sin eso no cuenta nada.': "Choose what it applies to: without that nothing counts.",
  'Claves de administrador': 'Admin keys',
  'opcionales: el gasto del mes de tu organización en Anthropic y OpenAI': "optional: your organization's spend this month at Anthropic and OpenAI",
  'Ninguno de los dos publica por API tu saldo de créditos; con una clave de administrador se lee el informe de costes de la organización. Se guardan cifradas como las demás y sólo se usan para eso, contra la dirección oficial de cada uno.':
    "Neither publishes your credit balance through its API; with an admin key the organization's cost report is read. They are stored encrypted like the others and only used for that, against each one's official address.",
  'Clave de administrador guardada': 'Admin key saved',
  'Clave de administrador borrada': 'Admin key removed',
  'No se pudo guardar': "Couldn't save",
  'en el entorno ({env})': 'in the environment ({env})',
  opcional: 'optional',

  /* ------------------------------------ Modelos: calidad, comparador, favoritos */
  'Se comparan como mucho {n} modelos a la vez': 'You can compare up to {n} models at once',
  Favoritos: 'Favorites',
  'Índice de calidad de Artificial Analysis dividido por el precio mezclado (3 de entrada por 1 de salida)':
    'Artificial Analysis quality index divided by the blended price (3 input to 1 output)',
  'Calidad por dólar': 'Quality per dollar',
  Calidad: 'Quality',
  Código: 'Coding',
  '$ / M entrada': '$ / M input',
  '$ / M salida': '$ / M output',
  Capacidades: 'Capabilities',
  'Añadir al comparador': 'Add to comparison',
  'Quitar del comparador': 'Remove from comparison',
  'Quitar de favoritos': 'Remove from favorites',
  'Añadir a favoritos': 'Add to favorites',
  razona: 'reasoning',
  abierto: 'open',
  '{n} para comparar': '{n} to compare',
  Comparar: 'Compare',
  Vaciar: 'Clear',
  'salida estructurada': 'structured output',
  'pesos abiertos': 'open weights',
  adjuntos: 'attachments',
  'sabe hasta {date}': 'knows up to {date}',
  'Puntuaciones públicas': 'Public scores',
  Agéntico: 'Agentic',
  'Design Arena': 'Design Arena',
  'Índices de Artificial Analysis (0–100) y Elo de Design Arena, según OpenRouter.':
    'Artificial Analysis indices (0–100) and Design Arena Elo, as reported by OpenRouter.',
  'Con tu uso': 'From your usage',
  'Coste por ejecución': 'Cost per run',
  'Tu Elo en la Arena: {elo} ({wins} de {games} duelos ganados)': 'Your Arena Elo: {elo} ({wins} of {games} duels won)',
  'Calidad (AA)': 'Quality (AA)',
  'Código (AA)': 'Coding (AA)',
  'Agéntico (AA)': 'Agentic (AA)',
  Razona: 'Reasoning',
  Herramientas: 'Tools',
  'Salida estructurada': 'Structured output',
  'Pesos abiertos': 'Open weights',
  'Sabe hasta': 'Knowledge cutoff',
  'Tus ejecuciones': 'Your runs',
  'Tu latencia inicial': 'Your time to first token',
  'Tu velocidad': 'Your speed',
  'Coste medio por ejecución': 'Average cost per run',
  'Tus errores': 'Your errors',
  'Tu Elo (Arena)': 'Your Elo (Arena)',
  'Comparar modelos': 'Compare models',
  'Calidad, código y agéntico son los índices de Artificial Analysis que publica OpenRouter (0–100). Lo demás de abajo es tuyo: sale de tus ejecuciones y de los ganadores que marcas en la Arena.':
    'Quality, coding and agentic are the Artificial Analysis indices OpenRouter publishes (0–100). Everything below that is yours: it comes from your runs and the winners you pick in the Arena.',

  /* ------------------------------------------------ Arena: clasificación */
  'Tu clasificación': 'Your ranking',
  'Todavía no hay clasificación: sale de los ganadores que marcas en cada comparativa.':
    'No ranking yet: it comes from the winners you pick in each comparison.',
  Ganados: 'Won',
  'Elo por parejas: en cada comparativa con ganador, el ganador le gana a cada uno de los demás. Se empieza en 1500.':
    'Pairwise Elo: in each comparison with a winner, the winner beats each of the others. Everyone starts at 1500.',

  /* ------------------------------------------------ Panel: reparto */
  consola: 'CLI',
  Reparto: 'Breakdown',
  'en qué se va el gasto y quién trabaja más': 'where the spend goes and who works the most',
  'Ninguna ejecución de estos días va apuntada a un proyecto.': 'No run in this period is assigned to a project.',
  'Nada que repartir en estos días.': 'Nothing to break down in this period.',
  Errores: 'Errors',
  'y {n} más': 'and {n} more',
  '{n} resultados': '{n} results',
  imagen: 'image'
}
