/**
 * Idioma de la interfaz.
 *
 * Un diccionario por idioma y una función `t(clave)` que lo consulta. No hay
 * librería: la aplicación tiene un puñado de pantallas y meter un motor de
 * traducción entero sólo añadiría peso de arranque.
 *
 * Hay dos formas de clave y conviven a propósito:
 *
 *  - **Clave con punto** (`nav.projects`, `editor.minimap`) para lo que se
 *    repite en varios sitios o lleva interpolación. Sale en los dos
 *    diccionarios.
 *  - **El propio texto en español** (`t('Guardar cambios')`) para todo lo
 *    demás, que es la mayor parte. Esto es lo que hace gettext desde siempre:
 *    la aplicación está escrita en español, así que el español ya es un
 *    identificador único y legible. En español la búsqueda falla y devuelve la
 *    clave, que es exactamente el texto que se quería; en inglés se busca en
 *    `en` y se encuentra la traducción.
 *
 * La consecuencia práctica es que no hay forma de que falte una cadena en
 * español ni de que un nombre de clave se cuele en la pantalla: lo peor que
 * puede pasar es que algo salga en español dentro de la interfaz en inglés, y
 * eso se ve y se arregla en un renglón.
 *
 * Interpolación: `t('x.y', { n: 3 })` sustituye `{n}` dentro del texto.
 */
import React, { createContext, useCallback, useContext, useMemo } from 'react'
import type { Language } from '@shared/types'
import { en } from './i18n.en'
import { setFormatLang } from './format'

type Dict = Record<string, string>

