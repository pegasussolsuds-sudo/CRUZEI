#!/usr/bin/env node
// Monitor: CPU e memória de TODOS os processos do backend (o primário que escuta a porta + os workers do cluster,
// achados pela árvore de processos) e `docker stats` do Postgres e do Redis, a cada --interval s. Cada amostra vai
// pra tools/loadtest/out/monitor-<data>.jsonl; no fim (Ctrl+C ou --duration) imprime e grava o resumo (média/máx).
// CPU em % de UM núcleo (200% = dois núcleos inteiros), como o docker stats.
//
//   node tools/loadtest/monitor.js [--interval 5] [--port 3000] [--containers cruzei-postgres,cruzei-redis] [--duration 0]
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const readline = require('node:readline');
const L = require('./lib');

const a = L.parseArgs({ interval: 5, port: 3000, containers: 'cruzei-postgres,cruzei-redis', duration: 0 });
const containers = a.containers.split(',').filter(Boolean);
const file = L.outFile(`monitor-${L.stamp()}.jsonl`);
const out = fs.createWriteStream(file);
const r1 = (x) => Math.round(x * 10) / 10;
const series = {}; // "backend cpu" → [valores]
const push = (k, v) => Number.isFinite(v) && (series[k] ??= []).push(v);

// ---- backend: um PowerShell só, em laço, devolve uma linha JSON por amostra (CPU acumulada por processo) ----
// ponytail: só Windows (onde o projeto roda); em Linux/macOS trocar por `ps`/procfs se um dia precisar
let backend = null;
if (process.platform === 'win32') {
  const ps = `
$ErrorActionPreference = 'SilentlyContinue'
while ($true) {
  $root = (Get-NetTCPConnection -LocalPort ${a.port} -State Listen | Select-Object -First 1).OwningProcess
  $ids = @()
  if ($root) {
    $all = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'")
    $ids = @([int]$root); $grew = $true
    while ($grew) {
      $grew = $false
      foreach ($p in $all) { if (($ids -contains [int]$p.ParentProcessId) -and -not ($ids -contains [int]$p.ProcessId)) { $ids += [int]$p.ProcessId; $grew = $true } }
    }
  }
  $procs = @(Get-Process -Id $ids | ForEach-Object { [pscustomobject]@{ pid = $_.Id; cpu = $_.TotalProcessorTime.TotalSeconds; ws = $_.WorkingSet64; priv = $_.PrivateMemorySize64 } })
  [pscustomobject]@{ t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); procs = $procs } | ConvertTo-Json -Compress -Depth 3
  Start-Sleep -Seconds ${a.interval}
}`;
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  process.on('exit', () => child.kill());
  let prev = null;
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let s;
    try {
      s = JSON.parse(line);
    } catch {
      return;
    }
    const procs = [].concat(s.procs ?? []);
    if (prev) {
      const dt = (s.t - prev.t) / 1000;
      const per = procs.map((p) => ({
        pid: p.pid,
        cpu: prev.cpu.has(p.pid) ? r1(((p.cpu - prev.cpu.get(p.pid)) / dt) * 100) : 0,
        rssMB: Math.round(p.ws / 1048576),
        privMB: Math.round(p.priv / 1048576),
      }));
      const sum = (k) => per.reduce((x, p) => x + p[k], 0);
      backend = { procs: per.length, cpu: r1(sum('cpu')), rssMB: sum('rssMB'), privMB: sum('privMB'), per };
    }
    prev = { t: s.t, cpu: new Map(procs.map((p) => [p.pid, p.cpu])) };
  });
} else console.warn('CPU/memória do backend: só no Windows por enquanto (docker stats segue normal)');

// ---- docker stats ----
function toMB(s) {
  const m = /([\d.]+)\s*([KMGT]?i?B)/i.exec(s ?? '');
  if (!m) return NaN;
  const mult = { B: 1 / 1048576, KB: 1 / 1024, KIB: 1 / 1024, MB: 1, MIB: 1, GB: 1024, GIB: 1024, TB: 1048576, TIB: 1048576 }[m[2].toUpperCase()];
  return Math.round(Number(m[1]) * (mult ?? 1));
}

function dockerStats() {
  return new Promise((resolve) =>
    execFile('docker', ['stats', '--no-stream', '--format', '{{json .}}', ...containers], { timeout: 20_000 }, (err, stdout) => {
      if (err) return resolve({ error: String(err.message).split('\n')[0] });
      const res = {};
      for (const line of stdout.split('\n').filter((l) => l.trim())) {
        const j = JSON.parse(line);
        res[j.Name] = { cpu: parseFloat(j.CPUPerc), memMB: toMB(j.MemUsage.split('/')[0]), memPct: parseFloat(j.MemPerc), pids: Number(j.PIDs), net: j.NetIO, block: j.BlockIO };
      }
      resolve(res);
    }),
  );
}

// ---- laço ----
let busy = false;
const timer = setInterval(async () => {
  if (busy) return; // docker stats lento: pula a amostra em vez de empilhar
  busy = true;
  const docker = await dockerStats();
  busy = false;
  const t = new Date();
  out.write(JSON.stringify({ t: t.toISOString(), backend, docker }) + '\n');
  const parts = [t.toTimeString().slice(0, 8)];
  if (backend?.procs) {
    push('backend cpu %', backend.cpu);
    push('backend rss MB', backend.rssMB);
    parts.push(`backend ${backend.procs} proc CPU ${backend.cpu}% RAM ${backend.rssMB} MB (${backend.per.map((p) => `${p.pid}:${p.cpu}%`).join(' ')})`);
  } else if (process.platform === 'win32') parts.push(backend ? `backend: nada escutando na porta ${a.port}` : 'backend: medindo…');
  if (docker.error) parts.push(`docker: ${docker.error}`);
  for (const [name, d] of Object.entries(docker.error ? {} : docker)) {
    push(`${name} cpu %`, d.cpu);
    push(`${name} mem MB`, d.memMB);
    parts.push(`${name} CPU ${d.cpu}% RAM ${d.memMB} MB`);
  }
  console.log(parts.join(' | '));
}, a.interval * 1000);

function finish() {
  clearInterval(timer);
  const summary = Object.fromEntries(
    Object.entries(series).map(([k, v]) => [k, { avg: r1(v.reduce((x, y) => x + y, 0) / v.length), max: Math.max(...v), samples: v.length }]),
  );
  out.end(JSON.stringify({ summary, cpus: os.availableParallelism() }) + '\n', () => {
    console.log(`\nresumo (CPU em % de 1 núcleo; a máquina tem ${os.availableParallelism()}):`);
    for (const [k, s] of Object.entries(summary)) console.log(`  ${k.padEnd(24)} média ${s.avg}  máx ${s.max}`);
    console.log(`amostras: ${file}`);
    process.exit(0);
  });
}
process.on('SIGINT', finish);
if (a.duration > 0) setTimeout(finish, a.duration * 1000);
console.log(`monitorando a cada ${a.interval} s (Ctrl+C pra parar) → ${file}`);
