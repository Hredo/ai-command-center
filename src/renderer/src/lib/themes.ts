/**
 * Temas visuales.
 *
 * Cada tema define dos cosas: los colores del armazón (fondos, líneas, texto)
 * y los del código. Están sacados de los temas que trae Visual Studio Code, con
 * los mismos valores de sus ficheros de color, para que la aplicación y el
 * editor que usas fuera se parezcan de verdad y no «por aproximación».
 *
 * Un tema es sólo datos: quien lo aplica es `prefs.tsx`, que escribe cada
 * entrada como variable CSS en el elemento raíz. Cambiar de tema no vuelve a
 * montar nada, sólo reescribe variables.
 */

export interface ThemeUi {
  /** Fondo más hondo: barra de título, barras laterales. */
  void: string
  /** Fondo de panel. */
  panel: string
  /** Superficie elevada: tarjetas, botones secundarios. */
  raised: string
  /** Elevada con el ratón encima. */
  hover: string
  /** Bordes visibles. */
  line: string
  /** Bordes apenas insinuados. */
  lineSoft: string
  /** Texto principal. */
  ink: string
  /** Texto secundario. */
  muted: string
  /** Texto apagado: pistas, unidades. */
  dim: string
  accent: string
  accentDim: string
  violet: string
  ok: string
  warn: string
  bad: string
  /** Fondo del área de código. */
  editorBg: string
  /** Franja de la línea del cursor. */
  editorActiveLine: string
  /** Selección dentro del editor. */
  editorSelection: string
  /** Guías de sangría. */
  editorGuide: string
  /** Números de línea. */
  editorGutter: string
}

export interface ThemeTokens {
  /** Comentarios. */
  com: string
  /** Palabras reservadas. */
  key: string
  /** Cadenas de texto. */
  str: string
  /** Números. */
  num: string
  /** Nombres de función. */
  fn: string
  /** Tipos y clases. */
  typ: string
  /** Literales: true, false, null. */
  lit: string
  /** Propiedades y campos. */
  prop: string
  /** Etiquetas de marcado. */
  tag: string
  /** Atributos de marcado. */
  attr: string
  /** Operadores y puntuación. */
  op: string
}

export interface Theme {
  id: string
  name: string
  /** Para decidir el esquema de color nativo de los controles del sistema. */
  dark: boolean
  ui: ThemeUi
  tokens: ThemeTokens
  /** Parejas de paréntesis coloreadas por profundidad, como en VS Code. */
  brackets: [string, string, string, string, string, string]
}

const VSCODE_BRACKETS: Theme['brackets'] = [
  '#ffd700', '#da70d6', '#179fff', '#ffd700', '#da70d6', '#179fff'
]
const LIGHT_BRACKETS: Theme['brackets'] = [
  '#0431fa', '#319331', '#7b3814', '#0431fa', '#319331', '#7b3814'
]

/* ------------------------------------------------------------------ *
 * Temas                                                              *
 * ------------------------------------------------------------------ */

