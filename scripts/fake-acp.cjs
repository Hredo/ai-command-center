// Agente ACP falso para las pruebas: habla como `opencode acp` o como
// `gemini --experimental-acp`. Abre, retoma, bifurca y carga sesiones, acepta
// modelo, esfuerzo y modo, cuenta lo que hace (pensamiento, herramientas,
// plan, uso) y, si se le pide, pregunta permiso como el de verdad.
const fs = require('node:fs')
const path = require('node:path')

exports.run = (flavor) => {
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\n')
  const sessions = new Map()
  const waiting = new Map()
  let nextId = 1000
  const ask = (method, params) =>
    new Promise((resolve) => {
      const id = ++nextId
      waiting.set(id, resolve)
      out({ jsonrpc: '2.0', id, method, params })
    })
  const update = (sessionId, u) => out({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: u } })
  const newId = () => (flavor === 'gemini' ? 'gem-' : 'ses_') + Math.random().toString(16).slice(2, 10)
  const fresh = () => ({ model: flavor === 'gemini' ? 'gemini-falso' : 'opencode/big-pickle', mode: 'build' })
  const get = (id) => {
    if (!sessions.has(id)) sessions.set(id, fresh())
    return sessions.get(id)
  }
  const options = (s) =>
    flavor === 'gemini'
      ? [{ id: 'model', category: 'model', type: 'select', currentValue: s.model, options: [] }]
      : [
          { id: 'model', category: 'model', type: 'select', currentValue: s.model, options: [{ value: 'opencode/big-pickle' }, { value: 'opencode/gpt-5.1-codex' }] },
          ...(s.model === 'opencode/gpt-5.1-codex'
            ? [{ id: 'effort', category: 'thought_level', type: 'select', currentValue: s.effort ?? 'low', options: [{ value: 'low' }, { value: 'high' }] }]
            : []),
          { id: 'mode', category: 'mode', type: 'select', currentValue: s.mode, options: [{ value: 'build' }, { value: 'plan' }] }
        ]

  const prompt = async (p) => {
    const sid = p.sessionId
    const s = get(sid)
    const text = (p.prompt ?? []).map((b) => b.text ?? '').join('')
    if (text.includes('pide permiso fuera:')) {
      const file = text.split('pide permiso fuera:')[1].trim()
      update(sid, { sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'read', kind: 'read', status: 'pending', locations: [], rawInput: {} })
      update(sid, { sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'in_progress', kind: 'read', title: 'read', locations: [{ path: file }], rawInput: { filePath: file } })
      const r = await ask('session/request_permission', {
        sessionId: sid,
        toolCall: {
          toolCallId: 'c1',
          title: path.dirname(file),
          kind: 'other',
          status: 'pending',
          locations: [{ path: file }, { path: path.dirname(file) }],
          rawInput: { filepath: file, parentDir: path.dirname(file) }
        },
        options: [
          { optionId: 'once', kind: 'allow_once', name: 'Allow once' },
          { optionId: 'always', kind: 'allow_always', name: 'Always allow' },
          { optionId: 'reject', kind: 'reject_once', name: 'Reject' }
        ]
      })
      const chosen = r?.outcome?.outcome === 'selected' ? r.outcome.optionId : 'cancelled'
      if (chosen === 'once' || chosen === 'always') {
        const content = fs.readFileSync(file, 'utf8').trim()
        update(sid, { sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: content } }], rawOutput: { output: content } })
        update(sid, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'leído: ' + content + ' (opción=' + chosen + ')' } })
      } else {
        update(sid, { sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'failed', content: [{ type: 'content', content: { type: 'text', text: 'rechazado' } }] })
        update(sid, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'no me dejaron (' + chosen + ')' } })
      }
      return { stopReason: 'end_turn', usage: { inputTokens: 100, outputTokens: 12, totalTokens: 112 } }
    }
    update(sid, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Pienso ' } })
    update(sid, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'un poco.' } })
    update(sid, {
      sessionUpdate: 'tool_call',
      toolCallId: 't1',
      title: flavor === 'gemini' ? 'read_file' : 'bash',
      kind: flavor === 'gemini' ? 'read' : 'execute',
      status: 'pending',
      rawInput: flavor === 'gemini' ? { absolute_path: 'app.js' } : { command: 'ls' }
    })
    update(sid, { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed', rawOutput: { output: 'app.js' } })
    update(sid, {
      sessionUpdate: 'plan',
      entries: [
        { content: 'leer', status: 'completed', priority: 'medium' },
        { content: 'contestar', status: 'in_progress', priority: 'medium' }
      ]
    })
    update(sid, { sessionUpdate: 'usage_update', used: 1234, size: 32000, cost: { amount: 0.02, currency: 'USD' } })
    const reply =
      flavor === 'gemini'
        ? 'resume=' + (s.resumed || 'no')
        : `session=${s.resumed || 'no'} fork=${Boolean(s.forked)} model=${s.model} effort=${s.effort ?? '-'} mode=${s.mode} prompt=${text.slice(0, 200)}`
    update(sid, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: reply } })
    return {
      stopReason: 'end_turn',
      usage: flavor === 'gemini' ? { inputTokens: 250, outputTokens: 50, totalTokens: 300 } : { inputTokens: 80, outputTokens: 10, totalTokens: 90, cachedReadTokens: 5 }
    }
  }

  const handlers = {
    initialize: () => ({
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, sessionCapabilities: flavor === 'gemini' ? {} : { resume: {}, fork: {} } }
    }),
    'session/new': () => {
      const id = newId()
      const s = fresh()
      sessions.set(id, s)
      return { sessionId: id, configOptions: options(s) }
    },
    'session/resume': (p) => {
      get(p.sessionId).resumed = p.sessionId
      return {}
    },
    'session/fork': (p) => {
      const id = newId()
      sessions.set(id, { ...fresh(), resumed: p.sessionId, forked: true })
      return { sessionId: id }
    },
    'session/load': (p) => {
      // Al cargar, el de verdad repite la conversación: eso no es del turno nuevo.
      update(p.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'VIEJO' } })
      get(p.sessionId).resumed = p.sessionId
      return null
    },
    'session/set_config_option': (p) => {
      const s = get(p.sessionId)
      s[p.configId] = p.value
      return { configOptions: options(s) }
    },
    'session/prompt': prompt
  }

  let buf = ''
  process.stdin.on('data', (c) => {
    buf += c
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      const msg = JSON.parse(line)
      if (msg.method && msg.id != null) {
        const h = handlers[msg.method]
        if (!h) {
          out({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'no existe ' + msg.method } })
          continue
        }
        Promise.resolve(h(msg.params ?? {})).then(
          (result) => out({ jsonrpc: '2.0', id: msg.id, result: result ?? null }),
          (e) => out({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: String(e?.message ?? e) } })
        )
      } else if (msg.id != null && waiting.has(msg.id)) {
        waiting.get(msg.id)(msg.result)
        waiting.delete(msg.id)
      }
    }
  })
  process.stdin.on('end', () => process.exit(0))
}
