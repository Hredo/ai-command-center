/**
 * Coloreado de código, hecho en casa.
 *
 * No hay librería: son unas cuantas expresiones regulares por familia de
 * lenguaje que sacan comentarios, textos, números, palabras reservadas y
 * llamadas. No pretende entender el lenguaje —para eso está el compilador—,
 * sino que un fichero deje de ser un muro blanco.
 *
 * El texto se escapa siempre antes de salir, porque el resultado se inyecta
 * como HTML en la capa de debajo del editor.
 *
 * Además de los colores se dibujan las guías de indentación: la sangría se
 * sustituye por bloques del ancho exacto de un nivel con una línea a la
 * izquierda, así que el ancho no cambia y las columnas siguen cuadrando con
 * el textarea que va encima.
 */

export type Lang =
  | 'ts' | 'js' | 'json' | 'css' | 'html' | 'md' | 'py' | 'sh' | 'yaml'
  | 'sql' | 'go' | 'rust' | 'c' | 'java' | 'php' | 'ruby' | 'text'

/* ------------------------------------------------------------------ *
 * Idioma por extensión                                               *
 * ------------------------------------------------------------------ */

const BY_EXT: Record<string, Lang> = {
  ts: 'ts', tsx: 'ts', mts: 'ts', cts: 'ts',
  js: 'js', jsx: 'js', mjs: 'js', cjs: 'js',
  json: 'json', jsonc: 'json', json5: 'json',
  css: 'css', scss: 'css', sass: 'css', less: 'css',
  html: 'html', htm: 'html', xml: 'html', svg: 'html', vue: 'html', svelte: 'html',
  md: 'md', markdown: 'md', mdx: 'md',
  py: 'py', pyw: 'py',
  sh: 'sh', bash: 'sh', zsh: 'sh', ps1: 'sh', psm1: 'sh', bat: 'sh', cmd: 'sh',
  yml: 'yaml', yaml: 'yaml', toml: 'yaml', ini: 'yaml', cfg: 'yaml', env: 'yaml',
  sql: 'sql',
  go: 'go',
  rs: 'rust',
  c: 'c', h: 'c', cpp: 'c', cc: 'c', hpp: 'c', cs: 'c', m: 'c',
  java: 'java', kt: 'java', kts: 'java', scala: 'java', swift: 'java', dart: 'java',
  php: 'php',
  rb: 'ruby'
}

const BY_NAME: Record<string, Lang> = {
  dockerfile: 'sh',
  makefile: 'sh',
  '.gitignore': 'sh',
  '.npmrc': 'yaml',
  '.env': 'yaml'
}

export function langFromPath(path: string): Lang {
  const name = (path.split(/[\\/]/).pop() ?? '').toLowerCase()
  if (BY_NAME[name]) return BY_NAME[name]
  const ext = name.includes('.') ? name.split('.').pop()! : ''
  return BY_EXT[ext] ?? 'text'
}

/** Para los bloques de markdown, donde llega el nombre del lenguaje escrito. */
export function langFromName(name?: string): Lang {
  const n = (name ?? '').toLowerCase().trim()
  if (!n) return 'text'
  const direct: Record<string, Lang> = {
    typescript: 'ts', tsx: 'ts', javascript: 'js', jsx: 'js', node: 'js',
    shell: 'sh', bash: 'sh', zsh: 'sh', console: 'sh', powershell: 'sh', ps: 'sh',
    python: 'py', golang: 'go', rs: 'rust', 'c++': 'c', cpp: 'c', csharp: 'c',
    yml: 'yaml', markdown: 'md', html: 'html', xml: 'html', text: 'text', txt: 'text'
  }
  return direct[n] ?? BY_EXT[n] ?? 'text'
}

/**
 * Cuando un bloque de código llega sin decir de qué lenguaje es —pasa
 * constantemente en las respuestas de los modelos— se mira el contenido.
 * No acierta siempre; acertar el 90% es mucho mejor que dejarlo todo blanco.
 */
