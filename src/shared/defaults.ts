/**
 * Valores de fábrica de la personalización.
 *
 * Viven aquí, en el código compartido, porque los usan los dos lados: el
 * proceso principal para rellenar una configuración vieja o recién creada, y la
 * ventana para el botón de «volver a los valores de fábrica». Tenerlos escritos
 * dos veces era la forma segura de que acabaran diciendo cosas distintas.
 */
import type { Appearance, EditorPrefs } from './types'

export const DEFAULT_APPEARANCE: Appearance = {
  theme: 'command',
  accent: '',
  uiFont: "'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif",
  uiFontSize: 13.5,
  uiScale: 100,
  density: 'cozy',
  corners: 'soft',
  animations: true,
  backgroundGrid: true,
  slimScrollbars: false,
  panelOpacity: 1
}

export const DEFAULT_EDITOR: EditorPrefs = {
  fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
  fontSize: 12,
  lineHeight: 1.55,
  letterSpacing: 0,
  ligatures: true,
  tabSize: 2,
  insertSpaces: true,
  wordWrap: 'off',
  wrapColumn: 100,
  lineNumbers: 'on',
  indentGuides: true,
  highlightActiveLine: true,
  renderWhitespace: false,
  bracketPairColorization: true,
  minimap: false,
  rulerColumn: 0,
  cursorStyle: 'line',
  cursorBlink: true,
  autoClosingBrackets: true,
  autoIndent: true,
  scrollBeyondLastLine: false,
  syntaxTheme: ''
}

/** Tamaño de fábrica de cada panel arrastrable, en píxeles. */
export const DEFAULT_PANES: Record<string, number> = {
  'nav.width': 184,
  'chat.sessions': 228,
  'chat.detail': 288,
  'projects.list': 248,
  'files.tree': 280,
  'graph.detail': 300,
  'house.panel': 292,
  'arena.column': 320,
  'history.detail': 720
}

/** Límites de arrastre: por debajo o por encima el panel deja de tener sentido. */
export const PANE_LIMITS: Record<string, { min: number; max: number }> = {
  'nav.width': { min: 56, max: 360 },
  'chat.sessions': { min: 150, max: 460 },
  'chat.detail': { min: 200, max: 560 },
  'projects.list': { min: 160, max: 480 },
  'files.tree': { min: 150, max: 620 },
  'graph.detail': { min: 200, max: 620 },
  'house.panel': { min: 180, max: 560 },
  'arena.column': { min: 220, max: 900 },
  'history.detail': { min: 420, max: 1400 }
}

/**
 * Alto de la barra de título, en píxeles. Lo comparten la franja que pinta la
 * ventana y la superposición nativa de los botones de Windows: si dejan de
 * coincidir, los botones quedan a media altura.
 */
export const TITLEBAR_HEIGHT = 38
