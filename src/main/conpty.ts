/**
 * Consola real sin módulo nativo.
 *
 * node-pty trae un `conpty.node` sin firmar, y en un Windows con Smart App
 * Control activado el sistema se niega a cargarlo («Una directiva de Control
 * de aplicaciones bloqueó este archivo»). Sin él la terminal caía al modo por
 * tuberías, donde no funciona nada interactivo.
 *
 * La API de consolas de Windows (CreatePseudoConsole) no necesita ningún
 * binario propio: vive en kernel32. Lo que hace falta es algo firmado que la
 * llame, y PowerShell lo está. Aquí se lanza un PowerShell que compila en
 * memoria un puente pequeño en C#: abre la consola, arranca la shell dentro y
 * pasa los bytes de un lado a otro. Lo que llega a la ventana es lo mismo que
 * daba node-pty.
 *
 * Protocolo con el puente:
 *  - stdin: tramas [tipo:1][longitud:4, little endian][datos]. Tipo 1 son
 *    teclas; tipo 2, tamaño (columnas y filas, dos uint16).
 *  - stdout: la salida de la consola, en bruto.
 *  - stderr: líneas de control: `READY <pid>`, `EXIT <código>`, `ERROR <motivo>`.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { paths } from './paths'

/**
 * El guión del puente. Va con String.raw porque dentro hay C# con `\n` que
 * tiene que llegar tal cual al compilador, no convertido en un salto de línea.
 */
