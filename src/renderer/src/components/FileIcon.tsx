/**
 * Iconos de ficheros y carpetas.
 *
 * La idea es la de los temas de iconos de VS Code —el tuyo es Material Icon
 * Theme—: que el árbol se lea de un vistazo por color y forma, sin tener que
 * ir leyendo extensiones. Cada familia de lenguaje tiene su glifo y su color, y
 * las carpetas con nombre conocido (`src`, `node_modules`, `.git`, `docs`…)
 * llevan una marca dentro.
 *
 * Están dibujados aquí, no importados del tema de VS Code: son unas decenas de
 * formas sencillas y así la aplicación no arrastra mil doscientos ficheros SVG
 * de un tercero ni depende de que tengas la extensión instalada.
 *
 * Los iconos de letras se pintan con `<text>` a propósito. Trazar cada letra
 * como camino sería más «puro» y ocuparía diez veces más; el navegador dibuja
 * texto muy bien y a 16 píxeles no se nota la diferencia.
 */
import React from 'react'

/* ------------------------------------------------------------------ *
 * Paleta                                                             *
 * ------------------------------------------------------------------ */

const C = {
  ts: '#3178c6',
  js: '#ffca28',
  react: '#61dafb',
  vue: '#41b883',
  svelte: '#ff3e00',
  angular: '#dd0031',
  py: '#3c78aa',
  go: '#00acd7',
  rust: '#e57324',
  java: '#ea4335',
  kotlin: '#a97bff',
  swift: '#fa7343',
  php: '#7986cb',
  ruby: '#e53935',
  c: '#0277bd',
  cpp: '#0277bd',
  cs: '#68217a',
  dart: '#40c4ff',
  lua: '#42a5f5',
  r: '#276dc3',
  scala: '#dd2c00',
  elixir: '#8e44ad',
  haskell: '#8f4e8b',
  json: '#f5b301',
  yaml: '#ff5252',
  toml: '#9c9c9c',
  xml: '#ff8f00',
  html: '#e44d26',
  css: '#42a5f5',
  sass: '#cf649a',
  tailwind: '#38bdf8',
  md: '#42a5f5',
  txt: '#90a4ae',
  shell: '#89e051',
  powershell: '#5391fe',
  docker: '#0db7ed',
  git: '#f14e32',
  npm: '#cb3837',
  lock: '#e8a33d',
  env: '#fdd835',
  image: '#26a69a',
  video: '#fd6a6a',
  audio: '#c792ea',
  font: '#f06292',
  pdf: '#f44336',
  zip: '#afb42b',
  db: '#f9a825',
  sql: '#ff8f00',
  test: '#66bb6a',
  config: '#90a4ae',
  key: '#ffd54f',
  license: '#d4af37',
  readme: '#42a5f5',
  binary: '#78909c',
  log: '#8bc34a',
  csv: '#43a047',
  ignore: '#9e9e9e',
  file: '#8b93a7'
} as const

const FOLDER = {
  base: '#7a8194',
  src: '#42a5f5',
  dist: '#66bb6a',
  modules: '#8bc34a',
  git: '#f14e32',
  github: '#90a4ae',
  vscode: '#2196f3',
  docs: '#26a69a',
  test: '#66bb6a',
  config: '#ffb74d',
  assets: '#ff7043',
  images: '#26a69a',
  public: '#4dd0e1',
  api: '#f06292',
  components: '#26c6da',
  hooks: '#c792ea',
  utils: '#9ccc65',
  scripts: '#ffca28',
  models: '#ab47bc',
  server: '#5c6bc0',
  app: '#ef5350',
  styles: '#42a5f5',
  tools: '#78909c',
  brand: '#ec407a',
  venv: '#66bb6a',
  cache: '#8d6e63',
  build: '#8d6e63',
  db: '#f9a825',
  security: '#ffa726',
  locale: '#4db6ac'
} as const

/* ------------------------------------------------------------------ *
 * Glifos                                                             *
 * ------------------------------------------------------------------ */

type Glyph = (color: string) => React.JSX.Element

/** Cuadrado con dos o tres letras: la forma clásica de TS, JS, C#… */
function letters(text: string, opts: { fg?: string; size?: number } = {}): Glyph {
  return (color) => (
    <>
      <rect x="1" y="1" width="14" height="14" rx="2.5" fill={color} />
      <text
        x="8"
        y="8"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={opts.size ?? (text.length > 2 ? 5.6 : 7)}
        fontWeight="700"
        fontFamily="var(--font-sans)"
        fill={opts.fg ?? '#ffffff'}
        letterSpacing="-0.3"
      >
        {text}
      </text>
    </>
  )
}

/** Hoja de papel con la esquina doblada: la base de casi todo lo demás. */
const sheet = (color: string, opacity = 1): React.JSX.Element => (
  <path
    d="M3.5 1.6h5.4l3.6 3.6v9.2a.6.6 0 0 1-.6.6H3.5a.6.6 0 0 1-.6-.6V2.2a.6.6 0 0 1 .6-.6Z"
    fill={color}
    fillOpacity={opacity}
  />
)

const fold = (
  <path d="M8.9 1.6 12.5 5.2H9.5a.6.6 0 0 1-.6-.6V1.6Z" fill="#000" fillOpacity="0.25" />
)

