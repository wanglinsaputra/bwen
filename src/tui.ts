import logUpdate from 'log-update';
import chalk from 'chalk';


const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];


export type WorkerStatus =
  | 'idle'
  | 'starting browser...'
  | 'generating local email...'
  | 'signing up...'
  | 'solving captcha...'
  | 'waiting for OTP...'
  | 'polling API for OTP (1/15)...'
  | 'filling OTP...'
  | 'selecting region...'
  | 'checking agreement...'
  | 'continuing...'
  | 'navigating to dashboard...'
  | 'generating key...'
  | 'validating key...'
  | 'awaiting next account...'
  | 'done ✓'
  | 'failed ✗';

export interface WorkerState {
  workerId: number;
  email: string;
  status: string;
  startTime: number;
  finalResult?: 'SUCCESS' | 'FAILED';
  proxy?: string;
}


interface TuiState {
  totalAccounts: number;
  concurrency: number;
  headless: boolean;
  emailMethod: string;
  workers: WorkerState[];
  completed: number;
  successCount: number;
  failedCount: number;
  queuedEmails: number;        
  startTime: number;          
  finishedWorkers: string[]; 
  isDone: boolean;
}


class TuiManager {
  private state: TuiState;
  private spinnerIndex = 0;
  private renderInterval: ReturnType<typeof setInterval> | null = null;

  constructor(opts: {
    totalAccounts: number;
    concurrency: number;
    headless: boolean;
    emailMethod: string;
  }) {
    this.state = {
      totalAccounts: opts.totalAccounts,
      concurrency: opts.concurrency,
      headless: opts.headless,
      emailMethod: opts.emailMethod,
      workers: [],
      completed: 0,
      successCount: 0,
      failedCount: 0,
      queuedEmails: opts.totalAccounts,
      startTime: Date.now(),
      finishedWorkers: [],
      isDone: false,
    };

    for (let i = 0; i < opts.concurrency; i++) {
      this.state.workers.push({
        workerId: i + 1,
        email: '',
        status: 'idle',
        startTime: Date.now(),
      });
    }
  }

  claimWorker(email: string, proxy?: string): number {
    const worker = this.state.workers.find((w) => w.status === 'idle');
    if (!worker) throw new Error('No idle worker slot available');
    worker.email = email;
    worker.status = 'starting browser...';
    worker.startTime = Date.now();
    worker.finalResult = undefined;
    worker.proxy = proxy;
    this.state.queuedEmails--;
    return worker.workerId;
  }

  freeWorker(workerId: number, result: 'SUCCESS' | 'FAILED'): void {
    const worker = this.state.workers.find((w) => w.workerId === workerId);
    if (!worker) return;
    worker.finalResult = result;

    const elapsed = Math.floor((Date.now() - worker.startTime) / 1000);
    const icon = result === 'SUCCESS' ? '✔' : '✘';
    const color = result === 'SUCCESS' ? chalk.green : chalk.red;
    const masked = maskEmail(worker.email);
    this.state.finishedWorkers.push(
      color(`[W${workerId}] ${icon} ${masked.padEnd(30)} ${result.padEnd(7)} ${elapsed}s`)
    );

    worker.email = '';
    worker.status = 'idle';
    worker.startTime = Date.now();

    if (result === 'SUCCESS') this.state.successCount++;
    else this.state.failedCount++;
    this.state.completed++;
  }

  updateWorker(workerId: number, status: string): void {
    const worker = this.state.workers.find((w) => w.workerId === workerId);
    if (worker) worker.status = status;
  }

  markDone(): void {
    this.state.isDone = true;
  }