const HOST_SCRIPT = String.raw`# Generado por AI Command Center: puente de consola real (ConPTY) sin modulos nativos.
$ErrorActionPreference = 'Stop'
$accSource = @'
using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class AccConPtyHost
{
    [StructLayout(LayoutKind.Sequential)]
    public struct COORD { public short X; public short Y; }

    [StructLayout(LayoutKind.Sequential)]
    public struct STARTUPINFO
    {
        public int cb; public IntPtr lpReserved; public IntPtr lpDesktop; public IntPtr lpTitle;
        public int dwX; public int dwY; public int dwXSize; public int dwYSize;
        public int dwXCountChars; public int dwYCountChars; public int dwFillAttribute; public int dwFlags;
        public short wShowWindow; public short cbReserved2; public IntPtr lpReserved2;
        public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId; }

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern int CreatePseudoConsole(COORD size, SafeFileHandle hInput, SafeFileHandle hOutput, uint dwFlags, out IntPtr phPC);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern int ResizePseudoConsole(IntPtr hPC, COORD size);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern void ClosePseudoConsole(IntPtr hPC);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CreatePipe(out SafeFileHandle hReadPipe, out SafeFileHandle hWritePipe, IntPtr lpPipeAttributes, int nSize);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool InitializeProcThreadAttributeList(IntPtr lpAttributeList, int dwAttributeCount, int dwFlags, ref IntPtr lpSize);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool UpdateProcThreadAttribute(IntPtr lpAttributeList, uint dwFlags, IntPtr attribute, IntPtr lpValue, IntPtr cbSize, IntPtr lpPreviousValue, IntPtr lpReturnSize);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern void DeleteProcThreadAttributeList(IntPtr lpAttributeList);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcessW(string lpApplicationName, StringBuilder lpCommandLine, IntPtr lpProcessAttributes, IntPtr lpThreadAttributes, bool bInheritHandles, uint dwCreationFlags, IntPtr lpEnvironment, string lpCurrentDirectory, ref STARTUPINFOEX lpStartupInfo, out PROCESS_INFORMATION lpProcessInformation);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint WaitForSingleObject(IntPtr hObject, uint dwMilliseconds);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr hObject);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);

    const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
    const int STARTF_USESTDHANDLES = 0x00000100;
    static readonly IntPtr PSEUDOCONSOLE_ATTRIBUTE = (IntPtr)0x00020016;

    static readonly object reportLock = new object();
    static Stream report;
    static IntPtr console = IntPtr.Zero;
    static int closed = 0;

    static void Report(string line)
    {
        lock (reportLock)
        {
            byte[] b = Encoding.UTF8.GetBytes(line + "\n");
            try { report.Write(b, 0, b.Length); report.Flush(); } catch { }
        }
    }

    static COORD Size(int cols, int rows)
    {
        COORD c = new COORD();
        c.X = (short)Math.Max(2, Math.Min(cols, 32767));
        c.Y = (short)Math.Max(1, Math.Min(rows, 32767));
        return c;
    }

    static void CloseConsoleOnce()
    {
        if (Interlocked.Exchange(ref closed, 1) == 0 && console != IntPtr.Zero) ClosePseudoConsole(console);
    }

    static int ReadFull(Stream s, byte[] buf, int count)
    {
        int got = 0;
        while (got < count)
        {
            int n = s.Read(buf, got, count - got);
            if (n <= 0) return got;
            got += n;
        }
        return got;
    }

    public static int Probe()
    {
        report = Console.OpenStandardError();
        SafeFileHandle inRead, inWrite, outRead, outWrite;
        if (!CreatePipe(out inRead, out inWrite, IntPtr.Zero, 0) || !CreatePipe(out outRead, out outWrite, IntPtr.Zero, 0))
        {
            Report("ERROR CreatePipe " + Marshal.GetLastWin32Error());
            return 1;
        }
        IntPtr pc;
        int hr = CreatePseudoConsole(Size(80, 25), inRead, outWrite, 0, out pc);
        if (hr != 0)
        {
            Report("ERROR CreatePseudoConsole 0x" + hr.ToString("X8"));
            return 1;
        }
        ClosePseudoConsole(pc);
        Report("PROBE OK");
        return 0;
    }

    public static int Run(string commandLine, string cwd, int cols, int rows)
    {
        report = Console.OpenStandardError();
        Stream stdout = Console.OpenStandardOutput();
        Stream stdin = Console.OpenStandardInput();

        SafeFileHandle inRead, inWrite, outRead, outWrite;
        if (!CreatePipe(out inRead, out inWrite, IntPtr.Zero, 0) || !CreatePipe(out outRead, out outWrite, IntPtr.Zero, 0))
        {
            Report("ERROR CreatePipe " + Marshal.GetLastWin32Error());
            return 1;
        }

        int hr = CreatePseudoConsole(Size(cols, rows), inRead, outWrite, 0, out console);
        if (hr != 0)
        {
            Report("ERROR CreatePseudoConsole 0x" + hr.ToString("X8"));
            return 1;
        }

        IntPtr attrSize = IntPtr.Zero;
        InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attrSize);
        IntPtr attrs = Marshal.AllocHGlobal(attrSize);
        if (!InitializeProcThreadAttributeList(attrs, 1, 0, ref attrSize) ||
            !UpdateProcThreadAttribute(attrs, 0, PSEUDOCONSOLE_ATTRIBUTE, console, (IntPtr)IntPtr.Size, IntPtr.Zero, IntPtr.Zero))
        {
            Report("ERROR ProcThreadAttribute " + Marshal.GetLastWin32Error());
            return 1;
        }

        STARTUPINFOEX si = new STARTUPINFOEX();
        si.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
        // Sin esto la shell heredaria las tuberias de este proceso y su salida
        // no pasaria por la consola.
        si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        si.lpAttributeList = attrs;

        // Quien lanzo este proceso puede haberle dejado Ctrl+C desactivado, y
        // eso se hereda: la shell no se enteraria nunca de un Ctrl+C.
        SetConsoleCtrlHandler(IntPtr.Zero, false);

        PROCESS_INFORMATION pi;
        StringBuilder cmd = new StringBuilder(commandLine);
        string dir = string.IsNullOrEmpty(cwd) ? null : cwd;
        if (!CreateProcessW(null, cmd, IntPtr.Zero, IntPtr.Zero, false, EXTENDED_STARTUPINFO_PRESENT, IntPtr.Zero, dir, ref si, out pi))
        {
            Report("ERROR CreateProcess " + Marshal.GetLastWin32Error());
            CloseConsoleOnce();
            return 1;
        }

        inRead.Dispose();
        outWrite.Dispose();
        Report("READY " + pi.dwProcessId);

        FileStream fromConsole = new FileStream(outRead, FileAccess.Read, 1, false);
        FileStream toConsole = new FileStream(inWrite, FileAccess.Write, 1, false);

        Thread reader = new Thread(delegate ()
        {
            byte[] buf = new byte[65536];
            try
            {
                int n;
                while ((n = fromConsole.Read(buf, 0, buf.Length)) > 0)
                {
                    stdout.Write(buf, 0, n);
                    stdout.Flush();
                }
            }
            catch { }
        });
        reader.IsBackground = true;
        reader.Start();

        Thread writer = new Thread(delegate ()
        {
            byte[] head = new byte[5];
            byte[] body = new byte[65536];
            try
            {
                while (true)
                {
                    if (ReadFull(stdin, head, 5) < 5) break;
                    int len = BitConverter.ToInt32(head, 1);
                    if (len < 0 || len > 16 * 1024 * 1024) break;
                    if (body.Length < len) body = new byte[len];
                    if (ReadFull(stdin, body, len) < len) break;
                    if (head[0] == 1)
                    {
                        toConsole.Write(body, 0, len);
                        toConsole.Flush();
                    }
                    else if (head[0] == 2 && len >= 4)
                    {
                        ResizePseudoConsole(console, Size(BitConverter.ToUInt16(body, 0), BitConverter.ToUInt16(body, 2)));
                    }
                }
            }
            catch { }
            // Nadie escucha ya al otro lado: se cierra la consola, que termina
            // los procesos que colgaban de ella.
            CloseConsoleOnce();
        });
        writer.IsBackground = true;
        writer.Start();

        WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
        uint code;
        GetExitCodeProcess(pi.hProcess, out code);
        CloseConsoleOnce();
        reader.Join(3000);
        Report("EXIT " + unchecked((int)code));
        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);
        DeleteProcThreadAttributeList(attrs);
        Marshal.FreeHGlobal(attrs);
        return unchecked((int)code);
    }
}
'@
Add-Type -TypeDefinition $accSource -Language CSharp
if ($env:ACC_PTY_PROBE -eq '1') { [Environment]::Exit([AccConPtyHost]::Probe()) }
$accCmd = $env:ACC_PTY_CMDLINE
$accCwd = $env:ACC_PTY_CWD
$accCols = [int]$env:ACC_PTY_COLS
$accRows = [int]$env:ACC_PTY_ROWS
# Las variables del puente no tienen que llegar a la shell del usuario.
foreach ($n in 'ACC_PTY_CMDLINE', 'ACC_PTY_CWD', 'ACC_PTY_COLS', 'ACC_PTY_ROWS', 'ACC_PTY_PROBE') {
  [Environment]::SetEnvironmentVariable($n, $null)
}
[Environment]::Exit([AccConPtyHost]::Run($accCmd, $accCwd, $accCols, $accRows))
`

