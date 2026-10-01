// Codex falso para las pruebas: habla como `codex app-server` (JSON por línea,
// sin el campo jsonrpc). Abre, retoma y bifurca hilos, acepta modelo, permisos
// y esfuerzo, cuenta lo que hace (razonamiento, un comando, un parche, su
// plan, los tokens) y, si se le pide, pregunta como el de verdad antes de
// ejecutar un comando, aplicar un parche o salir a la red.
const fs = require('node:fs')
const path = require('node:path')

exports.run = () => {
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\n')
  const threads = new Map()
  const waiting = new Map()
  let nextId = 5000
  let turns = 0
  const ask = (method, params) =>
    new Promise((resolve) => {
      const id = ++nextId
      waiting.set(id, resolve)
      out({ id, method, params })
    })
  const note = (method, params) => out({ method, params })
  const thread = (id, t) => ({ id, sessionId: id, preview: '', ephemeral: false, modelProvider: 'openai', model: t.model, cwd: t.cwd, status: { type: 'idle' } })
  const opened = (id) => {
    const t = threads.get(id)
    return { thread: thread(id, t), model: t.model, modelProvider: 'openai', cwd: t.cwd, approvalPolicy: t.approvalPolicy, sandbox: { type: t.sandbox }, reasoningEffort: null }
  }
  const make = (p, extra = {}) => {
    const id = 'hilo-' + Math.random().toString(16).slice(2, 10)
    threads.set(id, { model: p.model || 'gpt-falso', cwd: p.cwd, approvalPolicy: p.approvalPolicy ?? 'config', sandbox: p.sandbox ?? 'config', used: 0, ...extra })
    return id
  }
  const usage = (threadId, turnId, t) => {
    const last = { totalTokens: 540, inputTokens: 500, cachedInputTokens: 100, cacheWriteInputTokens: 0, outputTokens: 40, reasoningOutputTokens: 10 }
    t.used++
    const total = Object.fromEntries(Object.entries(last).map(([k, v]) => [k, v * t.used]))
    note('thread/tokenUsage/updated', { threadId, turnId, tokenUsage: { total, last, modelContextWindow: 272000 } })
  }
  const say = (threadId, turnId, id, text) => {
    note('item/started', { threadId, turnId, item: { type: 'agentMessage', id, text: '', phase: 'final_answer' } })
    const half = Math.ceil(text.length / 2)
    note('item/agentMessage/delta', { threadId, turnId, itemId: id, delta: text.slice(0, half) })
    note('item/agentMessage/delta', { threadId, turnId, itemId: id, delta: text.slice(half) })
    note('item/completed', { threadId, turnId, item: { type: 'agentMessage', id, text, phase: 'final_answer' } })
  }
  const finish = (threadId, turnId, status = 'completed', error = null) =>
    note('turn/completed', { threadId, turn: { id: turnId, items: [], itemsView: 'notLoaded', status, error } })

  const runTurn = async (p, turnId) => {
    const threadId = p.threadId
    const t = threads.get(threadId)
    const text = (p.input ?? []).map((i) => i.text ?? '').join('')
    note('turn/started', { threadId, turn: { id: turnId, items: [], status: 'inProgress', error: null } })
    // Un aviso de otra conversación, que no es de este turno.
    note('item/agentMessage/delta', { threadId: 'otro-hilo', turnId: 'otro', itemId: 'x', delta: 'DE OTRO HILO' })

    if (text.includes('sin cuenta')) {
      const error = { message: 'Reconnecting... 1/5', codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 401 } }, additionalDetails: 'unexpected status 401 Unauthorized' }
      note('error', { threadId, turnId, willRetry: true, error })
      finish(threadId, turnId, 'failed', { message: 'unexpected status 401 Unauthorized', codexErrorInfo: 'unauthorized', additionalDetails: null })
      return
    }

    if (text.includes('pide permiso comando')) {
      const item = { type: 'commandExecution', id: 'cmd1', command: 'touch fuera.txt', cwd: t.cwd, status: 'inProgress', commandActions: [{ type: 'unknown', command: 'touch fuera.txt' }], aggregatedOutput: null, exitCode: null, durationMs: null }
      note('item/started', { threadId, turnId, item })
      const r = await ask('item/commandExecution/requestApproval', {
        kind: 'command', threadId, turnId, itemId: 'cmd1', startedAtMs: Date.now(), environmentId: 'local',
        reason: 'necesita escribir fuera del sandbox', command: 'touch fuera.txt', cwd: t.cwd,
        commandActions: item.commandActions, proposedExecpolicyAmendment: ['touch']
      })
      const d = r?.decision
      const name = typeof d === 'string' ? d : d && d.acceptWithExecpolicyAmendment ? 'regla:' + d.acceptWithExecpolicyAmendment.execpolicy_amendment.join(' ') : 'nada'
      const ok = name === 'accept' || name === 'acceptForSession' || name.startsWith('regla:')
      note('item/completed', { threadId, turnId, item: { ...item, status: ok ? 'completed' : 'declined', aggregatedOutput: ok ? 'hecho' : null, exitCode: ok ? 0 : null, durationMs: 12 } })
      usage(threadId, turnId, t)
      say(threadId, turnId, 'm1', ok ? 'ejecutado (decisión=' + name + ')' : 'no me dejaron (' + name + ')')
      finish(threadId, turnId)
      return
    }

    if (text.includes('pide permiso parche')) {
      const file = path.join(t.cwd, 'parche-codex.txt')
      const item = { type: 'fileChange', id: 'fc1', status: 'inProgress', changes: [{ path: file, kind: { type: 'add' }, diff: '+uno\n+dos\n' }] }
      note('item/started', { threadId, turnId, item })
      const r = await ask('item/fileChange/requestApproval', { threadId, turnId, itemId: 'fc1', startedAtMs: Date.now(), reason: null, grantRoot: null })
      const ok = r?.decision === 'accept' || r?.decision === 'acceptForSession'
      if (ok) fs.writeFileSync(file, 'uno\ndos\n')
      note('item/completed', { threadId, turnId, item: { ...item, status: ok ? 'completed' : 'declined' } })
      usage(threadId, turnId, t)
      say(threadId, turnId, 'm1', ok ? 'parche aplicado (decisión=' + r.decision + ')' : 'parche rechazado (' + r?.decision + ')')
      finish(threadId, turnId)
      return
    }

    if (text.includes('pide permiso red')) {
      const r = await ask('item/permissions/requestApproval', {
        threadId, turnId, itemId: 'perm1', environmentId: 'local', startedAtMs: Date.now(), cwd: t.cwd, reason: 'quiere salir a la red',
        permissions: { network: { enabled: true }, fileSystem: null }
      })
      usage(threadId, turnId, t)
      say(threadId, turnId, 'm1', 'red=' + Boolean(r?.permissions?.network?.enabled) + ' alcance=' + r?.scope)
      finish(threadId, turnId)
      return
    }

    note('item/started', { threadId, turnId, item: { type: 'reasoning', id: 'r1', summary: [], content: [] } })
    note('item/reasoning/summaryTextDelta', { threadId, turnId, itemId: 'r1', delta: 'Pienso ', summaryIndex: 0 })
    note('item/reasoning/summaryTextDelta', { threadId, turnId, itemId: 'r1', delta: 'primero.', summaryIndex: 0 })
    note('item/completed', { threadId, turnId, item: { type: 'reasoning', id: 'r1', summary: ['Pienso primero.'], content: [] } })
    const cmd = { type: 'commandExecution', id: 'i1', command: 'ls', cwd: t.cwd, status: 'inProgress', commandActions: [{ type: 'listFiles', command: 'ls', path: null }], aggregatedOutput: null, exitCode: null, durationMs: null }
    note('item/started', { threadId, turnId, item: cmd })
    note('item/completed', { threadId, turnId, item: { ...cmd, status: 'completed', aggregatedOutput: 'app.js\n', exitCode: 0, durationMs: 9 } })
    const change = { type: 'fileChange', id: 'i2', status: 'completed', changes: [{ path: path.join(t.cwd, 'app.js'), kind: { type: 'update', move_path: null }, diff: '@@ -1 +1,2 @@\n-uno\n+UNO\n+dos\n' }] }
    note('item/started', { threadId, turnId, item: { ...change, status: 'inProgress' } })
    note('item/completed', { threadId, turnId, item: change })
    note('turn/plan/updated', { threadId, turnId, explanation: null, plan: [{ step: 'leer', status: 'completed' }, { step: 'arreglar', status: 'inProgress' }] })
    usage(threadId, turnId, t)
    const effort = p.effort ?? '-'
    say(
      threadId,
      turnId,
      'm1',
      `hilo=${t.resumed ? 'resume ' + t.resumed : 'nuevo'} fork=${Boolean(t.forked)} model=${t.model} effort=${effort} approval=${t.approvalPolicy} sandbox=${t.sandbox} prompt=${text.slice(0, 200)}`
    )
    finish(threadId, turnId)
  }

  const handlers = {
    initialize: (p) => ({ userAgent: (p.clientInfo?.name ?? '?') + '/falso', codexHome: '/tmp/codex', platformFamily: 'unix', platformOs: 'linux' }),
    'account/read': () => ({ account: { type: 'chatgpt', email: 'falso@example.com', planType: 'plus' }, requiresOpenaiAuth: true }),
    'thread/start': (p) => opened(make(p)),
    'thread/resume': (p) => {
      // El de verdad lo lee del disco; aquí basta con que el id tenga su forma.
      if (!String(p.threadId).startsWith('hilo-')) throw new Error('no existe el hilo ' + p.threadId)
      if (!threads.has(p.threadId)) threads.set(p.threadId, { model: 'gpt-falso', cwd: p.cwd, approvalPolicy: 'config', sandbox: 'config', used: 1 })
      const t = threads.get(p.threadId)
      Object.assign(t, { resumed: p.threadId, model: p.model || t.model, approvalPolicy: p.approvalPolicy ?? t.approvalPolicy, sandbox: p.sandbox ?? t.sandbox })
      return opened(p.threadId)
    },
    'thread/fork': (p) => opened(make(p, { resumed: p.threadId, forked: true, used: 1 })),
    'turn/start': (p) => {
      const turnId = 'turno-' + ++turns
      setTimeout(() => void runTurn(p, turnId), 5)
      return { turn: { id: turnId, items: [], itemsView: 'notLoaded', status: 'inProgress', error: null } }
    }
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
          out({ id: msg.id, error: { code: -32601, message: 'no existe ' + msg.method } })
          continue
        }
        Promise.resolve()
          .then(() => h(msg.params ?? {}))
          .then(
            (result) => out({ id: msg.id, result: result ?? null }),
            (e) => out({ id: msg.id, error: { code: -32000, message: String(e?.message ?? e) } })
          )
      } else if (msg.id != null && waiting.has(msg.id)) {
        waiting.get(msg.id)(msg.result)
        waiting.delete(msg.id)
      }
    }
  })
  process.stdin.on('end', () => process.exit(0))
}
