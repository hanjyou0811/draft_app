import { spawn, type ChildProcess } from 'node:child_process';

const processes: ChildProcess[] = [];
let stopping = false;

for (const script of ['dev:server', 'dev:client']) {
  const child = spawn(process.execPath, [process.env.npm_execpath ?? 'npm', 'run', script], {
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  });
  processes.push(child);
  child.once('exit', (code) => {
    if (!stopping) stop(code ?? 1);
  });
}

function stop(code = 0): void {
  if (stopping) return;
  stopping = true;
  for (const child of processes) {
    if (child.pid === undefined || child.exitCode !== null) continue;
    if (process.platform === 'win32') child.kill('SIGTERM');
    else {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    }
  }
  setTimeout(() => process.exit(code), 250).unref();
}

process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));