function powershellExe(): string {
  const root = process.env['SystemRoot'] ?? 'C:\\Windows'
  const exe = `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
  return existsSync(exe) ? exe : 'powershell.exe'
}

let hostPath: string | null = null

/** El guión vive en la carpeta de datos; se reescribe si cambia con una versión nueva. */
function hostScript(): string {
  if (hostPath && existsSync(hostPath)) return hostPath
  const file = join(paths.dir, 'conpty-host.ps1')
  let current = ''
  try {
    current = readFileSync(file, 'utf8')
  } catch {
    /* todavía no existe */
  }
  if (current !== HOST_SCRIPT) writeFileSync(file, HOST_SCRIPT, 'utf8')
  hostPath = file
  return file
}

/**
 * Se lee el guión y se ejecuta como bloque, no con -File: así no depende de la
 * política de ejecución de scripts que tenga el equipo.
 */
function hostArgs(): string[] {
  const quoted = hostScript().replace(/'/g, "''")
  return [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    `& ([scriptblock]::Create([IO.File]::ReadAllText('${quoted}')))`
  ]
}

/** Una línea de comandos de Windows con las reglas de comillas de CommandLineToArgvW. */
export function windowsCommandLine(file: string, args: string[]): string {
  const quote = (a: string): string => {
    if (a && !/[\s"]/.test(a)) return a
    let out = '"'
    let slashes = 0
    for (const ch of a) {
      if (ch === '\\') {
        slashes++
        continue
      }
      if (ch === '"') {
        out += '\\'.repeat(slashes * 2 + 1) + '"'
      } else {
        out += '\\'.repeat(slashes) + ch
      }
      slashes = 0
    }
    return out + '\\'.repeat(slashes * 2) + '"'
  }
  return [file, ...args].map(quote).join(' ')
}

/* ------------------------------------------------------------------ *
 * Sondeo                                                             *
 * ------------------------------------------------------------------ */

export interface BridgeStatus {
  ok: boolean
  reason?: string
  /** Lo que tardó el sondeo, que incluye compilar el puente. */
  ms?: number
}

let status: BridgeStatus | null = null
let probing: Promise<BridgeStatus> | null = null

export function bridgeStatus(): BridgeStatus | null {
  return status
}

/** Si una consola abierta con el puente no llega a arrancar, las siguientes no lo intentan. */
export function markBridgeBroken(reason: string): void {
  status = { ok: false, reason }
}

/** El primer renglón que explique algo de lo que dijo PowerShell. */
function firstReason(text: string): string {
  const line = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^ERROR /, '').trim())
    .find((l) => l && !/^(At line|En línea|\+|~|CategoryInfo|FullyQualifiedErrorId)/i.test(l))
  return (line ?? '').slice(0, 300)
}

/**
 * Comprueba una vez que el puente compila y que Windows deja abrir una consola.
 * Tarda un par de segundos la primera vez; el resultado se guarda.
 */
export function probeBridge(): Promise<BridgeStatus> {
  if (status) return Promise.resolve(status)
  if (probing) return probing
  if (process.platform !== 'win32') {
    status = { ok: false, reason: 'el puente sólo existe en Windows' }
    return Promise.resolve(status)
  }

  probing = new Promise<BridgeStatus>((resolve) => {
    const t0 = Date.now()
    let out = ''
    let child: ChildProcess
    const settle = (s: BridgeStatus): void => {
      status = s
      probing = null
      resolve(s)
    }
    try {
      child = spawn(powershellExe(), hostArgs(), {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ACC_PTY_PROBE: '1' }
      })
    } catch (err: any) {
      settle({ ok: false, reason: err?.message ?? String(err) })
      return
    }
    const timer = setTimeout(() => {
      out += '\nel puente no respondió en 30 s'
      child.kill()
    }, 30_000)
    child.stdout?.on('data', (d: Buffer) => (out += d.toString('utf8')))
    child.stderr?.on('data', (d: Buffer) => (out += d.toString('utf8')))
    child.on('error', (err) => (out += '\n' + err.message))
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0 && out.includes('PROBE OK')) settle({ ok: true, ms: Date.now() - t0 })
      else settle({ ok: false, reason: firstReason(out) || `el puente salió con código ${code}` })
    })
  })
  return probing
}

/* ------------------------------------------------------------------ *
 * Una consola                                                        *
 * ------------------------------------------------------------------ */

export interface Bridge {
  /** Pid del PowerShell que hace de puente. */
  readonly pid: number | undefined
  /** Pid de la shell que corre dentro, en cuanto se sabe. */
  shellPid?: number
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  kill: () => void
}

export function spawnBridge(opts: {
  file: string
  args: string[]
  cwd: string
  cols: number
  rows: number
  env: Record<string, string>
  onData: (data: string) => void
  /** `started` es false si la shell no llegó a arrancar. */
  onExit: (code: number, started: boolean) => void
}): Bridge {
  const child = spawn(powershellExe(), hostArgs(), {
    cwd: opts.cwd,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...opts.env,
      ACC_PTY_CMDLINE: windowsCommandLine(opts.file, opts.args),
      ACC_PTY_CWD: opts.cwd,
      ACC_PTY_COLS: String(opts.cols),
      ACC_PTY_ROWS: String(opts.rows)
    }
  })

  const decoder = new StringDecoder('utf8')
  let control = ''
  let diagnostics = ''
  let started = false
  let reported: number | undefined
  let exited = false

  const bridge: Bridge = {
    get pid() {
      return child.pid
    },
    write: (data) => send(1, Buffer.from(data, 'utf8')),
    resize: (cols, rows) => {
      const p = Buffer.alloc(4)
      p.writeUInt16LE(Math.max(1, Math.min(cols, 65535)), 0)
      p.writeUInt16LE(Math.max(1, Math.min(rows, 65535)), 2)
      send(2, p)
    },
    kill: () => {
      // Se mata el árbol entero: el puente, la shell y lo que ella lanzara.
      if (child.pid && !exited) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
    }
  }

  function send(kind: number, payload: Buffer): void {
    if (exited || !child.stdin || child.stdin.destroyed) return
    const head = Buffer.alloc(5)
    head[0] = kind
    head.writeInt32LE(payload.length, 1)
    child.stdin.write(Buffer.concat([head, payload]))
  }

  child.stdout?.on('data', (d: Buffer) => {
    const s = decoder.write(d)
    if (s) opts.onData(s)
  })

  child.stderr?.on('data', (d: Buffer) => {
    control += d.toString('utf8')
    let nl: number
    while ((nl = control.indexOf('\n')) !== -1) {
      const line = control.slice(0, nl).trim()
      control = control.slice(nl + 1)
      if (line.startsWith('READY ')) {
        started = true
        bridge.shellPid = Number(line.slice(6)) || undefined
      } else if (line.startsWith('EXIT ')) {
        reported = Number(line.slice(5))
      } else if (line) {
        diagnostics += (diagnostics ? '\n' : '') + line
      }
    }
  })

  // Si el puente se va, escribir en su entrada falla: lo contará 'close'.
  child.stdin?.on('error', () => undefined)

  const finish = (code: number | null, error?: string): void => {
    if (exited) return
    exited = true
    const tail = decoder.end()
    if (tail) opts.onData(tail)
    if (!started) {
      const why = error ?? (firstReason(diagnostics) || `el puente salió con código ${code}`)
      opts.onData(`\r\n\x1b[31mNo se pudo abrir la consola: ${why}\x1b[0m\r\n`)
    }
    opts.onExit(Number.isFinite(reported) ? (reported as number) : (code ?? -1), started)
  }
  child.on('error', (err) => finish(null, err.message))
  child.on('close', (code) => finish(code))

  return bridge
}