const es: Dict = {
  /* ---------------------------------------------------------- Genérico */
  'common.cancel': 'Cancelar',
  'common.save': 'Guardar',
  'common.create': 'Crear',
  'common.delete': 'Borrar',
  'common.close': 'Cerrar',
  'common.undo': 'Deshacer',
  'common.reload': 'Releer',
  'common.loading': 'Cargando…',
  'common.running': 'corriendo',
  'common.active': 'activos',
  'common.models': 'modelos',
  'common.month': 'mes',

  /* ------------------------------------------------------------- Menú */
  'nav.dashboard': 'Panel',
  'nav.chat': 'Consola',
  'nav.arena': 'Arena',
  'nav.terminal': 'Terminal',
  'nav.projects': 'Proyectos',
  'nav.agents': 'Agentes',
  'nav.models': 'Modelos',
  'nav.house': 'La Casa',
  'nav.history': 'Histórico',
  'nav.settings': 'Ajustes',
  'nav.busyHere': 'tareas en marcha aquí',
  'nav.collapse': 'Encoger el menú',
  'nav.expand': 'Desplegar el menú',

  /* -------------------------------------------------------- Barra sup. */
  'title.busy': '{chats} en la consola · {arena} en la arena · {terms} en terminales',

  /* ---------------------------------------------------------- Ajustes */
  'settings.title': 'Ajustes',
  'settings.subtitle': 'Proveedores, modelos locales, detección automática y preferencias',
  'settings.tab.providers': 'Proveedores',
  'settings.tab.local': 'Local',
  'settings.tab.detection': 'Detección',
  'settings.tab.appearance': 'Apariencia',
  'settings.tab.editor': 'Editor',
  'settings.tab.security': 'Seguridad',
  'settings.tab.prefs': 'Preferencias',
  'settings.rescan': 'Reescanear',

  /* -------------------------------------------------------- Apariencia */
  'appearance.title': 'Apariencia',
  'appearance.subtitle': 'Tema, tipografía y densidad de toda la aplicación',
  'appearance.theme': 'Tema',
  'appearance.theme.hint': 'Los mismos colores que los temas de Visual Studio Code',
  'appearance.accent': 'Color de acento',
  'appearance.accent.hint': 'Botones, enlaces y elementos seleccionados',
  'appearance.accent.custom': 'A medida',
  'appearance.uiFont': 'Tipografía de la interfaz',
  'appearance.uiFontSize': 'Tamaño del texto',
  'appearance.uiScale': 'Escala de la ventana',
  'appearance.uiFontSize.hint': 'Agranda o encoge todo hasta los bordes, como el nivel de zoom de VS Code',
  'appearance.density': 'Densidad',
  'appearance.density.compact': 'Compacta',
  'appearance.density.cozy': 'Normal',
  'appearance.density.comfortable': 'Amplia',
  'appearance.corners': 'Esquinas',
  'appearance.corners.sharp': 'Rectas',
  'appearance.corners.soft': 'Suaves',
  'appearance.corners.round': 'Redondas',
  'appearance.animations': 'Animaciones y transiciones',
  'appearance.animations.hint': 'Apagarlas quita pintados y va algo más suelto en equipos justos',
  'appearance.grid': 'Rejilla de fondo',
  'appearance.scrollbars': 'Barras de desplazamiento finas',
  'appearance.panelOpacity': 'Opacidad de los paneles',
  'appearance.language': 'Idioma',
  'appearance.language.hint': 'Cambia toda la interfaz al momento',
  'appearance.reset': 'Volver a los valores de fábrica',
  'appearance.resetDone': 'Apariencia restablecida',
  'appearance.panes': 'Tamaños de los paneles',
  'appearance.panes.hint': 'Los anchos y altos que hayas arrastrado con el ratón',
  'appearance.panes.reset': 'Devolver los paneles a su tamaño',
  'appearance.panes.count': '{n} paneles con tamaño propio',

  /* ------------------------------------------------------------ Editor */
  'editor.title': 'Editor de código',
  'editor.subtitle': 'Cómo se ve y se comporta el código dentro de la aplicación',
  'editor.font': 'Tipografía',
  'editor.fontSize': 'Tamaño',
  'editor.lineHeight': 'Interlineado',
  'editor.letterSpacing': 'Espaciado entre letras',
  'editor.ligatures': 'Ligaduras tipográficas',
  'editor.ligatures.hint': 'Une signos como => o !== si la fuente las trae',
  'editor.tabSize': 'Ancho del tabulador',
  'editor.insertSpaces': 'Tabular con espacios',
  'editor.wordWrap': 'Ajuste de línea',
  'editor.wordWrap.off': 'Sin ajustar',
  'editor.wordWrap.on': 'Al ancho del panel',
  'editor.wordWrap.bounded': 'A una columna fija',
  'editor.wrapColumn': 'Columna de corte',
  'editor.lineNumbers': 'Números de línea',
  'editor.lineNumbers.off': 'Ocultos',
  'editor.lineNumbers.on': 'Absolutos',
  'editor.lineNumbers.relative': 'Relativos',
  'editor.indentGuides': 'Guías de sangría',
  'editor.activeLine': 'Resaltar la línea del cursor',
  'editor.whitespace': 'Marcar espacios y tabuladores',
  'editor.brackets': 'Colorear parejas de paréntesis',
  'editor.minimap': 'Minimapa',
  'editor.ruler': 'Regla vertical',
  'editor.ruler.hint': 'Columna donde se pinta la línea guía. 0 la quita.',
  'editor.cursorStyle': 'Cursor',
  'editor.cursorStyle.line': 'Barra',
  'editor.cursorStyle.block': 'Bloque',
  'editor.cursorStyle.underline': 'Subrayado',
  'editor.cursorBlink': 'Cursor parpadeante',
  'editor.autoClose': 'Cerrar comillas y paréntesis solo',
  'editor.autoIndent': 'Mantener la sangría al pulsar Intro',
  'editor.scrollBeyond': 'Desplazar más allá de la última línea',
  'editor.syntaxTheme': 'Colores del código',
  'editor.syntaxTheme.hint': 'Por defecto usa los del tema de la aplicación',
  'editor.sameAsApp': 'Los del tema de la aplicación',
  'editor.preview': 'Así queda',
  'editor.reset': 'Volver a los valores de fábrica',
  'editor.resetDone': 'Editor restablecido',

  /* --------------------------------------------------------- Seguridad */
  'security.title': 'Seguridad',
  'security.subtitle': 'Qué protege la aplicación y qué puede tocar',
  'security.keys': 'Claves de API',
  // Cada sistema guarda las claves en su sitio: se elige con perOs().
  'security.keys.encrypted.win': 'Cifradas con las credenciales de Windows (DPAPI) en tu perfil. Nunca salen del equipo salvo hacia el propio proveedor.',
  'security.keys.encrypted.mac': 'Cifradas con el Llavero de macOS, ligado a tu usuario. Nunca salen del equipo salvo hacia el propio proveedor.',
  'security.keys.encrypted.linux': 'Cifradas con el llavero de tu sesión (GNOME Keyring o KWallet). Nunca salen del equipo salvo hacia el propio proveedor.',
  'security.keys.fallback.win': 'El cifrado del sistema no está disponible: las claves se guardan codificadas, no cifradas. Revisa el llavero de tu sesión de Windows.',
  'security.keys.fallback.mac': 'El Llavero de macOS no está disponible: las claves se guardan codificadas, no cifradas.',
  'security.keys.fallback.linux': 'Tu sesión no tiene llavero (GNOME Keyring o KWallet): las claves se guardan codificadas, no cifradas. Instala uno o pasa las claves por variables de entorno.',
  'security.sandbox': 'Aislamiento de la ventana',
  'security.csp': 'Política de contenido',
  'security.csp.on': 'Activa: la ventana sólo carga sus propios recursos y no puede pedir nada a internet.',
  'security.nav': 'Navegación bloqueada',
  'security.nav.on': 'La ventana no puede salir de la aplicación; los enlaces externos abren tu navegador.',
  'security.permissions': 'Permisos del navegador',
  'security.permissions.on': 'Cámara, micrófono, ubicación y notificaciones del motor web están denegados.',
  'security.files': 'Acceso a ficheros',
  'security.files.on': 'El explorador sólo lee y escribe dentro de la carpeta del proyecto abierto, enlaces simbólicos incluidos.',
  'security.git': 'Comandos de git',
  'security.git.on': 'Los comandos que reescriben historia o borran trabajo piden confirmación antes de ejecutarse.',
  'security.audit': 'Revisar ahora',
  'security.dataDir': 'Carpeta de datos',
  'security.ok': 'Correcto',
  'security.warn': 'Revisar',

  /* ----------------------------------------------------------- Ficheros */
  'files.filter': 'filtrar por nombre…',
  'files.newFile': 'Fichero nuevo',
  'files.newFolder': 'Carpeta nueva',
  'ollama.vram': '{gb} GB de VRAM',
  'ollama.unified': '{gb} GB de memoria unificada para la GPU (aprox.)',
  'ollama.noGpuUse': 'Ollama no usa esta gráfica en los Mac con Intel',
  'files.reveal.win': 'Mostrar en el explorador',
  'files.reveal.mac': 'Mostrar en el Finder',
  'files.reveal.linux': 'Mostrar en su carpeta',
  'files.trash.win': 'Mandar a la papelera',
  'files.trash.mac': 'Mandar a la papelera',
  'files.trash.linux': 'Mandar a la papelera',
  'files.reading': 'Leyendo la carpeta…',
  'files.pick': 'Elige un fichero',
  'files.pick.hint': 'El árbol de la izquierda abre las carpetas a demanda. Las pesadas, como node_modules, sólo se leen si las abres tú.',
  'files.heavy': 'pesada',
  'files.unsaved': 'sin guardar',
  'files.truncated': 'recortado: no se puede guardar',
  'files.opening': 'Abriendo…',
  'files.binary': 'Fichero binario: {size}',
  'files.binary.hint': 'No se muestra su contenido porque no es texto. Puedes abrirlo con el programa que le corresponda.',
  'files.lines': '{n} líneas',
  'files.saved': 'Guardado {path}',
  'files.trashed': 'A la papelera: {path}',
  'files.createIn': 'Se crea en',
  'files.rootFolder': '(raíz del proyecto)',
  'files.trashExplain': '{path} va a la papelera del sistema, así que se puede recuperar desde ahí.',
  'files.conflict': 'el fichero cambió en disco desde que lo abriste: recárgalo y vuelve a aplicar tus cambios',
  'files.noRead': 'no se pudo leer',
  'files.noWrite': 'no se pudo guardar',
  'files.noCreate': 'no se pudo crear',
  'files.noDelete': 'no se pudo borrar',

  /* ------------------------------------------------------------- Panel */
  'dash.costByDay': 'Gasto por día',
  'dash.costByDay.hint': 'coste acumulado de todas las ejecuciones',
  'dash.tokensByDay': 'Tokens por día',
  'dash.tokensByDay.hint': 'entrada frente a salida',
  'dash.cost': 'coste',
  'dash.in': 'entrada',
  'dash.out': 'salida',

  /* -------------------------------------------------------- Respuestas */
  'md.copy': 'Copiar',
  'md.copied': 'Copiado',

  /* ------------------------------------------ Textos con datos dentro */
  'activity.errors': '{n} con error',
  'agents.imported': '{added} agentes añadidos de {found} encontrados',
  'agents.nothingNew': 'Sin novedades: los {found} agentes encontrados ya estaban dados de alta',
  'chat.deleteExplain':
    'Se borra «{title}» y su conversación. Las ejecuciones que hizo siguen en el Histórico con sus métricas: eso no se toca.',
  'ctx.used': '{used} de {limit} tokens de contexto',
  'ctx.fits': 'te caben {n} tokens más en esta conversación',
  'dash.lastDays': 'Todo lo que ha pasado por aquí en los últimos {n} días',
  'files.onlyRead': '{n} sólo leídos',
  'gh.bigRepo': 'Ocupa unos {mb} MB: puede tardar un rato.',
  'git.abortDetail': 'Se deshace el {op} y el repositorio vuelve a como estaba antes de empezarlo.',
  'git.conflictFiles': '{n} fichero(s) en conflicto',
  'git.conflicts': 'En conflicto ({n}). Arregla las marcas, prepáralos y continúa:',
  'git.counts': '{staged} en el índice · {dirty} sin añadir · {untracked} nuevos',
  'git.deleteBranch': 'Borrar la rama {name}',
  'git.mergeInto': 'Merge en {branch}',
  'git.pullN': 'Traer los {n} commits de {from}',
  'git.rebaseDetail':
    'Reescribe los commits de {from} para que salgan de {onto}. Cambian sus hashes: si esta rama ya está subida, el push siguiente tendrá que ser forzado.',
  'git.rebaseOnto': 'Rebase sobre {ref}',
  'git.stashed': '{n} en stash',
  'git.uncommitted': '{n} sin confirmar',
  'git.untrackedNote': '{n} de ellos son nuevos y git todavía no los sigue.',
  'history.summary': '{total} ejecuciones registradas · {tokens} tokens · {cost} en lo mostrado',
  'house.living': '{n} viviendo aquí',
  'house.visiting': '{n} de visita',
  'models.showing600': 'Mostrando 600 de {total}. Afina la búsqueda para ver el resto.',
  'ollama.computedWith': 'Calculado con {vram} GB de VRAM y {ram} GB de RAM',
  'ollama.computedWithUnified': 'Calculado con {vram} GB de memoria para la GPU, de los {ram} GB que comparte con el sistema',
  'ollama.deleteExplain': 'Se borra {name} del disco y se liberan {size}.',
  'ollama.installed': '{n} modelos · {size} en disco',
  'ollama.notResponding':
    'El servidor no responde en {url}. Pulsa «Arrancar» y la app lo levanta y lo detecta sola.',
  'proj.agentDone': '{name} terminó en {time}',
  'proj.removeExplain': 'Se quitará {name} de la lista de proyectos. La carpeta',
  'proj.shellFailed': 'No se pudo abrir una shell en {name}',
  'proj.shellOpening': 'Abriendo una shell en {name}…',
  'prov.keyRemoved': 'Key de {name} eliminada',
  'prov.keySaved': 'Key de {name} guardada y cifrada',
  'stats.cached': '{n} en caché',
  'stats.reasoning': '{n} razonando',
  'term.exitCode': 'código {code}',
  'term.lastCommand': 'último comando: código',
  'term.showingLast': 'Mostrando las últimas {n} de {total} líneas · ver todo',
  'usage.accordingTo': 'según {source}',
  'usage.left': 'te queda {parts}',
  'usage.limitOf': 'Límite de uso · {source}',
  'usage.reread': '{n} releídos de caché',
  'usage.resets': ', repone {at}',
  'usage.restartsIn': 'se reinicia en {at}',
  'usage.weekly': '{messages} mensajes en {sessions} sesiones',

  'ago.minutes': 'hace {n} min',
  'ago.hours': 'hace {n} h',
  'until.seconds': 'en {n} s',
  'until.minutes': 'en {n} min',
  'until.hours': 'en {n} h',
  'usage.retryIn': 'reintenta en {n} s',
  'usage.resetsShort': 'repone {at}',
  'prov.readyOf': '{ready} listos de {total}',
  'detect.lastScan': 'Último escaneo {when}',

  'touch.times': '{what} {n} veces',

  /* ------------------------------------------------------------ Paneles */
  'pane.resize': 'Arrastra para cambiar el tamaño; doble clic lo devuelve al de fábrica',

  /* Textos que se colaban sin traducir */
  'dash.today': '{n} hoy',
  'dash.thisMonth': '{cost} este mes',
  'dash.inFlight': '{n} en curso',
  'dash.errorRate': '{pct} de errores',
  'dash.providersReady': '{ready} de {total} listos · {models} modelos disponibles',
  'usage.fiveHourSince': 'ventana de 5 h (desde las {from})',
  'files.changedOne': '1 archivo cambiado',
  'files.changedMany': '{n} archivos cambiados',
  'chat.turnOne': '1 turno',
  'chat.turns': '{n} turnos',
  'chat.effortBadge': 'esfuerzo {level}',
  'chat.noEffort': '{agent} no tiene opción de esfuerzo',
  'chat.instructionFor': 'Instrucción para {name}…',
  'chat.promptFor': 'Prompt para {model}…',
  'chat.passedTo': 'Se le pasa a {command} al lanzarlo',
  'common.chars': '{n} caracteres',
  'activity.thinking': '{n} pensando',
  'activity.inOneFile': 'en 1 archivo',
  'activity.inFiles': 'en {n} archivos',
  'arena.history': 'Comparativas ({n})',
  'arena.results': 'Comparativa · {n} resultados',
  'graph.pushAhead': 'Subir tus {n} commits',
  'house.onTheWay': 'de camino a {place}',
  'house.sweeping': 'barriendo {place}'
}

const DICTS: Record<Language, Dict> = { es, en }

export type Translate = (key: string, vars?: Record<string, string | number>) => string

interface I18n {
  lang: Language
  t: Translate
}

const Ctx = createContext<I18n>({ lang: 'es', t: (k) => es[k] ?? k })

export function useT(): Translate {
  return useContext(Ctx).t
}

export function useLang(): Language {
  return useContext(Ctx).lang
}

export function I18nProvider({
  lang,
  children
}: {
  lang: Language
  children: React.ReactNode
}): React.JSX.Element {
  // Las fechas relativas y los precios se formatean fuera de React: se les
  // avisa del idioma antes de que los hijos se pinten.
  setFormatLang(lang)

  const t = useCallback<Translate>(
    (key, vars) => {
      const raw = DICTS[lang]?.[key] ?? es[key] ?? key
      if (!vars) return raw
      return raw.replace(/\{(\w+)\}/g, (m, name) => String(vars[name] ?? m))
    },
    [lang]
  )

  const value = useMemo(() => ({ lang, t }), [lang, t])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const LANGUAGES: { id: Language; label: string; native: string }[] = [
  { id: 'es', label: 'Español', native: 'Español' },
  { id: 'en', label: 'Inglés / English', native: 'English' }
]