export const THEMES: Theme[] = [
  {
    id: 'command',
    name: 'Command (original)',
    dark: true,
    ui: {
      void: '#08090d', panel: '#0f1117', raised: '#151824', hover: '#1b1f2d',
      line: '#1e2231', lineSoft: '#171a26',
      ink: '#e7eaf2', muted: '#8b93a7', dim: '#5b6377',
      accent: '#22d3ee', accentDim: '#0e7490', violet: '#a78bfa',
      ok: '#34d399', warn: '#f59e0b', bad: '#fb7185',
      editorBg: '#07080c', editorActiveLine: '#111623', editorSelection: '#24425c',
      editorGuide: '#313a52', editorGutter: '#3a4255'
    },
    tokens: {
      com: '#5a6379', key: '#c084fc', str: '#7fe0a1', num: '#f2b45c', fn: '#56b6ff',
      typ: '#5fe3d0', lit: '#ff9d6b', prop: '#8fd0ff', tag: '#ff7b93', attr: '#f2c55c',
      op: '#7c869c'
    },
    brackets: ['#22d3ee', '#a78bfa', '#f59e0b', '#34d399', '#fb7185', '#8fd0ff']
  },
  {
    id: 'dark-modern',
    name: 'Dark Modern',
    dark: true,
    ui: {
      void: '#181818', panel: '#1f1f1f', raised: '#2a2a2a', hover: '#333333',
      line: '#2b2b2b', lineSoft: '#242424',
      ink: '#cccccc', muted: '#9d9d9d', dim: '#6e7681',
      accent: '#0078d4', accentDim: '#004c87', violet: '#c586c0',
      ok: '#89d185', warn: '#cca700', bad: '#f14c4c',
      editorBg: '#1f1f1f', editorActiveLine: '#282828', editorSelection: '#264f78',
      editorGuide: '#404040', editorGutter: '#6e7681'
    },
    tokens: {
      com: '#6a9955', key: '#569cd6', str: '#ce9178', num: '#b5cea8', fn: '#dcdcaa',
      typ: '#4ec9b0', lit: '#569cd6', prop: '#9cdcfe', tag: '#569cd6', attr: '#9cdcfe',
      op: '#d4d4d4'
    },
    brackets: VSCODE_BRACKETS
  },
  {
    id: 'dark-plus',
    name: 'Dark+ (clásico)',
    dark: true,
    ui: {
      void: '#252526', panel: '#1e1e1e', raised: '#2d2d30', hover: '#37373d',
      line: '#3c3c3c', lineSoft: '#2b2b2b',
      ink: '#d4d4d4', muted: '#a0a0a0', dim: '#7f7f7f',
      accent: '#007acc', accentDim: '#005a9e', violet: '#c586c0',
      ok: '#89d185', warn: '#cca700', bad: '#f48771',
      editorBg: '#1e1e1e', editorActiveLine: '#282828', editorSelection: '#264f78',
      editorGuide: '#404040', editorGutter: '#858585'
    },
    tokens: {
      com: '#6a9955', key: '#569cd6', str: '#ce9178', num: '#b5cea8', fn: '#dcdcaa',
      typ: '#4ec9b0', lit: '#569cd6', prop: '#9cdcfe', tag: '#569cd6', attr: '#9cdcfe',
      op: '#d4d4d4'
    },
    brackets: VSCODE_BRACKETS
  },
  {
    id: 'one-dark-pro',
    name: 'One Dark Pro',
    dark: true,
    ui: {
      void: '#21252b', panel: '#282c34', raised: '#2c313a', hover: '#3a3f4b',
      line: '#3e4451', lineSoft: '#2f343e',
      ink: '#abb2bf', muted: '#8b92a0', dim: '#5c6370',
      accent: '#61afef', accentDim: '#3d6f96', violet: '#c678dd',
      ok: '#98c379', warn: '#e5c07b', bad: '#e06c75',
      editorBg: '#282c34', editorActiveLine: '#2c313c', editorSelection: '#3e4451',
      editorGuide: '#3b4048', editorGutter: '#636d83'
    },
    tokens: {
      com: '#5c6370', key: '#c678dd', str: '#98c379', num: '#d19a66', fn: '#61afef',
      typ: '#e5c07b', lit: '#d19a66', prop: '#e06c75', tag: '#e06c75', attr: '#d19a66',
      op: '#56b6c2'
    },
    brackets: ['#d19a66', '#c678dd', '#61afef', '#d19a66', '#c678dd', '#61afef']
  },
  {
    id: 'dracula',
    name: 'Dracula',
    dark: true,
    ui: {
      void: '#21222c', panel: '#282a36', raised: '#343746', hover: '#44475a',
      line: '#44475a', lineSoft: '#343746',
      ink: '#f8f8f2', muted: '#b0b3c4', dim: '#6272a4',
      accent: '#bd93f9', accentDim: '#6d4fa0', violet: '#ff79c6',
      ok: '#50fa7b', warn: '#f1fa8c', bad: '#ff5555',
      editorBg: '#282a36', editorActiveLine: '#31323f', editorSelection: '#44475a',
      editorGuide: '#3b3d51', editorGutter: '#6272a4'
    },
    tokens: {
      com: '#6272a4', key: '#ff79c6', str: '#f1fa8c', num: '#bd93f9', fn: '#50fa7b',
      typ: '#8be9fd', lit: '#bd93f9', prop: '#8be9fd', tag: '#ff79c6', attr: '#50fa7b',
      op: '#ff79c6'
    },
    brackets: ['#f8f8f2', '#ff79c6', '#8be9fd', '#50fa7b', '#bd93f9', '#ffb86c']
  },
  {
    id: 'monokai',
    name: 'Monokai',
    dark: true,
    ui: {
      void: '#1e1f1c', panel: '#272822', raised: '#32332c', hover: '#3e3d32',
      line: '#414339', lineSoft: '#32332c',
      ink: '#f8f8f2', muted: '#bcbcb4', dim: '#75715e',
      accent: '#66d9ef', accentDim: '#3b7f8c', violet: '#ae81ff',
      ok: '#a6e22e', warn: '#e6db74', bad: '#f92672',
      editorBg: '#272822', editorActiveLine: '#31322b', editorSelection: '#49483e',
      editorGuide: '#464741', editorGutter: '#90908a'
    },
    tokens: {
      com: '#75715e', key: '#f92672', str: '#e6db74', num: '#ae81ff', fn: '#a6e22e',
      typ: '#66d9ef', lit: '#ae81ff', prop: '#a6e22e', tag: '#f92672', attr: '#a6e22e',
      op: '#f92672'
    },
    brackets: ['#f8f8f2', '#f92672', '#66d9ef', '#a6e22e', '#ae81ff', '#e6db74']
  },
  {
    id: 'github-dark',
    name: 'GitHub Dark',
    dark: true,
    ui: {
      void: '#010409', panel: '#0d1117', raised: '#161b22', hover: '#21262d',
      line: '#30363d', lineSoft: '#21262d',
      ink: '#e6edf3', muted: '#8d96a0', dim: '#6e7681',
      accent: '#2f81f7', accentDim: '#1f6feb', violet: '#bc8cff',
      ok: '#3fb950', warn: '#d29922', bad: '#f85149',
      editorBg: '#0d1117', editorActiveLine: '#161b22', editorSelection: '#264f78',
      editorGuide: '#21262d', editorGutter: '#6e7681'
    },
    tokens: {
      com: '#8b949e', key: '#ff7b72', str: '#a5d6ff', num: '#79c0ff', fn: '#d2a8ff',
      typ: '#ffa657', lit: '#79c0ff', prop: '#79c0ff', tag: '#7ee787', attr: '#79c0ff',
      op: '#ff7b72'
    },
    brackets: ['#ffd700', '#da70d6', '#179fff', '#ffd700', '#da70d6', '#179fff']
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    dark: true,
    ui: {
      void: '#16161e', panel: '#1a1b26', raised: '#212333', hover: '#292e42',
      line: '#2f334d', lineSoft: '#222436',
      ink: '#c0caf5', muted: '#9aa5ce', dim: '#565f89',
      accent: '#7aa2f7', accentDim: '#3d59a1', violet: '#bb9af7',
      ok: '#9ece6a', warn: '#e0af68', bad: '#f7768e',
      editorBg: '#1a1b26', editorActiveLine: '#1f202e', editorSelection: '#283457',
      editorGuide: '#292e42', editorGutter: '#3b4261'
    },
    tokens: {
      com: '#565f89', key: '#bb9af7', str: '#9ece6a', num: '#ff9e64', fn: '#7aa2f7',
      typ: '#2ac3de', lit: '#ff9e64', prop: '#73daca', tag: '#f7768e', attr: '#bb9af7',
      op: '#89ddff'
    },
    brackets: ['#e0af68', '#bb9af7', '#7aa2f7', '#9ece6a', '#f7768e', '#2ac3de']
  },
  {
    id: 'nord',
    name: 'Nord',
    dark: true,
    ui: {
      void: '#2e3440', panel: '#3b4252', raised: '#434c5e', hover: '#4c566a',
      line: '#4c566a', lineSoft: '#434c5e',
      ink: '#eceff4', muted: '#d8dee9', dim: '#7b88a1',
      accent: '#88c0d0', accentDim: '#5e81ac', violet: '#b48ead',
      ok: '#a3be8c', warn: '#ebcb8b', bad: '#bf616a',
      editorBg: '#2e3440', editorActiveLine: '#3b4252', editorSelection: '#434c5e',
      editorGuide: '#434c5e', editorGutter: '#4c566a'
    },
    tokens: {
      com: '#616e88', key: '#81a1c1', str: '#a3be8c', num: '#b48ead', fn: '#88c0d0',
      typ: '#8fbcbb', lit: '#81a1c1', prop: '#d8dee9', tag: '#81a1c1', attr: '#8fbcbb',
      op: '#81a1c1'
    },
    brackets: ['#ebcb8b', '#b48ead', '#88c0d0', '#a3be8c', '#bf616a', '#8fbcbb']
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    dark: true,
    ui: {
      void: '#00212b', panel: '#002b36', raised: '#073642', hover: '#0b4553',
      line: '#0f4b5c', lineSoft: '#073642',
      ink: '#93a1a1', muted: '#839496', dim: '#586e75',
      accent: '#268bd2', accentDim: '#1a5f92', violet: '#6c71c4',
      ok: '#859900', warn: '#b58900', bad: '#dc322f',
      editorBg: '#002b36', editorActiveLine: '#073642', editorSelection: '#274642',
      editorGuide: '#0f4b5c', editorGutter: '#586e75'
    },
    tokens: {
      com: '#586e75', key: '#859900', str: '#2aa198', num: '#d33682', fn: '#268bd2',
      typ: '#b58900', lit: '#cb4b16', prop: '#268bd2', tag: '#268bd2', attr: '#93a1a1',
      op: '#859900'
    },
    brackets: ['#b58900', '#6c71c4', '#268bd2', '#859900', '#dc322f', '#2aa198']
  },
  {
    id: 'light-modern',
    name: 'Light Modern',
    dark: false,
    ui: {
      void: '#f8f8f8', panel: '#ffffff', raised: '#f3f3f3', hover: '#e8e8e8',
      line: '#e5e5e5', lineSoft: '#f0f0f0',
      ink: '#3b3b3b', muted: '#616161', dim: '#8b8b8b',
      accent: '#005fb8', accentDim: '#b8d4f0', violet: '#af00db',
      ok: '#1a7f37', warn: '#bf8803', bad: '#cd3131',
      editorBg: '#ffffff', editorActiveLine: '#f5f5f5', editorSelection: '#add6ff',
      editorGuide: '#d3d3d3', editorGutter: '#6e7681'
    },
    tokens: {
      com: '#008000', key: '#0000ff', str: '#a31515', num: '#098658', fn: '#795e26',
      typ: '#267f99', lit: '#0000ff', prop: '#001080', tag: '#800000', attr: '#e50000',
      op: '#000000'
    },
    brackets: LIGHT_BRACKETS
  },
  {
    id: 'github-light',
    name: 'GitHub Light',
    dark: false,
    ui: {
      void: '#f6f8fa', panel: '#ffffff', raised: '#f6f8fa', hover: '#eaeef2',
      line: '#d0d7de', lineSoft: '#eaeef2',
      ink: '#1f2328', muted: '#57606a', dim: '#8c959f',
      accent: '#0969da', accentDim: '#b6e3ff', violet: '#8250df',
      ok: '#1a7f37', warn: '#9a6700', bad: '#cf222e',
      editorBg: '#ffffff', editorActiveLine: '#f6f8fa', editorSelection: '#b6e3ff',
      editorGuide: '#d8dee4', editorGutter: '#8c959f'
    },
    tokens: {
      com: '#6e7781', key: '#cf222e', str: '#0a3069', num: '#0550ae', fn: '#8250df',
      typ: '#953800', lit: '#0550ae', prop: '#0550ae', tag: '#116329', attr: '#0550ae',
      op: '#cf222e'
    },
    brackets: LIGHT_BRACKETS
  },
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    dark: false,
    ui: {
      void: '#eee8d5', panel: '#fdf6e3', raised: '#eee8d5', hover: '#e4ddca',
      line: '#ddd6c1', lineSoft: '#eee8d5',
      ink: '#586e75', muted: '#657b83', dim: '#93a1a1',
      accent: '#268bd2', accentDim: '#a8d0e8', violet: '#6c71c4',
      ok: '#859900', warn: '#b58900', bad: '#dc322f',
      editorBg: '#fdf6e3', editorActiveLine: '#eee8d5', editorSelection: '#dfd8c2',
      editorGuide: '#ddd6c1', editorGutter: '#93a1a1'
    },
    tokens: {
      com: '#93a1a1', key: '#859900', str: '#2aa198', num: '#d33682', fn: '#268bd2',
      typ: '#b58900', lit: '#cb4b16', prop: '#268bd2', tag: '#268bd2', attr: '#586e75',
      op: '#859900'
    },
    brackets: LIGHT_BRACKETS
  },
  {
    id: 'high-contrast',
    name: 'Alto contraste',
    dark: true,
    ui: {
      void: '#000000', panel: '#000000', raised: '#0d0d0d', hover: '#1a1a1a',
      line: '#6fc3df', lineSoft: '#3a3a3a',
      ink: '#ffffff', muted: '#d4d4d4', dim: '#a0a0a0',
      accent: '#1aebff', accentDim: '#0a7d8c', violet: '#c586c0',
      ok: '#89d185', warn: '#ffd700', bad: '#f48771',
      editorBg: '#000000', editorActiveLine: '#1a1a1a', editorSelection: '#1a6496',
      editorGuide: '#6fc3df', editorGutter: '#c5c5c5'
    },
    tokens: {
      com: '#7ca668', key: '#569cd6', str: '#ce9178', num: '#b5cea8', fn: '#dcdcaa',
      typ: '#4ec9b0', lit: '#569cd6', prop: '#9cdcfe', tag: '#569cd6', attr: '#9cdcfe',
      op: '#ffffff'
    },
    brackets: VSCODE_BRACKETS
  }
]

