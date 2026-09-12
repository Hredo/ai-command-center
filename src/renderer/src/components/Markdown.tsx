import React, { memo, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy } from 'lucide-react'
import { guessLang, highlightBlock, langFromName, type Lang } from '../lib/highlight'
import { useEditorPrefs } from '../lib/prefs'

import { useT } from '../lib/i18n'
/**
 * Un bloque de código de una respuesta.
 *
 * Va coloreado como el editor de ficheros: el mismo módulo, los mismos
 * colores. Si la valla del markdown no dice de qué lenguaje es —los modelos
 * se lo dejan a menudo— se adivina por el contenido.
 */
function CodeBlock({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const t = useT()
  // Los mismos ajustes que el editor de ficheros: si has puesto guías de
  // sangría y paréntesis de colores, los quieres también aquí.
  const prefs = useEditorPrefs()
  const text = extractText(children)
  const fence = fenceLang(children)

  const html = useMemo(() => {
    const lang: Lang = fence !== 'text' ? fence : guessLang(text)
    return highlightBlock(text.replace(/\n$/, ''), lang, {
      guides: prefs.indentGuides,
      brackets: prefs.bracketPairColorization,
      tabWidth: prefs.tabSize
    })
  }, [text, fence, prefs.indentGuides, prefs.bracketPairColorization, prefs.tabSize])

  const copy = (): void => {
    void navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  return (
    <div className="relative group">
      <button
        onClick={copy}
        className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity
                   h-7 px-2 rounded-md bg-raised border border-line text-dim hover:text-ink
                   flex items-center gap-1.5 text-[11px] z-10"
      >
        {copied ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
        {copied ? t('md.copied') : t('md.copy')}
      </button>
      <pre>
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  )
}

/** El `language-xxx` que react-markdown deja en el <code> de dentro. */
function fenceLang(node: React.ReactNode): Lang {
  const kid = Array.isArray(node) ? node[0] : node
  if (!React.isValidElement(kid)) return 'text'
  const cls = String((kid.props as { className?: string }).className ?? '')
  const m = /language-([\w+#-]+)/.exec(cls)
  return m ? langFromName(m[1]) : 'text'
}

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (React.isValidElement(node)) return extractText((node.props as { children?: React.ReactNode }).children)
  return ''
}

/** Render de respuestas. Memoizado porque se repinta en cada token del stream. */
export const Markdown = memo(function Markdown({ children }: { children: string }): React.JSX.Element {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault()
                if (href) void window.api.app.openExternal(href)
              }}
            >
              {children}
            </a>
          )
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
})
