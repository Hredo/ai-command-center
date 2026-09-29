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
  'Se puede editar antes de lanzarlo.': 'You can edit it before launching.'
}