  private buildOutput(): string {
    const lines: string[] = [];
    const now = Date.now();
    const elapsedSec = (now - this.state.startTime) / 1000;

    const headlessStr = this.state.headless ? 'headless' : 'headed';
    lines.push(
      chalk.cyan('╔══════════════════════════════════════════════════════════════════════╗')
    );
    lines.push(
      chalk.cyan('║') +
      chalk.bold.yellow('  Qwen Auto-Key Generator ') +
      chalk.gray(`│ ${this.state.totalAccounts} accounts │ ${this.state.concurrency} threads │ ${headlessStr} │ ${this.state.emailMethod}`) +
      chalk.cyan('  ║')
    );
    lines.push(
      chalk.cyan('╚══════════════════════════════════════════════════════════════════════╝')
    );
    lines.push('');

    const activeWorkers = this.state.workers.filter((w) => w.status !== 'idle' || w.email);
    if (activeWorkers.length > 0) {
      for (const w of activeWorkers) {
        const spinner = SPINNER_FRAMES[this.spinnerIndex % SPINNER_FRAMES.length];
        const elapsed = Math.floor((now - w.startTime) / 1000);
        const masked = maskEmail(w.email || '').padEnd(28);
        const statusStr = w.finalResult
          ? (w.finalResult === 'SUCCESS' ? chalk.green('done ✓') : chalk.red('failed ✗'))
          : chalk.blue(`${spinner} RUNNING`);
        const proxyTag = w.proxy ? chalk.gray(`🌐${w.proxy.padEnd(15)}`) : '';

        lines.push(
          `  ${chalk.cyan(`[W${w.workerId}]`)} ${statusStr}  ${chalk.gray(masked)} ${chalk.white(w.status.padEnd(22))} ${proxyTag} ${chalk.gray(`${elapsed}s`)}`
        );
      }
      lines.push('');
    }

    const idleWorkers = this.state.workers.filter((w) => w.status === 'idle' && !w.email);
    for (const w of idleWorkers) {
      lines.push(
        `  ${chalk.cyan(`[W${w.workerId}]`)} ${chalk.gray('○ IDLE     ')} ${chalk.gray('---').padEnd(28)} ${chalk.gray('waiting...'.padEnd(22))} ${chalk.gray('0s')}`
      );
    }
    lines.push('');

    for (const fw of this.state.finishedWorkers) {
      lines.push(`  ${fw}`);
    }
    if (this.state.finishedWorkers.length > 0) lines.push('');

    const done = this.state.completed;
    const total = this.state.totalAccounts;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const barLen = 40;
    const filled = Math.round((done / total) * barLen) || 0;
    const empty = barLen - filled;
    const bar =
      chalk.green('█'.repeat(filled)) +
      chalk.gray('█'.repeat(empty));

    lines.push(
      `  ${bar}  ${chalk.bold(String(pct))}%  ` +
      chalk.green(`✔${this.state.successCount}`) +
      chalk.gray(' / ') +
      chalk.red(`✘${this.state.failedCount}`) +
      chalk.gray(' / ') +
      chalk.blue(`◌${this.state.workers.filter((w) => w.status !== 'idle').length}`) +
      chalk.gray(`  (${done}/${total})`)
    );
    lines.push('');

    const rate = elapsedSec > 0 ? (done / elapsedSec) * 60 : 0;
    const remaining = total - done;
    const etaSec = rate > 0 ? (remaining / rate) * 60 : 0;
    const mem = process.memoryUsage();
    const memMb = (mem.heapUsed / 1024 / 1024).toFixed(1);

    lines.push(
      chalk.gray(`  ETA: ${formatDuration(etaSec)}  │  Rate: ${rate.toFixed(1)} acc/min  │  Heap: ${memMb} MB`)
    );
    lines.push('');

    return lines.join('\n');
  }

  render(): void {
    if (this.state.isDone) return;
    const output = this.buildOutput();
    logUpdate(output);
  }

  startAutoRefresh(): void {
    if (this.renderInterval) return;
    this.renderInterval = setInterval(() => {
      this.spinnerIndex++;
      this.render();
    }, 200);
  }

  stopAutoRefresh(): void {
    if (this.renderInterval) {
      clearInterval(this.renderInterval);
      this.renderInterval = null;
    }
  }
}



export function maskEmail(email: string): string {
  if (!email) return '';
  const atIndex = email.indexOf('@');
  if (atIndex <= 0) return email;

  const local = email.substring(0, atIndex);
  const domain = email.substring(atIndex + 1);

  const keepLocal = Math.min(2, Math.max(1, local.length));
  const maskedLocal = local.substring(0, keepLocal) + '***';

  const dotIndex = domain.lastIndexOf('.');
  if (dotIndex <= 0) {
    return `${maskedLocal}@***`;
  }

  const beforeLast = domain.substring(0, dotIndex);
  const secondDotIndex = beforeLast.lastIndexOf('.');
  let tld: string;
  if (secondDotIndex > 0) {
    tld = domain.substring(secondDotIndex);
  } else {
    tld = domain.substring(dotIndex);
  }

  return `${maskedLocal}@***${tld}`;
}

function formatDuration(seconds: number): string {
  if (seconds <= 0 || !isFinite(seconds)) return '--';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}


let _instance: TuiManager | null = null;

export function initTui(opts: {
  totalAccounts: number;
  concurrency: number;
  headless: boolean;
  emailMethod: string;
}): TuiManager {
  _instance = new TuiManager(opts);
  _instance.startAutoRefresh();
  return _instance;
}

export function getTui(): TuiManager {
  if (!_instance) throw new Error('TUI not initialized. Call initTui() first.');
  return _instance;
}