const GLYPHS: Record<string, Glyph> = {
  ts: letters('TS'),
  tsx: letters('TSX', { size: 4.8 }),
  js: letters('JS', { fg: '#20232a' }),
  jsx: letters('JSX', { fg: '#20232a', size: 4.8 }),
  cs: letters('C#'),
  cpp: letters('C++', { size: 5 }),
  c: letters('C'),
  go: letters('GO', { fg: '#0b2e35' }),
  php: letters('php', { size: 5.2 }),
  r: letters('R'),
  md: letters('M↓', { size: 6 }),
  sql: letters('SQL', { size: 4.8, fg: '#3b2400' }),
  env: letters('ENV', { size: 4.6, fg: '#3b3200' }),

  /* React: el átomo. */
  react: (color) => (
    <>
      <circle cx="8" cy="8" r="1.6" fill={color} />
      <g stroke={color} strokeWidth="0.95" fill="none">
        <ellipse cx="8" cy="8" rx="6.6" ry="2.6" />
        <ellipse cx="8" cy="8" rx="6.6" ry="2.6" transform="rotate(60 8 8)" />
        <ellipse cx="8" cy="8" rx="6.6" ry="2.6" transform="rotate(120 8 8)" />
      </g>
    </>
  ),

  /* Vue y Svelte: la uve y la chispa. */
  vue: (color) => (
    <>
      <path d="M1 2.6h3l4 6.9 4-6.9h3L8 14.4Z" fill={color} />
      <path d="M4.6 2.6h2.2L8 4.7l1.2-2.1h2.2L8 8.3Z" fill="#35495e" />
    </>
  ),
  svelte: (color) => (
    <path
      d="M11.6 2.3c-1.7-1.1-4-.7-5.2 1L3.6 7.1c-.9 1.3-.5 3.1.8 4 .5.3 1 .5 1.6.5-.2.5-.2 1.1 0 1.6.2.8.7 1.4 1.4 1.8 1.7 1.1 4 .7 5.2-1l2.8-3.8c.9-1.3.5-3.1-.8-4-.5-.3-1-.5-1.6-.5.2-.5.2-1.1 0-1.6a2.7 2.7 0 0 0-1.4-1.8Z"
      fill={color}
    />
  ),
  angular: (color) => (
    <>
      <path d="M8 1 1.8 3.2l.9 8.2L8 15l5.3-3.6.9-8.2Z" fill={color} />
      <path d="M8 3.3 4.5 11.4h1.4l.7-1.8h2.8l.7 1.8h1.4Zm0 2.3 1 2.6H7Z" fill="#fff" />
    </>
  ),

  /* Python: los dos cuerpos entrelazados, simplificados. */
  py: (color) => (
    <>
      <path
        d="M7.9 1.1c-1.5 0-2.9.2-3 1.6v1.6h3.1v.5H3.3c-1 0-1.9.7-2.2 1.9-.3 1.4-.3 2.3 0 3.7.3 1.1 1 1.9 2 1.9h1V10.4c0-1.2 1-2.2 2.2-2.2h3c1 0 1.8-.8 1.8-1.8V2.7c0-1-.8-1.5-1.8-1.6Zm-1.7 1c.3 0 .6.3.6.6a.6.6 0 0 1-.6.6.6.6 0 0 1-.6-.6c0-.3.3-.6.6-.6Z"
        fill={color}
      />
      <path
        d="M11.9 4.8V6.3c0 1.2-1.1 2.3-2.3 2.3h-3c-1 0-1.8.8-1.8 1.8v3.2c0 1 .8 1.5 1.8 1.7 1.1.3 2.2.4 3.5 0 .9-.3 1.8-.8 1.8-1.7v-1.3H8.8v-.5h4.4c1 0 1.4-.7 1.8-1.9.4-1.2.4-2.3 0-3.7-.3-1.1-.8-1.4-1.8-1.4Zm-2 7.9c.4 0 .6.3.6.6a.6.6 0 0 1-.6.6.6.6 0 0 1-.6-.6c0-.3.2-.6.6-.6Z"
        fill="#ffd43b"
      />
    </>
  ),

  /* Rust: el engranaje con la R. */
  rust: (color) => (
    <>
      <path
        d="M8 .9 9.3 2.3l1.8-.6.6 1.8 1.9.3-.3 1.9 1.4 1.3-1.4 1.3.3 1.9-1.9.3-.6 1.8-1.8-.6L8 13.5 6.7 12.1l-1.8.6-.6-1.8-1.9-.3.3-1.9L1.3 7.4l1.4-1.3-.3-1.9 1.9-.3.6-1.8 1.8.6Z"
        fill={color}
      />
      <text x="8" y="7.6" textAnchor="middle" dominantBaseline="central" fontSize="6" fontWeight="700" fontFamily="var(--font-sans)" fill="#fff">R</text>
    </>
  ),

  /* Java y Kotlin. */
  java: (color) => (
    <>
      <path d="M6.4 7.6s-.9.6.6.8c1.8.2 2.7.2 4.7-.2 0 0 .5.3 1.2.6-4.4 1.9-10-.1-6.5-1.2Z" fill={color} />
      <path d="M5.8 5.2s-1 .8.5 1c1.9.2 3.4.2 6.1-.3 0 0 .4.4.9.6-5.3 1.6-11.2.1-7.5-1.3Z" fill={color} />
      <path d="M9.6 1S11.3 2.7 8 5.3c-2.7 2.1-.6 3.3 0 4.7-1.6-1.4-2.7-2.7-1.9-3.9C7.2 4.3 10.2 3.5 9.6 1Z" fill={color} />
      <path d="M4.6 11.3c-1.4.4.9.9 2.7 1 2.2.1 4.5-.1 5.9-.5 0 0-.5.4-1.6.6-3.7.7-10.8.5-8.7-.4.9-.4 1.7-.6 1.7-.6Z" fill={color} />
      <path d="M4 13.3c-.8.4.5.9 2.9 1 3.7.2 6.7-.5 6.7-.5s-.6.4-1.5.6c-4.2 1-10.5.4-8.1-1.1Z" fill={color} />
    </>
  ),
  kotlin: (color) => (
    <>
      <path d="M1.5 1.5h13L8 8l6.5 6.5h-13Z" fill={color} />
      <path d="M1.5 1.5h6.6L1.5 8.2Z" fill="#e44857" />
    </>
  ),
  swift: (color) => (
    <path
      d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm3.8 10.6c-1.2.7-3 .8-4.8-.1a8 8 0 0 1-2.6-2.2c.6.4 1.2.8 1.9 1 1.3.6 2.6.6 3.6.1C8.5 9.5 7 8.2 6 7.1c-.2-.3-.5-.6-.7-.9 1.2 1 3.1 2.3 3.7 2.7-1.5-1.5-2.8-3.4-2.7-3.3 2.3 2.2 4.4 3.5 4.4 3.5.2 0 .3-.3.4-.4.5-1.2.3-2.6-.3-3.8 1.5 1.8 2.4 3.8 1.9 5.6.5.7.4 1.7.1 2.3-.1-.5-.4-.9-.9-1.2Z"
      fill={color}
    />
  ),
  dart: (color) => (
    <>
      <path d="M1.2 8.2 5 1.6l9.6 5.2-3.1 7.5H4.7Z" fill={color} />
      <path d="M5 1.6 1.2 8.2l3.5 6.1V5.1Z" fill="#0d47a1" fillOpacity="0.5" />
    </>
  ),
  ruby: (color) => (
    <>
      <path d="M2 5.6 8 .9l6 4.7-6 9.4Z" fill={color} />
      <path d="M8 .9 2 5.6h12Z" fill="#fff" fillOpacity="0.25" />
      <path d="M8 15 2 5.6h12Z" fill="#000" fillOpacity="0.12" />
    </>
  ),
  lua: (color) => (
    <>
      <circle cx="7.4" cy="8" r="5.8" fill={color} />
      <circle cx="9.4" cy="5.6" r="1.7" fill="#fff" />
      <circle cx="13.2" cy="2.8" r="1.7" fill={color} />
    </>
  ),
  elixir: (color) => (
    <path d="M8 .8c2.2 2 4.6 4.4 4.6 7.6A4.6 4.6 0 0 1 8 15.2a4.6 4.6 0 0 1-4.6-4.8c0-3 1.7-5.2 3.3-7 .3.9.9 2 1.7 2.8C7.6 4.4 7.6 2 8 .8Z" fill={color} />
  ),
  haskell: (color) => (
    <>
      <path d="M.8 12.6 4.2 8 .8 3.4h2.6L10.2 12.6H7.6Z" fill={color} />
      <path d="M4.2 12.6 7.6 8 4.2 3.4h2.6L13.6 12.6H11Z" fill={color} fillOpacity="0.6" />
    </>
  ),
  scala: (color) => (
    <>
      <path d="M3 2.4c0-.6 4.5-1.2 10-1.4v3.2C7.5 4.4 3 5 3 5.6Z" fill={color} />
      <path d="M3 7c0-.6 4.5-1.2 10-1.4v3.2C7.5 9 3 9.6 3 10.2Z" fill={color} fillOpacity="0.75" />
      <path d="M3 11.6c0-.6 4.5-1.2 10-1.4v3.2c-5.5.2-10 .8-10 1.4Z" fill={color} fillOpacity="0.55" />
    </>
  ),

  /* Marcado y estilos. */
  html: (color) => (
    <>
      <path d="M2 1.4h12l-1.1 12.2L8 15l-4.9-1.4Z" fill={color} />
      <path d="M8 2.9v10.6l3.7-1 .9-9.6Z" fill="#000" fillOpacity="0.18" />
      <path d="M4.5 4.4h7l-.15 1.6H6.2l.1 1.4h4.9l-.4 4.4L8 12.5l-2.8-.7-.2-2h1.4l.1 1 1.5.4 1.5-.4.15-1.5H4.9Z" fill="#fff" />
    </>
  ),
  css: (color) => (
    <>
      <path d="M2 1.4h12l-1.1 12.2L8 15l-4.9-1.4Z" fill={color} />
      <path d="M8 2.9v10.6l3.7-1 .9-9.6Z" fill="#000" fillOpacity="0.18" />
      <path d="M4.6 4.4h6.9l-.16 1.7H6.3l.1 1.3h4.8l-.45 4.5L8 12.6l-2.8-.7-.18-2h1.4l.1 1 1.5.4 1.5-.4.14-1.5-4.8-.01Z" fill="#fff" />
    </>
  ),
  sass: (color) => (
    <>
      <circle cx="8" cy="8" r="6.6" fill={color} />
      <path d="M11.6 8.4c-.8 0-1.5.3-2 .8-.2-.4-.3-.8-.3-1 0-.3 0-.5.2-.8-1 .5-1.9 1-2.3 1.6-.3-.4-.6-.7-.6-1.3 0-.6.4-1 1.3-1.5 1.1-.6 1.6-1.1 1.6-1.8 0-.7-.6-1.2-1.7-1.2-1.7 0-3.4 1-3.4 2 0 .5.4.8 1 1.1.3.1.4 0 .3-.2-.3-.4-.5-.6-.5-.9 0-.6 1-1.2 2.2-1.2.6 0 .9.2.9.5 0 .4-.4.7-1.2 1.1-1.3.7-1.9 1.3-1.9 2.2 0 .8.5 1.3 1 1.8-.5.5-.8 1-.8 1.5 0 .7.5 1.1 1.2 1.1 1 0 1.9-.8 1.9-1.7 0-.4-.1-.8-.4-1.2.4-.4 1-.8 1.8-1.2 0 .3 0 .6.2 1-.7.6-1.1 1.2-1.1 1.8 0 .6.4 1 .9 1 .8 0 1.5-.9 1.5-1.9 0-.3 0-.5-.1-.8.4-.3.8-.4 1.2-.4.5 0 .8.2.8.5 0 .3-.2.5-.4.6-.2.1-.2.3 0 .3.6 0 1.2-.5 1.2-1.1 0-.6-.6-1-1.5-1Zm-4.7 3.9c-.3 0-.5-.2-.5-.5 0-.3.2-.7.6-1 .2.3.3.6.3.9 0 .4-.2.6-.4.6Zm3.1-.6c-.2 0-.3-.2-.3-.4 0-.3.2-.7.6-1 0 .2.1.4.1.6 0 .5-.2.8-.4.8Z" fill="#fff" />
    </>
  ),
  tailwind: (color) => (
    <path
      d="M8 3.6c-2.1 0-3.5 1.1-4 3.2.8-1.1 1.7-1.5 2.7-1.2.6.1 1 .6 1.5 1.1.8.8 1.7 1.7 3.8 1.7 2.1 0 3.5-1.1 4-3.2-.8 1.1-1.7 1.5-2.7 1.2-.6-.1-1-.6-1.5-1.1C11 4.5 10.1 3.6 8 3.6Zm-4 4.8c-2.1 0-3.5 1.1-4 3.2.8-1.1 1.7-1.5 2.7-1.2.6.1 1 .6 1.5 1.1.8.8 1.7 1.7 3.8 1.7 2.1 0 3.5-1.1 4-3.2-.8 1.1-1.7 1.5-2.7 1.2-.6-.1-1-.6-1.5-1.1-.8-.8-1.7-1.7-3.8-1.7Z"
      fill={color}
      transform="scale(0.86) translate(1.2 1.2)"
    />
  ),
  xml: (color) => (
    <>
      {sheet(color, 0.18)}
      {fold}
      <path d="M6.2 6.2 4.4 8.4l1.8 2.2-.9.8-2.5-3 2.5-3Zm3.6 0 .9.4-2.5 3 2.5 3-.9.8-1.8-2.2-1.8 2.2" fill="none" stroke={color} strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  svg: (color) => (
    <>
      <path d="M8 2.2 13.4 5v6L8 13.8 2.6 11V5Z" fill="none" stroke={color} strokeWidth="1.1" strokeLinejoin="round" />
      <circle cx="8" cy="2.2" r="1.5" fill={color} />
      <circle cx="13.4" cy="11" r="1.5" fill={color} />
      <circle cx="2.6" cy="11" r="1.5" fill={color} />
    </>
  ),

  /* Datos y configuración. */
  json: (color) => (
    <>
      <path d="M6.4 2.2c-1.6 0-2.2.8-2.2 2v1.5c0 .9-.4 1.4-1.4 1.4v1.8c1 0 1.4.5 1.4 1.4v1.5c0 1.2.6 2 2.2 2" fill="none" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
      <path d="M9.6 2.2c1.6 0 2.2.8 2.2 2v1.5c0 .9.4 1.4 1.4 1.4v1.8c-1 0-1.4.5-1.4 1.4v1.5c0 1.2-.6 2-2.2 2" fill="none" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
    </>
  ),
  yaml: (color) => (
    <>
      <circle cx="3.4" cy="4" r="1.2" fill={color} />
      <circle cx="3.4" cy="8" r="1.2" fill={color} />
      <circle cx="3.4" cy="12" r="1.2" fill={color} />
      <rect x="6" y="3.2" width="7.4" height="1.6" rx="0.8" fill={color} fillOpacity="0.85" />
      <rect x="6" y="7.2" width="6" height="1.6" rx="0.8" fill={color} fillOpacity="0.65" />
      <rect x="6" y="11.2" width="7" height="1.6" rx="0.8" fill={color} fillOpacity="0.45" />
    </>
  ),
  config: (color) => (
    <>
      <path
        d="M8 5.2A2.8 2.8 0 1 0 8 10.8 2.8 2.8 0 0 0 8 5.2Zm0 1.6a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4Z"
        fill={color}
      />
      <path
        d="M7.2.9h1.6l.25 1.75a5.4 5.4 0 0 1 1.35.56l1.42-1.05 1.13 1.13-1.05 1.42c.24.42.43.87.56 1.35l1.75.25v1.6l-1.75.25a5.4 5.4 0 0 1-.56 1.35l1.05 1.42-1.13 1.13-1.42-1.05c-.42.24-.87.43-1.35.56L8.8 15.1H7.2l-.25-1.75a5.4 5.4 0 0 1-1.35-.56l-1.42 1.05-1.13-1.13 1.05-1.42a5.4 5.4 0 0 1-.56-1.35L1.79 9.7V8.1l1.75-.25c.13-.48.32-.93.56-1.35L3.05 5.08 4.18 3.95 5.6 5a5.4 5.4 0 0 1 1.35-.56Z"
        fill={color}
        fillOpacity="0.35"
      />
    </>
  ),
  db: (color) => (
    <>
      <ellipse cx="8" cy="3.6" rx="5.4" ry="2.2" fill={color} />
      <path d="M2.6 3.6v8.8c0 1.2 2.4 2.2 5.4 2.2s5.4-1 5.4-2.2V3.6c0 1.2-2.4 2.2-5.4 2.2S2.6 4.8 2.6 3.6Z" fill={color} fillOpacity="0.55" />
      <ellipse cx="8" cy="8" rx="5.4" ry="2.2" fill={color} fillOpacity="0.35" />
    </>
  ),

  /* Consola y herramientas. */
  shell: (color) => (
    <>
      <rect x="1.2" y="2.4" width="13.6" height="11.2" rx="2" fill={color} fillOpacity="0.22" stroke={color} strokeWidth="1.05" />
      <path d="m4.2 6 2.2 2.2-2.2 2.2" fill="none" stroke={color} strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.8 10.6h3.8" stroke={color} strokeWidth="1.25" strokeLinecap="round" />
    </>
  ),
  docker: (color) => (
    <>
      <path d="M14.4 6.6c-.5-.35-1.6-.5-2.5-.3-.1-.8-.6-1.5-1.4-2l-.4-.3-.3.4c-.5.6-.7 1.6-.3 2.4H1.4c-.3 1.7.15 3.9 1.4 5.4 1.2 1.4 3 2.1 5.3 2.1 5 0 6.7-3.9 7-5.2.8 0 1.5-.2 1.9-1Z" fill={color} />
      <g fill={color} fillOpacity="0.75">
        <rect x="2.5" y="4.6" width="1.9" height="1.7" rx="0.25" />
        <rect x="4.9" y="4.6" width="1.9" height="1.7" rx="0.25" />
        <rect x="7.3" y="4.6" width="1.9" height="1.7" rx="0.25" />
        <rect x="4.9" y="2.4" width="1.9" height="1.7" rx="0.25" />
      </g>
    </>
  ),
  git: (color) => (
    <>
      <path d="M14.6 7.3 8.7 1.4a1.1 1.1 0 0 0-1.6 0L5.9 2.6l1.6 1.6a1.3 1.3 0 0 1 1.7 1.7l1.5 1.5a1.3 1.3 0 1 1-.8.8L8.5 6.8v3.8a1.3 1.3 0 1 1-1.1-.05V6.7a1.3 1.3 0 0 1-.7-1.7L5.1 3.4 1.4 7.1a1.1 1.1 0 0 0 0 1.6l5.9 5.9a1.1 1.1 0 0 0 1.6 0l5.7-5.7a1.1 1.1 0 0 0 0-1.6Z" fill={color} />
    </>
  ),
  npm: (color) => (
    <>
      <rect x="0.8" y="4.2" width="14.4" height="7.6" rx="0.6" fill={color} />
      <path d="M2.6 6h3.4v4H5V7.3h-.8V10H2.6Zm4.6 0h3.4v5.4H9.1V10H7.2Zm1.9 1.3v1.4h.6V7.3Zm2.5-1.3h3.4v4h-1.2V7.3h-.6V10h-1.6Z" fill="#fff" />
    </>
  ),
  lock: (color) => (
    <>
      <rect x="2.8" y="6.8" width="10.4" height="7.4" rx="1.6" fill={color} />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="10.2" r="1.3" fill="#0b0d12" fillOpacity="0.55" />
    </>
  ),
  key: (color) => (
    <>
      <circle cx="5.2" cy="5.4" r="3.3" fill="none" stroke={color} strokeWidth="1.5" />
      <path d="m7.5 7.8 6 6M11.2 11.5l-1.4 1.4M12.9 13.2l-1.2 1.2" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </>
  ),
  test: (color) => (
    <>
      {sheet(color, 0.2)}
      {fold}
      <path d="m4.8 9.6 2 2 4-4.6" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  license: (color) => (
    <>
      {sheet(color, 0.2)}
      {fold}
      <circle cx="7.7" cy="8.6" r="2.4" fill="none" stroke={color} strokeWidth="1.2" />
      <path d="m6.4 10.9-.8 3 2.1-1.1 2.1 1.1-.8-3" fill="none" stroke={color} strokeWidth="1.1" strokeLinejoin="round" />
    </>
  ),
  readme: (color) => (
    <>
      <path d="M1.4 3.2c1.8-.8 4.2-.8 6.6.4v9.8c-2.4-1.2-4.8-1.2-6.6-.4Z" fill={color} />
      <path d="M14.6 3.2c-1.8-.8-4.2-.8-6.6.4v9.8c2.4-1.2 4.8-1.2 6.6-.4Z" fill={color} fillOpacity="0.6" />
    </>
  ),
  image: (color) => (
    <>
      <rect x="1.4" y="2.8" width="13.2" height="10.4" rx="1.6" fill={color} fillOpacity="0.25" stroke={color} strokeWidth="1.05" />
      <circle cx="5.4" cy="6.2" r="1.3" fill={color} />
      <path d="m2.4 12 3.3-3.6 2.3 2.4 2.3-2.6 3.3 3.8Z" fill={color} />
    </>
  ),
  video: (color) => (
    <>
      <rect x="1.4" y="3.2" width="13.2" height="9.6" rx="1.6" fill={color} fillOpacity="0.25" stroke={color} strokeWidth="1.05" />
      <path d="M6.6 5.9 11 8l-4.4 2.1Z" fill={color} />
    </>
  ),
  audio: (color) => (
    <>
      <path d="M6.2 11.4V3.6l7-1.5v7.6" fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="4.4" cy="11.6" r="2" fill={color} />
      <circle cx="11.4" cy="9.9" r="2" fill={color} />
    </>
  ),
  font: (color) => (
    <>
      {sheet(color, 0.2)}
      {fold}
      <text x="7.7" y="12.2" textAnchor="middle" fontSize="9" fontWeight="700" fontFamily="Georgia, serif" fill={color}>A</text>
    </>
  ),
  pdf: (color) => (
    <>
      {sheet(color, 0.9)}
      {fold}
      <text x="7.7" y="11.4" textAnchor="middle" fontSize="5" fontWeight="700" fontFamily="var(--font-sans)" fill="#fff">PDF</text>
    </>
  ),
  zip: (color) => (
    <>
      <path d="M2.2 3.2a1.6 1.6 0 0 1 1.6-1.6h3.4l1.4 1.8h3.6a1.6 1.6 0 0 1 1.6 1.6v7.6a1.6 1.6 0 0 1-1.6 1.6H3.8a1.6 1.6 0 0 1-1.6-1.6Z" fill={color} />
      <path d="M7.2 5.4h1.6v1.4H7.2Zm0 2.8h1.6v1.4H7.2Z" fill="#0b0d12" fillOpacity="0.5" />
      <rect x="6.9" y="10.6" width="2.2" height="2.8" rx="0.6" fill="#0b0d12" fillOpacity="0.5" />
    </>
  ),
  binary: (color) => (
    <>
      {sheet(color, 0.2)}
      {fold}
      <text x="7.7" y="11.4" textAnchor="middle" fontSize="4.6" fontWeight="700" fontFamily="var(--font-mono)" fill={color}>1010</text>
    </>
  ),
  log: (color) => (
    <>
      {sheet(color, 0.2)}
      {fold}
      <path d="M4.6 7.2h6M4.6 9.4h6M4.6 11.6h3.6" stroke={color} strokeWidth="1.1" strokeLinecap="round" />
    </>
  ),
  txt: (color) => (
    <>
      {sheet(color, 0.22)}
      {fold}
      <path d="M4.6 6.6h6M4.6 8.8h6M4.6 11h4" stroke={color} strokeWidth="1.1" strokeLinecap="round" />
    </>
  ),
  csv: (color) => (
    <>
      {sheet(color, 0.2)}
      {fold}
      <path d="M3.5 7.4h9M3.5 10h9M6.6 5.6v8.4M9.6 5.6v8.4" stroke={color} strokeWidth="0.95" />
    </>
  ),
  ignore: (color) => (
    <>
      <circle cx="8" cy="8" r="6" fill="none" stroke={color} strokeWidth="1.5" />
      <path d="m4 12 8-8" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </>
  ),
  file: (color) => (
    <>
      {sheet(color, 0.35)}
      {fold}
    </>
  )
}

/* ------------------------------------------------------------------ *
 * Nombre → icono                                                     *
 * ------------------------------------------------------------------ */

interface Spec {
  glyph: string
  color: string
}

/** Nombre exacto de fichero: manda por encima de la extensión. */
const BY_NAME: Record<string, Spec> = {
  'package.json': { glyph: 'npm', color: C.npm },
  'package-lock.json': { glyph: 'lock', color: C.lock },
  'pnpm-lock.yaml': { glyph: 'lock', color: '#f9ad00' },
  'pnpm-workspace.yaml': { glyph: 'npm', color: '#f9ad00' },
  'yarn.lock': { glyph: 'lock', color: '#2c8ebb' },
  'bun.lockb': { glyph: 'lock', color: '#fbf0df' },
  'cargo.lock': { glyph: 'lock', color: C.rust },
  'cargo.toml': { glyph: 'rust', color: C.rust },
  'poetry.lock': { glyph: 'lock', color: C.py },
  'requirements.txt': { glyph: 'py', color: C.py },
  'pyproject.toml': { glyph: 'py', color: C.py },
  'pipfile': { glyph: 'py', color: C.py },
  'go.mod': { glyph: 'go', color: C.go },
  'go.sum': { glyph: 'lock', color: C.go },
  'dockerfile': { glyph: 'docker', color: C.docker },
  'docker-compose.yml': { glyph: 'docker', color: C.docker },
  'docker-compose.yaml': { glyph: 'docker', color: C.docker },
  '.dockerignore': { glyph: 'docker', color: '#8b93a7' },
  '.gitignore': { glyph: 'ignore', color: C.git },
  '.gitattributes': { glyph: 'git', color: C.git },
  '.gitmodules': { glyph: 'git', color: C.git },
  '.gitkeep': { glyph: 'git', color: C.git },
  '.npmrc': { glyph: 'npm', color: C.npm },
  '.npmignore': { glyph: 'ignore', color: C.npm },
  '.nvmrc': { glyph: 'config', color: '#8bc34a' },
  '.editorconfig': { glyph: 'config', color: C.config },
  '.prettierrc': { glyph: 'config', color: '#56b3b4' },
  '.prettierignore': { glyph: 'ignore', color: '#56b3b4' },
  '.eslintrc': { glyph: 'config', color: '#7b79c4' },
  '.eslintrc.json': { glyph: 'config', color: '#7b79c4' },
  '.eslintignore': { glyph: 'ignore', color: '#7b79c4' },
  '.env': { glyph: 'env', color: C.env },
  '.env.local': { glyph: 'env', color: C.env },
  '.env.example': { glyph: 'env', color: '#b8a12c' },
  'readme.md': { glyph: 'readme', color: C.readme },
  'readme': { glyph: 'readme', color: C.readme },
  'changelog.md': { glyph: 'readme', color: '#8bc34a' },
  'contributing.md': { glyph: 'readme', color: '#ff8a65' },
  'license': { glyph: 'license', color: C.license },
  'license.txt': { glyph: 'license', color: C.license },
  'license.md': { glyph: 'license', color: C.license },
  'makefile': { glyph: 'shell', color: '#e37933' },
  'cmakelists.txt': { glyph: 'config', color: '#0d9488' },
  'tsconfig.json': { glyph: 'ts', color: '#2a7fb8' },
  'tsconfig.node.json': { glyph: 'ts', color: '#2a7fb8' },
  'tsconfig.web.json': { glyph: 'ts', color: '#2a7fb8' },
  'jsconfig.json': { glyph: 'js', color: '#d4a017' },
  'vite.config.ts': { glyph: 'config', color: '#a259ff' },
  'vite.config.js': { glyph: 'config', color: '#a259ff' },
  'electron.vite.config.ts': { glyph: 'config', color: '#9feaf9' },
  'electron-builder.yml': { glyph: 'config', color: '#9feaf9' },
  'tailwind.config.js': { glyph: 'tailwind', color: C.tailwind },
  'tailwind.config.ts': { glyph: 'tailwind', color: C.tailwind },
  'postcss.config.js': { glyph: 'config', color: '#dd3a0a' },
  'claude.md': { glyph: 'readme', color: '#d97757' },
  'agents.md': { glyph: 'readme', color: '#d97757' }
}

/** Extensión → icono. */
const BY_EXT: Record<string, Spec> = {
  ts: { glyph: 'ts', color: C.ts },
  mts: { glyph: 'ts', color: C.ts },
  cts: { glyph: 'ts', color: C.ts },
  tsx: { glyph: 'react', color: C.react },
  js: { glyph: 'js', color: C.js },
  mjs: { glyph: 'js', color: C.js },
  cjs: { glyph: 'js', color: C.js },
  jsx: { glyph: 'react', color: C.react },
  vue: { glyph: 'vue', color: C.vue },
  svelte: { glyph: 'svelte', color: C.svelte },

  json: { glyph: 'json', color: C.json },
  jsonc: { glyph: 'json', color: C.json },
  json5: { glyph: 'json', color: C.json },
  yaml: { glyph: 'yaml', color: C.yaml },
  yml: { glyph: 'yaml', color: C.yaml },
  toml: { glyph: 'yaml', color: C.toml },
  ini: { glyph: 'config', color: C.config },
  cfg: { glyph: 'config', color: C.config },
  conf: { glyph: 'config', color: C.config },
  properties: { glyph: 'config', color: C.config },
  env: { glyph: 'env', color: C.env },

  html: { glyph: 'html', color: C.html },
  htm: { glyph: 'html', color: C.html },
  xml: { glyph: 'xml', color: C.xml },
  xhtml: { glyph: 'html', color: C.html },
  ejs: { glyph: 'html', color: '#a91e50' },
  hbs: { glyph: 'html', color: '#f0772b' },
  css: { glyph: 'css', color: C.css },
  scss: { glyph: 'sass', color: C.sass },
  sass: { glyph: 'sass', color: C.sass },
  less: { glyph: 'css', color: '#2a4d80' },
  styl: { glyph: 'css', color: '#c2c94f' },
  svg: { glyph: 'svg', color: '#ffb300' },

  md: { glyph: 'md', color: C.md },
  markdown: { glyph: 'md', color: C.md },
  mdx: { glyph: 'md', color: '#f9ac00' },
  txt: { glyph: 'txt', color: C.txt },
  rtf: { glyph: 'txt', color: C.txt },
  log: { glyph: 'log', color: C.log },
  csv: { glyph: 'csv', color: C.csv },
  tsv: { glyph: 'csv', color: C.csv },

  py: { glyph: 'py', color: C.py },
  pyw: { glyph: 'py', color: C.py },
  pyi: { glyph: 'py', color: C.py },
  ipynb: { glyph: 'py', color: '#f37726' },
  go: { glyph: 'go', color: C.go },
  rs: { glyph: 'rust', color: C.rust },
  java: { glyph: 'java', color: C.java },
  class: { glyph: 'binary', color: C.java },
  jar: { glyph: 'zip', color: C.java },
  kt: { glyph: 'kotlin', color: C.kotlin },
  kts: { glyph: 'kotlin', color: C.kotlin },
  swift: { glyph: 'swift', color: C.swift },
  dart: { glyph: 'dart', color: C.dart },
  rb: { glyph: 'ruby', color: C.ruby },
  gemfile: { glyph: 'ruby', color: C.ruby },
  php: { glyph: 'php', color: C.php },
  lua: { glyph: 'lua', color: C.lua },
  r: { glyph: 'r', color: C.r },
  scala: { glyph: 'scala', color: C.scala },
  ex: { glyph: 'elixir', color: C.elixir },
  exs: { glyph: 'elixir', color: C.elixir },
  hs: { glyph: 'haskell', color: C.haskell },
  c: { glyph: 'c', color: C.c },
  h: { glyph: 'c', color: '#4fc3f7' },
  cpp: { glyph: 'cpp', color: C.cpp },
  cc: { glyph: 'cpp', color: C.cpp },
  cxx: { glyph: 'cpp', color: C.cpp },
  hpp: { glyph: 'cpp', color: '#4fc3f7' },
  cs: { glyph: 'cs', color: C.cs },
  fs: { glyph: 'cs', color: '#378bba' },
  vb: { glyph: 'cs', color: C.cs },
  m: { glyph: 'c', color: '#4c8dbe' },
  mm: { glyph: 'cpp', color: '#4c8dbe' },

  sh: { glyph: 'shell', color: C.shell },
  bash: { glyph: 'shell', color: C.shell },
  zsh: { glyph: 'shell', color: C.shell },
  fish: { glyph: 'shell', color: C.shell },
  ps1: { glyph: 'shell', color: C.powershell },
  psm1: { glyph: 'shell', color: C.powershell },
  psd1: { glyph: 'shell', color: C.powershell },
  bat: { glyph: 'shell', color: '#c1c1c1' },
  cmd: { glyph: 'shell', color: '#c1c1c1' },

  sql: { glyph: 'sql', color: C.sql },
  db: { glyph: 'db', color: C.db },
  sqlite: { glyph: 'db', color: C.db },
  sqlite3: { glyph: 'db', color: C.db },
  prisma: { glyph: 'db', color: '#5a67d8' },

  png: { glyph: 'image', color: C.image },
  jpg: { glyph: 'image', color: C.image },
  jpeg: { glyph: 'image', color: C.image },
  gif: { glyph: 'image', color: C.image },
  webp: { glyph: 'image', color: C.image },
  bmp: { glyph: 'image', color: C.image },
  ico: { glyph: 'image', color: '#42a5f5' },
  icns: { glyph: 'image', color: '#42a5f5' },
  avif: { glyph: 'image', color: C.image },
  tiff: { glyph: 'image', color: C.image },
  psd: { glyph: 'image', color: '#31a8ff' },
  ai: { glyph: 'image', color: '#ff9a00' },

  mp4: { glyph: 'video', color: C.video },
  mkv: { glyph: 'video', color: C.video },
  mov: { glyph: 'video', color: C.video },
  avi: { glyph: 'video', color: C.video },
  webm: { glyph: 'video', color: C.video },

  mp3: { glyph: 'audio', color: C.audio },
  wav: { glyph: 'audio', color: C.audio },
  flac: { glyph: 'audio', color: C.audio },
  ogg: { glyph: 'audio', color: C.audio },
  m4a: { glyph: 'audio', color: C.audio },

  ttf: { glyph: 'font', color: C.font },
  otf: { glyph: 'font', color: C.font },
  woff: { glyph: 'font', color: C.font },
  woff2: { glyph: 'font', color: C.font },
  eot: { glyph: 'font', color: C.font },

  pdf: { glyph: 'pdf', color: C.pdf },
  doc: { glyph: 'txt', color: '#2b579a' },
  docx: { glyph: 'txt', color: '#2b579a' },
  xls: { glyph: 'csv', color: '#217346' },
  xlsx: { glyph: 'csv', color: '#217346' },
  ppt: { glyph: 'image', color: '#d24726' },
  pptx: { glyph: 'image', color: '#d24726' },

  zip: { glyph: 'zip', color: C.zip },
  gz: { glyph: 'zip', color: C.zip },
  tar: { glyph: 'zip', color: C.zip },
  rar: { glyph: 'zip', color: C.zip },
  '7z': { glyph: 'zip', color: C.zip },
  xz: { glyph: 'zip', color: C.zip },
  asar: { glyph: 'zip', color: '#9feaf9' },

  exe: { glyph: 'binary', color: C.binary },
  dll: { glyph: 'binary', color: C.binary },
  so: { glyph: 'binary', color: C.binary },
  dylib: { glyph: 'binary', color: C.binary },
  node: { glyph: 'binary', color: '#8bc34a' },
  wasm: { glyph: 'binary', color: '#654ff0' },
  bin: { glyph: 'binary', color: C.binary },
  pyc: { glyph: 'binary', color: C.py },

  pem: { glyph: 'key', color: C.key },
  crt: { glyph: 'key', color: C.key },
  cer: { glyph: 'key', color: C.key },
  pfx: { glyph: 'key', color: C.key },
  lock: { glyph: 'lock', color: C.lock }
}

/** Patrones sobre el nombre entero: ficheros de prueba, sobre todo. */
const PATTERNS: { re: RegExp; spec: Spec }[] = [
  { re: /\.(test|spec)\.[cm]?[jt]sx?$/i, spec: { glyph: 'test', color: C.test } },
  { re: /^test_.*\.py$/i, spec: { glyph: 'test', color: C.test } },
  { re: /_test\.(go|py|rb)$/i, spec: { glyph: 'test', color: C.test } },
  { re: /^\.env\./i, spec: { glyph: 'env', color: C.env } },
  { re: /\.d\.ts$/i, spec: { glyph: 'ts', color: '#2a7fb8' } },
  { re: /\.config\.[cm]?[jt]s$/i, spec: { glyph: 'config', color: C.config } },
  { re: /^\..*ignore$/i, spec: { glyph: 'ignore', color: C.ignore } },
  { re: /^\..*rc(\.\w+)?$/i, spec: { glyph: 'config', color: C.config } }
]

/** Carpeta con nombre conocido → color y marca. */
const BY_FOLDER: Record<string, { color: string; mark?: string }> = {
  src: { color: FOLDER.src, mark: 'code' },
  source: { color: FOLDER.src, mark: 'code' },
  lib: { color: FOLDER.utils, mark: 'code' },
  app: { color: FOLDER.app, mark: 'code' },
  main: { color: FOLDER.app, mark: 'code' },
  renderer: { color: FOLDER.src, mark: 'code' },
  preload: { color: FOLDER.src, mark: 'code' },
  shared: { color: FOLDER.utils, mark: 'code' },
  dist: { color: FOLDER.dist, mark: 'box' },
  build: { color: FOLDER.build, mark: 'box' },
  out: { color: FOLDER.dist, mark: 'box' },
  release: { color: FOLDER.dist, mark: 'box' },
  target: { color: FOLDER.build, mark: 'box' },
  node_modules: { color: FOLDER.modules, mark: 'box' },
  vendor: { color: FOLDER.modules, mark: 'box' },
  '.git': { color: FOLDER.git, mark: 'git' },
  '.github': { color: FOLDER.github, mark: 'git' },
  '.gitlab': { color: FOLDER.git, mark: 'git' },
  '.vscode': { color: FOLDER.vscode, mark: 'gear' },
  '.idea': { color: FOLDER.config, mark: 'gear' },
  '.claude': { color: '#d97757', mark: 'star' },
  docs: { color: FOLDER.docs, mark: 'doc' },
  doc: { color: FOLDER.docs, mark: 'doc' },
  documentation: { color: FOLDER.docs, mark: 'doc' },
  test: { color: FOLDER.test, mark: 'check' },
  tests: { color: FOLDER.test, mark: 'check' },
  __tests__: { color: FOLDER.test, mark: 'check' },
  spec: { color: FOLDER.test, mark: 'check' },
  e2e: { color: FOLDER.test, mark: 'check' },
  config: { color: FOLDER.config, mark: 'gear' },
  configs: { color: FOLDER.config, mark: 'gear' },
  settings: { color: FOLDER.config, mark: 'gear' },
  assets: { color: FOLDER.assets, mark: 'star' },
  static: { color: FOLDER.assets, mark: 'star' },
  images: { color: FOLDER.images, mark: 'image' },
  img: { color: FOLDER.images, mark: 'image' },
  icons: { color: FOLDER.images, mark: 'image' },
  media: { color: FOLDER.images, mark: 'image' },
  brand: { color: FOLDER.brand, mark: 'star' },
  public: { color: FOLDER.public, mark: 'globe' },
  www: { color: FOLDER.public, mark: 'globe' },
  api: { color: FOLDER.api, mark: 'globe' },
  routes: { color: FOLDER.api, mark: 'globe' },
  server: { color: FOLDER.server, mark: 'server' },
  backend: { color: FOLDER.server, mark: 'server' },
  components: { color: FOLDER.components, mark: 'code' },
  ui: { color: FOLDER.components, mark: 'code' },
  pages: { color: FOLDER.components, mark: 'doc' },
  views: { color: FOLDER.components, mark: 'doc' },
  layouts: { color: FOLDER.components, mark: 'doc' },
  hooks: { color: FOLDER.hooks, mark: 'code' },
  store: { color: FOLDER.hooks, mark: 'box' },
  utils: { color: FOLDER.utils, mark: 'gear' },
  util: { color: FOLDER.utils, mark: 'gear' },
  helpers: { color: FOLDER.utils, mark: 'gear' },
  scripts: { color: FOLDER.scripts, mark: 'code' },
  tools: { color: FOLDER.tools, mark: 'gear' },
  bin: { color: FOLDER.tools, mark: 'gear' },
  models: { color: FOLDER.models, mark: 'box' },
  model: { color: FOLDER.models, mark: 'box' },
  styles: { color: FOLDER.styles, mark: 'star' },
  css: { color: FOLDER.styles, mark: 'star' },
  themes: { color: FOLDER.styles, mark: 'star' },
  db: { color: FOLDER.db, mark: 'box' },
  database: { color: FOLDER.db, mark: 'box' },
  migrations: { color: FOLDER.db, mark: 'box' },
  prisma: { color: FOLDER.db, mark: 'box' },
  security: { color: FOLDER.security, mark: 'lock' },
  auth: { color: FOLDER.security, mark: 'lock' },
  secrets: { color: FOLDER.security, mark: 'lock' },
  locale: { color: FOLDER.locale, mark: 'globe' },
  locales: { color: FOLDER.locale, mark: 'globe' },
  i18n: { color: FOLDER.locale, mark: 'globe' },
  lang: { color: FOLDER.locale, mark: 'globe' },
  '.venv': { color: FOLDER.venv, mark: 'box' },
  venv: { color: FOLDER.venv, mark: 'box' },
  env: { color: FOLDER.venv, mark: 'box' },
  __pycache__: { color: FOLDER.cache, mark: 'box' },
  '.cache': { color: FOLDER.cache, mark: 'box' },
  cache: { color: FOLDER.cache, mark: 'box' },
  tmp: { color: FOLDER.cache, mark: 'box' },
  temp: { color: FOLDER.cache, mark: 'box' },
  coverage: { color: FOLDER.test, mark: 'check' },
  '.next': { color: '#8d8d8d', mark: 'box' },
  '.turbo': { color: '#8d8d8d', mark: 'box' }
}

/** Marcas pequeñas dentro de la carpeta, para reconocerla sin leer el nombre. */
const MARKS: Record<string, React.JSX.Element> = {
  code: <path d="M6 8.6 4.6 10l1.4 1.4M10 8.6 11.4 10 10 11.4" fill="none" stroke="#fff" strokeWidth="1.05" strokeLinecap="round" strokeLinejoin="round" />,
  box: <path d="M5.4 8.9h5.2v3.4H5.4Zm0 0 2.6-1.3 2.6 1.3" fill="none" stroke="#fff" strokeWidth="1" strokeLinejoin="round" />,
  git: <g fill="none" stroke="#fff" strokeWidth="1"><circle cx="6.1" cy="9.2" r="1" /><circle cx="6.1" cy="12.1" r="1" /><circle cx="10" cy="9.2" r="1" /><path d="M6.1 10.2v.9M7.1 9.2h1.9" /></g>,
  gear: <g fill="none" stroke="#fff" strokeWidth="1"><circle cx="8" cy="10.6" r="1.2" /><path d="M8 8.2v.6M8 12.4v.6M5.9 9.4l.5.3M9.6 11.5l.5.3M5.9 11.8l.5-.3M9.6 9.7l.5-.3" strokeLinecap="round" /></g>,
  doc: <g fill="none" stroke="#fff" strokeWidth="1" strokeLinecap="round"><path d="M6 9.2h4M6 10.8h4M6 12.4h2.4" /></g>,
  check: <path d="m5.9 10.7 1.5 1.5 2.8-3.1" fill="none" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />,
  star: <path d="m8 8.2 .85 1.72 1.9.28-1.37 1.34.32 1.9L8 12.54l-1.7.9.32-1.9-1.37-1.34 1.9-.28Z" fill="#fff" />,
  image: <g><rect x="5.4" y="8.8" width="5.2" height="3.8" rx="0.5" fill="none" stroke="#fff" strokeWidth="1" /><circle cx="6.9" cy="10.1" r="0.5" fill="#fff" /><path d="m5.7 12.3 1.6-1.6 1.2 1.2 1-1.1 1.1 1.2" fill="none" stroke="#fff" strokeWidth="0.9" /></g>,
  globe: <g fill="none" stroke="#fff" strokeWidth="1"><circle cx="8" cy="10.6" r="2.2" /><path d="M5.8 10.6h4.4M8 8.4c1.1 1.3 1.1 3.1 0 4.4-1.1-1.3-1.1-3.1 0-4.4Z" /></g>,
  server: <g fill="none" stroke="#fff" strokeWidth="1"><rect x="5.4" y="8.6" width="5.2" height="1.8" rx="0.4" /><rect x="5.4" y="11" width="5.2" height="1.8" rx="0.4" /><path d="M6.6 9.5h.01M6.6 11.9h.01" strokeLinecap="round" strokeWidth="1.2" /></g>,
  lock: <g fill="none" stroke="#fff" strokeWidth="1"><rect x="6" y="10.2" width="4" height="2.8" rx="0.6" /><path d="M6.9 10.2V9.4a1.1 1.1 0 0 1 2.2 0v.8" /></g>
}

/* ------------------------------------------------------------------ *
 * Resolución                                                         *
 * ------------------------------------------------------------------ */

export function specForFile(name: string): Spec {
  const lower = name.toLowerCase()
  const direct = BY_NAME[lower]
  if (direct) return direct
  for (const p of PATTERNS) {
    if (p.re.test(lower)) return p.spec
  }
  // Doble extensión primero (`.tar.gz`, `.d.ts` ya cubierto arriba).
  const parts = lower.split('.')
  if (parts.length > 2) {
    const two = parts.slice(-2).join('.')
    if (BY_EXT[two]) return BY_EXT[two]
  }
  const ext = parts.length > 1 ? parts[parts.length - 1] : ''
  return BY_EXT[ext] ?? { glyph: 'file', color: C.file }
}

export function specForFolder(name: string): { color: string; mark?: string } {
  return BY_FOLDER[name.toLowerCase()] ?? { color: FOLDER.base }
}

/* ------------------------------------------------------------------ *
 * Componente                                                         *
 * ------------------------------------------------------------------ */

/**
 * Icono de una entrada del árbol. `dir` la trata como carpeta y `open` pinta la
 * variante abierta.
 *
 * Va envuelto en `React.memo` porque un árbol con un proyecto grande desplegado
 * son cientos de estos, y sus propiedades casi nunca cambian: sin memo, cada
 * tecla del filtro volvía a construir cientos de SVG para dejarlos igual.
 */
export const FileIcon = React.memo(function FileIcon({
  name,
  dir,
  open,
  size = 15
}: {
  name: string
  dir?: boolean
  open?: boolean
  size?: number
}): React.JSX.Element {
  if (dir) {
    const { color, mark } = specForFolder(name)
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" className="shrink-0" aria-hidden focusable="false">
        {open ? (
          <>
            <path d="M1.2 3.6a1.3 1.3 0 0 1 1.3-1.3h3.3l1.5 1.8h6a1.3 1.3 0 0 1 1.3 1.3v1H1.2Z" fill={color} fillOpacity="0.75" />
            <path d="M1.2 6.4h13.6l-1.5 6.3a1.3 1.3 0 0 1-1.3 1H2.5a1.3 1.3 0 0 1-1.3-1.3Z" fill={color} />
          </>
        ) : (
          <>
            <path d="M1.2 3.6a1.3 1.3 0 0 1 1.3-1.3h3.3l1.5 1.8h6a1.3 1.3 0 0 1 1.3 1.3v7.1a1.3 1.3 0 0 1-1.3 1.3H2.5a1.3 1.3 0 0 1-1.3-1.3Z" fill={color} />
            <path d="M1.2 5.6h13.6v1.1H1.2Z" fill="#000" fillOpacity="0.12" />
          </>
        )}
        {mark && MARKS[mark] ? <g opacity="0.9">{MARKS[mark]}</g> : null}
      </svg>
    )
  }

  const { glyph, color } = specForFile(name)
  const draw = GLYPHS[glyph] ?? GLYPHS.file
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className="shrink-0" aria-hidden focusable="false">
      {draw(color)}
    </svg>
  )
})