export const DEFAULT_THEME = 'command'

export function themeById(id: string | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

/* ------------------------------------------------------------------ *
 * Tipografías                                                        *
 * ------------------------------------------------------------------ */

/**
 * Fuentes que se ofrecen en los ajustes. Sólo se listan las que vienen con
 * Windows o con las herramientas de desarrollo habituales: aquí no se descarga
 * nada de internet, así que una fuente que no esté instalada no se vería.
 */
export const CODE_FONTS: { value: string; label: string }[] = [
  { value: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace", label: 'Cascadia Code' },
  { value: "'Cascadia Mono', Consolas, monospace", label: 'Cascadia Mono' },
  { value: "'JetBrains Mono', 'Cascadia Mono', monospace", label: 'JetBrains Mono' },
  { value: "'Fira Code', 'Cascadia Mono', monospace", label: 'Fira Code' },
  { value: "'Source Code Pro', 'Cascadia Mono', monospace", label: 'Source Code Pro' },
  { value: "'IBM Plex Mono', 'Cascadia Mono', monospace", label: 'IBM Plex Mono' },
  { value: 'Consolas, monospace', label: 'Consolas' },
  { value: "'Courier New', monospace", label: 'Courier New' },
  { value: "'Lucida Console', monospace", label: 'Lucida Console' },
  { value: 'ui-monospace, monospace', label: 'La del sistema' }
]

export const UI_FONTS: { value: string; label: string }[] = [
  { value: "'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif", label: 'Segoe UI' },
  { value: "Inter, 'Segoe UI', system-ui, sans-serif", label: 'Inter' },
  { value: "'SF Pro Display', -apple-system, system-ui, sans-serif", label: 'SF Pro' },
  { value: "Roboto, 'Segoe UI', system-ui, sans-serif", label: 'Roboto' },
  { value: "'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif", label: 'IBM Plex Sans' },
  { value: 'system-ui, sans-serif', label: 'La del sistema' },
  { value: "'Cascadia Mono', Consolas, monospace", label: 'Monoespaciada' }
]

/** Acentos sugeridos; el selector de color admite cualquier otro. */
export const ACCENTS: { value: string; label: string }[] = [
  { value: '', label: 'El del tema' },
  { value: '#22d3ee', label: 'Cian' },
  { value: '#0078d4', label: 'Azul' },
  { value: '#7aa2f7', label: 'Índigo' },
  { value: '#a78bfa', label: 'Violeta' },
  { value: '#f472b6', label: 'Rosa' },
  { value: '#fb7185', label: 'Rojo' },
  { value: '#f59e0b', label: 'Ámbar' },
  { value: '#34d399', label: 'Verde' },
  { value: '#2dd4bf', label: 'Turquesa' }
]