export function guessLang(code: string): Lang {
  const head = code.slice(0, 2000)
  if (/^\s*[{[]/.test(head) && /"[^"]*"\s*:/.test(head)) return 'json'
  if (/^\s*(?:\$|>|#!|npm |pnpm |yarn |git |cd |sudo |curl |docker |Get-|Set-)/m.test(head)) return 'sh'
  if (/^\s*(?:def |class .*:|import \w+$|from \w+ import )/m.test(head)) return 'py'
  if (/^\s*<[a-zA-Z!/]/.test(head)) return 'html'
  if (/^\s*[.#@a-zA-Z][\w .#:>-]*\{[^}]*:[^}]*;/m.test(head)) return 'css'
  if (/^\s*[\w.-]+:\s/m.test(head) && !/[;{}]/.test(head)) return 'yaml'
  if (/\b(?:SELECT|INSERT|UPDATE|DELETE|CREATE TABLE)\b/i.test(head)) return 'sql'
  if (/^\s*(?:func |package |go )/m.test(head)) return 'go'
  if (/^\s*(?:fn |let mut |use \w+::)/m.test(head)) return 'rust'
  // El resto se pinta como una familia de llaves: sirve para casi todo.
  return 'ts'
}

/* ------------------------------------------------------------------ *
 * Vocabulario                                                        *
 * ------------------------------------------------------------------ */

const set = (s: string): Set<string> => new Set(s.split(/\s+/).filter(Boolean))

const JS_KEY = set(`
  abstract as async await break case catch class const continue debugger declare default delete do else enum
  export extends finally for from function get if implements import in infer instanceof interface is keyof let
  new of package private protected public readonly return satisfies set static super switch this throw try type
  typeof var void while with yield namespace module asserts override accessor using
`)
const JS_LIT = set('true false null undefined NaN Infinity this super')
const JS_TYPE = set(`
  string number boolean any unknown never object symbol bigint void Promise Array Record Map Set Date RegExp
  Error JSON Math console window document React
`)

const PY_KEY = set(`
  and as assert async await break class continue def del elif else except finally for from global if import in
  is lambda nonlocal not or pass raise return try while with yield match case
`)
const PY_LIT = set('True False None self cls')

const SH_KEY = set(`
  if then else elif fi for while do done case esac function return exit export local readonly set unset shift
  in select until trap source alias declare param begin end foreach process write-host param
`)
const SH_LIT = set('true false null')

const SQL_KEY = set(`
  select from where insert into values update set delete create table alter drop index view join left right
  inner outer full on group by order having limit offset union all distinct as and or not null is like in
  between exists case when then else end primary key foreign references default constraint unique cascade
`)

const GO_KEY = set(`
  break case chan const continue default defer else fallthrough for func go goto if import interface map
  package range return select struct switch type var
`)
const RUST_KEY = set(`
  as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move
  mut pub ref return self Self static struct super trait type unsafe use where while
`)
const C_KEY = set(`
  auto bool break case catch char class const constexpr continue default delete do double else enum explicit
  export extern false float for friend goto if inline int long namespace new nullptr operator private
  protected public register return short signed sizeof static struct switch template this throw true try
  typedef typename union unsigned using virtual void volatile while var string object internal sealed
  partial async await override abstract readonly foreach base is as lock
`)
const JAVA_KEY = set(`
  abstract assert boolean break byte case catch char class const continue default do double else enum extends
  final finally float for goto if implements import instanceof int interface long native new package private
  protected public return short static strictfp super switch synchronized this throw throws transient try
  val var void volatile while fun object open override suspend data sealed when init companion let guard func
`)
const PHP_KEY = set(`
  abstract and array as break callable case catch class clone const continue declare default do echo else
  elseif empty enddeclare endfor endforeach endif endswitch endwhile enum extends final finally fn for foreach
  function global goto if implements include include_once instanceof insteadof interface isset list match
  namespace new or print private protected public readonly require require_once return static switch throw
  trait try unset use var while xor yield
`)
const RUBY_KEY = set(`
  alias and begin break case class def defined do else elsif end ensure false for if in module next nil not
  or redo rescue retry return self super then true undef unless until when while yield attr_accessor require
`)

interface Rules {
  line: string[]
  block?: [string, string]
  keywords: Set<string>
  literals: Set<string>
  types?: Set<string>
  /** Comillas invertidas como en JavaScript. */
  template?: boolean
  /** SQL se escribe tanto en mayúsculas como en minúsculas. */
  anyCase?: boolean
}

const RULES: Partial<Record<Lang, Rules>> = {
  ts: { line: ['//'], block: ['/*', '*/'], keywords: JS_KEY, literals: JS_LIT, types: JS_TYPE, template: true },
  js: { line: ['//'], block: ['/*', '*/'], keywords: JS_KEY, literals: JS_LIT, types: JS_TYPE, template: true },
  py: { line: ['#'], keywords: PY_KEY, literals: PY_LIT },
  sh: { line: ['#'], keywords: SH_KEY, literals: SH_LIT },
  sql: { line: ['--'], block: ['/*', '*/'], keywords: SQL_KEY, literals: set('true false null'), anyCase: true },
  go: { line: ['//'], block: ['/*', '*/'], keywords: GO_KEY, literals: set('true false nil iota'), template: true },
  rust: { line: ['//'], block: ['/*', '*/'], keywords: RUST_KEY, literals: set('true false None Some Ok Err') },
  c: { line: ['//'], block: ['/*', '*/'], keywords: C_KEY, literals: set('true false NULL nullptr null') },
  java: { line: ['//'], block: ['/*', '*/'], keywords: JAVA_KEY, literals: set('true false null this super') },
  php: { line: ['//', '#'], block: ['/*', '*/'], keywords: PHP_KEY, literals: set('true false null $this') },
  ruby: { line: ['#'], keywords: RUBY_KEY, literals: set('true false nil self') }
}

/* ------------------------------------------------------------------ *
 * Utilidades                                                         *
 * ------------------------------------------------------------------ */

export function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'))
}

function span(cls: string, text: string): string {
  return `<span class="t-${cls}">${escapeHtml(text)}</span>`
}

/**
 * Cuántos espacios usa el fichero por nivel. Se mira lo que hay, no lo que
 * debería haber: un fichero con sangría de tres se dibuja con guías de tres.
 */
export function indentUnit(code: string): number {
  const counts = new Map<number, number>()
  let prev = 0
  for (const line of code.split('\n', 4000)) {
    if (!line.trim()) continue
    const ws = /^[ ]*/.exec(line)![0].length
    const step = ws - prev
    if (step > 0 && step <= 8) counts.set(step, (counts.get(step) ?? 0) + 1)
    prev = ws
  }
  let best = 0
  let unit = 2
  for (const [step, n] of counts) {
    if (n > best) {
      best = n
      unit = step
    }
  }
  return unit
}

/**
 * La sangría, convertida en guías del mismo ancho que ocupaba.
 *
 * Con `dots` se rellenan con puntos medios en vez de dejarlas vacías. El punto
 * medio ocupa exactamente una celda en una fuente monoespaciada, así que las
 * columnas siguen cuadrando con el textarea que va encima; ése es el único
 * motivo de que se use ese carácter y no otro.
 */
function indentGuides(ws: string, unit: number, tabWidth: number, dots: boolean): string {
  let width = 0
  for (const ch of ws) width = ch === '\t' ? width + tabWidth - (width % tabWidth) : width + 1
  const levels = Math.floor(width / unit)
  const rest = width - levels * unit
  const fill = dots ? '·'.repeat(unit) : ''
  let out = ''
  for (let i = 0; i < levels; i++) out += `<span class="t-ind" style="width:${unit}ch">${fill}</span>`
  if (rest > 0) out += dots ? `<span class="t-ws">${'·'.repeat(rest)}</span>` : ' '.repeat(rest)
  return out
}

/* ------------------------------------------------------------------ *
 * Parejas de paréntesis                                              *
 * ------------------------------------------------------------------ */

const OPEN = '([{'

/** Un bloque ya pintado. Nuestros `span` no anidan, así que basta con esto. */
const PAINTED = /<span[^>]*>[\s\S]*?<\/span>/g

/**
 * Colorea paréntesis, corchetes y llaves por profundidad, como VS Code.
 *
 * Sólo toca el texto que quedó *fuera* de un `span`, y eso resuelve el problema
 * de golpe: los signos que hay dentro de una cadena o de un comentario ya están
 * pintados como tales, así que ni se miran. El coloreador general deja los
 * paréntesis sueltos, que es justo lo que aquí se busca.
 */
function colorBrackets(html: string): string {
  let depth = 0

  const paint = (text: string): string =>
    text.replace(/[()[\]{}]/g, (ch) => {
      if (OPEN.includes(ch)) {
        const cls = (depth % 6) + 1
        depth++
        return `<span class="t-br${cls}">${ch}</span>`
      }
      depth = Math.max(0, depth - 1)
      return `<span class="t-br${(depth % 6) + 1}">${ch}</span>`
    })

  const out: string[] = []
  let last = 0
  let m: RegExpExecArray | null
  PAINTED.lastIndex = 0
  while ((m = PAINTED.exec(html))) {
    if (m.index > last) out.push(paint(html.slice(last, m.index)))
    out.push(m[0])
    last = m.index + m[0].length
  }
  if (last < html.length) out.push(paint(html.slice(last)))
  return out.join('')
}

/** Los espacios del final de línea, que de otro modo no se ven. */
function markTrailing(line: string): string {
  return line.replace(/([ \t]+)$/, (ws) => `<span class="t-ws">${'·'.repeat(ws.length)}</span>`)
}

/* ------------------------------------------------------------------ *
 * Coloreado                                                          *
 * ------------------------------------------------------------------ */

/** Un lenguaje de llaves y comillas: la mayoría. */
function highlightGeneric(code: string, rules: Rules): string {
  const parts: string[] = []
  const lineStarts = rules.line.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const blockStart = rules.block ? rules.block[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : null
  const blockEnd = rules.block ? rules.block[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : null

  const pattern = [
    lineStarts ? `(?<line>(?:${lineStarts})[^\\n]*)` : null,
    blockStart ? `(?<block>${blockStart}[\\s\\S]*?(?:${blockEnd}|$))` : null,
    `(?<str>"(?:\\\\.|[^"\\\\\\n])*"?|'(?:\\\\.|[^'\\\\\\n])*'?${rules.template ? '|`(?:\\\\.|[^`\\\\])*`?' : ''})`,
    `(?<num>\\b(?:0[xXbBoO][0-9a-fA-F_]+|\\d[\\d_]*(?:\\.[\\d_]+)?(?:[eE][+-]?\\d+)?)\\b)`,
    `(?<id>[A-Za-z_$@#][\\w$]*)`,
    `(?<op>[+\\-*/%=<>!&|^~?:.,;]+)`
  ]
    .filter(Boolean)
    .join('|')

  const re = new RegExp(pattern, 'g')
  let last = 0
  let m: RegExpExecArray | null

  while ((m = re.exec(code))) {
    if (m.index > last) parts.push(escapeHtml(code.slice(last, m.index)))
    last = m.index + m[0].length
    const g = m.groups ?? {}

    if (g.line != null) parts.push(span('com', m[0]))
    else if (g.block != null) parts.push(span('com', m[0]))
    else if (g.str != null) parts.push(span('str', m[0]))
    else if (g.num != null) parts.push(span('num', m[0]))
    else if (g.op != null) parts.push(span('op', m[0]))
    else {
      const word = m[0]
      const bare0 = word.replace(/^[@#$]/, '')
      const bare = rules.anyCase ? bare0.toLowerCase() : bare0
      if (rules.keywords.has(bare)) parts.push(span('key', word))
      else if (rules.literals.has(bare)) parts.push(span('lit', word))
      else if (rules.types?.has(bare)) parts.push(span('typ', word))
      else if (code[re.lastIndex] === '(') parts.push(span('fn', word))
      else if (!rules.anyCase && /^[A-Z]/.test(bare)) parts.push(span('typ', word))
      else if (word.startsWith('@') || word.startsWith('$')) parts.push(span('lit', word))
      else parts.push(escapeHtml(word))
    }
  }
  if (last < code.length) parts.push(escapeHtml(code.slice(last)))
  return parts.join('')
}

function highlightJson(code: string): string {
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\b\d[\d.eE+-]*\b)|\b(true|false|null)\b/g
  const parts: string[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) {
    if (m.index > last) parts.push(escapeHtml(code.slice(last, m.index)))
    last = m.index + m[0].length
    if (m[1] != null) {
      // Una cadena seguida de dos puntos es una clave, no un valor.
      parts.push(span(m[2] ? 'prop' : 'str', m[1]))
      if (m[2]) parts.push(span('op', m[2]))
    } else if (m[3] != null) parts.push(span('num', m[3]))
    else parts.push(span('lit', m[4]))
  }
  if (last < code.length) parts.push(escapeHtml(code.slice(last)))
  return parts.join('')
}

function highlightCss(code: string): string {
  const re =
    /(\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(@[\w-]+)|([\w-]+)(\s*:)|(#[0-9a-fA-F]{3,8}\b)|(-?\b\d[\d.]*(?:px|rem|em|%|vh|vw|s|ms|fr|deg|ch)?\b)/g
  const parts: string[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) {
    if (m.index > last) parts.push(escapeHtml(code.slice(last, m.index)))
    last = m.index + m[0].length
    if (m[1] != null) parts.push(span('com', m[1]))
    else if (m[2] != null) parts.push(span('str', m[2]))
    else if (m[3] != null) parts.push(span('key', m[3]))
    else if (m[4] != null) {
      parts.push(span('prop', m[4]))
      parts.push(span('op', m[5]))
    } else if (m[6] != null) parts.push(span('num', m[6]))
    else parts.push(span('num', m[7]))
  }
  if (last < code.length) parts.push(escapeHtml(code.slice(last)))
  return parts.join('')
}

function highlightHtml(code: string): string {
  const re = /(<!--[\s\S]*?(?:-->|$))|(<\/?)([\w:-]+)((?:[^<>"']|"[^"]*"|'[^']*')*?)(\/?>)/g
  const parts: string[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) {
    if (m.index > last) parts.push(escapeHtml(code.slice(last, m.index)))
    last = m.index + m[0].length
    if (m[1] != null) {
      parts.push(span('com', m[1]))
      continue
    }
    parts.push(span('op', m[2]))
    parts.push(span('tag', m[3]))
    // Atributos: nombre = "valor"
    const attrs = m[4] ?? ''
    const ar = /([\w:.@-]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)?|(\s+)/g
    let al = 0
    let am: RegExpExecArray | null
    while ((am = ar.exec(attrs))) {
      if (am.index > al) parts.push(escapeHtml(attrs.slice(al, am.index)))
      al = am.index + am[0].length
      if (am[4] != null) {
        parts.push(am[4])
        continue
      }
      parts.push(span('attr', am[1]))
      parts.push(span('op', am[2]))
      if (am[3] != null) parts.push(span('str', am[3]))
    }
    if (al < attrs.length) parts.push(escapeHtml(attrs.slice(al)))
    parts.push(span('op', m[5]))
  }
  if (last < code.length) parts.push(escapeHtml(code.slice(last)))
  return parts.join('')
}

function highlightYaml(code: string): string {
  const out: string[] = []
  for (const line of code.split('\n')) {
    const comment = /^(\s*[^#]*?)(#.*)$/.exec(line)
    const body = comment ? comment[1] : line
    const tail = comment ? span('com', comment[2]) : ''

    const kv = /^(\s*(?:-\s+)?)([\w.$-]+)(\s*[:=]\s*)(.*)$/.exec(body)
    if (kv) {
      const value = kv[4]
      const painted =
        /^(true|false|null|yes|no|on|off)$/i.test(value.trim())
          ? span('lit', value)
          : /^-?\d[\d._]*$/.test(value.trim())
            ? span('num', value)
            : /^["']/.test(value.trim())
              ? span('str', value)
              : escapeHtml(value)
      out.push(escapeHtml(kv[1]) + span('prop', kv[2]) + span('op', kv[3]) + painted + tail)
    } else {
      out.push(escapeHtml(body) + tail)
    }
  }
  return out.join('\n')
}

function highlightMd(code: string): string {
  const out: string[] = []
  let inFence = false
  for (const line of code.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      out.push(span('key', line))
      continue
    }
    if (inFence) {
      out.push(escapeHtml(line))
      continue
    }
    if (/^\s{0,3}#{1,6}\s/.test(line)) {
      out.push(span('tag', line))
      continue
    }
    if (/^\s*>/.test(line)) {
      out.push(span('com', line))
      continue
    }
    let painted = escapeHtml(line)
    painted = painted.replace(/`[^`]+`/g, (s) => `<span class="t-str">${s}</span>`)
    painted = painted.replace(/\*\*[^*]+\*\*/g, (s) => `<span class="t-typ">${s}</span>`)
    painted = painted.replace(/\[[^\]]+\]\([^)]+\)/g, (s) => `<span class="t-fn">${s}</span>`)
    painted = painted.replace(/^(\s*)([-*+]|\d+\.)(\s)/, (_s, a, b, c) => `${a}<span class="t-op">${b}</span>${c}`)
    out.push(painted)
  }
  return out.join('\n')
}

/** Colorea el código y devuelve HTML ya escapado. */
export function highlight(code: string, lang: Lang): string {
  try {
    switch (lang) {
      case 'json':
        return highlightJson(code)
      case 'css':
        return highlightCss(code)
      case 'html':
        return highlightHtml(code)
      case 'yaml':
        return highlightYaml(code)
      case 'md':
        return highlightMd(code)
      case 'text':
        return escapeHtml(code)
      default: {
        const rules = RULES[lang]
        return rules ? highlightGeneric(code, rules) : escapeHtml(code)
      }
    }
  } catch {
    // Ante la duda, texto plano: nunca vale la pena romper la vista por un color.
    return escapeHtml(code)
  }
}

/**
 * Código coloreado con sus guías de indentación, línea a línea.
 *
 * El coloreado se hace sobre el texto entero (hay comentarios y cadenas que
 * cruzan líneas) y las guías se pegan después, sustituyendo la sangría de
 * cada línea por bloques del mismo ancho.
 */
export function highlightBlock(
  code: string,
  lang: Lang,
  opts: {
    guides?: boolean
    unit?: number
    tabWidth?: number
    /** Colorear parejas de paréntesis por profundidad. */
    brackets?: boolean
    /** Marcar con puntos la sangría y los espacios finales. */
    whitespace?: boolean
  } = {}
): string {
  let painted = highlight(code, lang)
  if (opts.brackets) painted = colorBrackets(painted)

  const dots = Boolean(opts.whitespace)
  if (opts.guides === false && !dots) return painted

  const unit = opts.unit ?? indentUnit(code)
  const tabWidth = opts.tabWidth ?? 4

  return painted
    .split('\n')
    .map((raw) => {
      const line = dots ? markTrailing(raw) : raw
      // La sangría nunca queda dentro de una etiqueta: el coloreado emite el
      // espacio en blanco tal cual, así que se puede cortar por delante.
      const ws = /^[ \t]+/.exec(line)
      if (!ws) return line
      return indentGuides(ws[0], unit, tabWidth, dots) + line.slice(ws[0].length)
    })
    .join('\n')
}
