// Claude Code falso para las pruebas. Con --input-format stream-json lee los
// mensajes uno a uno y, si se le pide, pregunta permiso por la salida con un
// control_request como el de verdad (y espera su control_response). Sin esa
// opción lee el prompt entero de la entrada, como con -p a secas.
const fs = require('node:fs')

exports.run = () => {
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\n')
  const args = process.argv.slice(2)
  const resumed = args.includes('--resume') ? args[args.indexOf('--resume') + 1] : ''
  const forked = args.includes('--fork-session')
  const streaming = args.includes('--input-format')
  const mode = args.includes('--permission-mode') ? args[args.indexOf('--permission-mode') + 1] : 'default'
  const sid = forked || !resumed ? 'sesion-' + Math.random().toString(16).slice(2, 10) : resumed
  let answer = null

  const turn = async (prompt) => {
    out({ type: 'system', subtype: 'init', session_id: sid, model: 'claude-falso', cwd: process.cwd(), permissionMode: mode })
    if (prompt.includes('pide permiso')) {
      const input = { file_path: 'permiso.txt', content: 'sí' }
      out({ type: 'assistant', session_id: sid, message: { model: 'claude-falso', content: [{ type: 'tool_use', id: 'tw1', name: 'Write', input }], usage: { input_tokens: 50, output_tokens: 5 } } })
      const resp = await new Promise((resolve) => {
        answer = resolve
        out({
          type: 'control_request',
          request_id: 'req-1',
          request: {
            subtype: 'can_use_tool',
            tool_name: 'Write',
            input,
            tool_use_id: 'tw1',
            permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Write', ruleContent: 'permiso.txt' }], behavior: 'allow', destination: 'localSettings' }]
          }
        })
      })
      const r = resp?.response ?? {}
      let text
      if (r.behavior === 'allow') {
        fs.writeFileSync('permiso.txt', 'sí\n')
        out({ type: 'user', session_id: sid, message: { content: [{ type: 'tool_result', tool_use_id: 'tw1', content: 'File created successfully' }] } })
        text = 'escrito siempre=' + Boolean(r.updatedPermissions && r.updatedPermissions.length)
      } else {
        out({ type: 'user', session_id: sid, message: { content: [{ type: 'tool_result', tool_use_id: 'tw1', content: 'denegado: ' + (r.message ?? ''), is_error: true }] } })
        text = 'no me dejaron'
      }
      out({ type: 'assistant', session_id: sid, message: { model: 'claude-falso', content: [{ type: 'text', text }], usage: { input_tokens: 60, output_tokens: 6 } } })
      out({ type: 'result', session_id: sid, total_cost_usd: 0.01, duration_ms: 40, num_turns: 2, result: text, permission_denials: [] })
      return
    }
    out({
      type: 'assistant',
      session_id: sid,
      message: {
        model: 'claude-falso',
        content: [
          { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'app.js' } },
          { type: 'text', text: 'resume=' + (resumed || 'no') + ' fork=' + forked + ' prompt=' + prompt.slice(0, 200) }
        ],
        usage: { input_tokens: 100, output_tokens: 20 }
      }
    })
    out({
      type: 'result',
      session_id: sid,
      total_cost_usd: 0.01,
      duration_ms: 50,
      num_turns: 1,
      result: 'resume=' + (resumed || 'no') + ' fork=' + forked + ' prompt=' + prompt.slice(0, 400)
    })
  }

  let buf = ''
  if (!streaming) {
    process.stdin.on('data', (c) => (buf += c))
    process.stdin.on('end', () => void turn(buf))
    return
  }
  process.stdin.on('data', (c) => {
    buf += c
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      const msg = JSON.parse(line)
      if (msg.type === 'user') {
        const content = msg.message?.content
        const text = Array.isArray(content) ? content.map((b) => b.text ?? '').join('') : String(content ?? '')
        void turn(text)
      } else if (msg.type === 'control_response' && answer) {
        const a = answer
        answer = null
        a(msg.response)
      }
    }
  })
  // Con la entrada abierta espera más mensajes: la app la cierra al llegar el resultado.
  process.stdin.on('end', () => process.exit(0))
}
