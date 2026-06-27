#!/usr/bin/env node

import prompts from 'prompts';
import chalk from 'chalk';
import logUpdate from 'log-update';

import { config, validateConfig, validateGmailConfig } from './config';
import { generateAllEmails, getVariantCount } from './email-generator';
import { runWorker, WorkerResult } from './worker';
import { loadProxies, getProxyByIndex, proxyToString } from './proxy';
import { initTui, getTui, maskEmail as tuiMaskEmail } from './tui';

function printBanner(): void {
  console.log('');
  console.log(chalk.cyan('╔══════════════════════════════════════════════════════════╗'));
  console.log(chalk.cyan('║'));
  console.log(chalk.cyan('║   ') + chalk.bold.yellow('██████╗ ██╗    ██╗███████╗███╗   ██╗'));
  console.log(chalk.cyan('║   ') + chalk.bold.yellow('██╔══██╗██║    ██║██╔════╝████╗  ██║'));
  console.log(chalk.cyan('║   ') + chalk.bold.yellow('██████╔╝██║ █╗ ██║█████╗  ██╔██╗ ██║'));
  console.log(chalk.cyan('║   ') + chalk.bold.yellow('██╔══██╗██║███╗██║██╔══╝  ██║╚██╗██║'));
  console.log(chalk.cyan('║   ') + chalk.bold.yellow('██████╔╝╚███╔███╔╝███████╗██║ ╚████║'));
  console.log(chalk.cyan('║   ') + chalk.bold.yellow('╚═════╝  ╚══╝╚══╝ ╚══════╝╚═╝  ╚═══╝'));
  console.log(chalk.cyan('║'));
  console.log(chalk.cyan('║   ') + chalk.gray('  Auto-Key Generator v1.0.0'));
  console.log(chalk.cyan('║   ') + chalk.gray('  AUTO captcha solver · Temp Mail · TUI'));
  console.log(chalk.cyan('║'));
  console.log(chalk.cyan('╚══════════════════════════════════════════════════════════╝'));
  console.log('');
}

interface CliAnswers {
  accountCount: number;
  concurrency: number;
  batchDelay: number;
  emailMethod: 'gmail' | 'tempmail';
  confirm: boolean;
}

async function askQuestions(): Promise<CliAnswers> {
  const questions: prompts.PromptObject[] = [
    {
      type: 'number',
      name: 'accountCount',
      message: 'How many accounts to create?',
      initial: 5,
      min: 1,
      max: 100,
      style: 'default',
    },
    {
      type: 'number',
      name: 'concurrency',
      message: 'Number of concurrent workers (1-5)?',
      initial: 2,
      min: 1,
      max: 5,
      style: 'default',
    },
    {
      type: 'number',
      name: 'batchDelay',
      message: 'Delay between worker batches (seconds, 0 = no delay)?',
      initial: 0,
      min: 0,
      max: 300,
      style: 'default',
    },
    {
      type: 'select',
      name: 'emailMethod',
      message: 'Which email method to use?',
      choices: [
        { title: '1) Gmail Dot Trick (from .env)', value: 'gmail' },
        { title: '2) Temp Mail (other)', value: 'tempmail' },
      ],
      initial: 0,
    },
  ];

  const answers = await prompts(questions);
  return answers as CliAnswers;
}



function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

async function main(): Promise<void> {
  printBanner();
  validateConfig();

  const answers = await askQuestions();

  if (!answers.accountCount || !answers.concurrency || !answers.emailMethod) {
    console.log(chalk.yellow('\n  ⚠️  Operation cancelled.\n'));
    process.exit(0);
  }

  const emailMethod = answers.emailMethod;
  const accountCount = answers.accountCount;
  const concurrency = answers.concurrency;
  const batchDelay = answers.batchDelay || 0;

  if (emailMethod === 'gmail') {
    validateGmailConfig();
  }

  let emailQueue: string[] = [];
  if (emailMethod === 'gmail') {
    const allEmails = generateAllEmails(config.gmailUsername);
    emailQueue = allEmails.slice(0, Math.min(accountCount, allEmails.length));
  } else {
    emailQueue = Array.from({ length: accountCount }, (_, i) => `temp-${i + 1}`);
  }

  console.log(`  📧 Method:       ${chalk.cyan(emailMethod === 'gmail' ? 'Gmail Dot Trick' : 'Temp Mail')}`);
  console.log(`  🔢 Accounts:     ${chalk.yellow(accountCount)}`);
  console.log(`  🧵 Concurrency:  ${chalk.yellow(concurrency)}`);
  console.log(`  📁 Output:       ${chalk.green('success_keys.txt')} / ${chalk.red('failed_accounts.csv')}`);

  const allProxies = loadProxies();
  if (allProxies.length > 0) {
    console.log(`  🌐 Proxies:      ${chalk.yellow(allProxies.length)} loaded (round-robin)`);
  } else {
    console.log(`  🌐 Proxies:      ${chalk.gray('none (no proxy.txt)')}`);
  }
  console.log('');

  console.log(`  🚀 Starting in 3 seconds...\n`);
  await new Promise(r => setTimeout(r, 3000));

  initTui({
    totalAccounts: accountCount,
    concurrency,
    headless: config.headless,
    emailMethod: emailMethod === 'gmail' ? 'Gmail' : 'Temp Mail',
  });

  const results: WorkerResult[] = [];
  let nextIndex = 0;

  async function dispatchWorker(): Promise<void> {
    if (nextIndex >= emailQueue.length) return;

    const idx = nextIndex++;
    const email = emailQueue[idx];
    const proxy = getProxyByIndex(allProxies, idx);

    const result = await runWorker({
      email,
      index: idx + 1,
      total: accountCount,
      emailMethod,
      proxy,
    });

    results.push(result);

    if (batchDelay > 0 && nextIndex < emailQueue.length) {
      getTui().updateWorker(-1, `awaiting next account...`);
      await new Promise(r => setTimeout(r, batchDelay * 1000));
    }

    await dispatchWorker();
  }

  const initialBatch = Math.min(concurrency, emailQueue.length);
  const workers: Promise<void>[] = [];
  for (let i = 0; i < initialBatch; i++) {
    workers.push(dispatchWorker());
  }
  await Promise.all(workers);

  getTui().stopAutoRefresh();
  getTui().markDone();
  logUpdate.done();

  console.log('');
  console.log(chalk.gray('═'.repeat(80)));
  console.log('');
  console.log(chalk.bold('  📊 Summary'));
  console.log('');

  const successCount = results.filter((r) => r.status === 'SUCCESS').length;
  const failedCount = results.filter((r) => r.status === 'FAILED').length;
  const totalDuration = results.reduce((acc, r) => Math.max(acc, r.elapsed), 0);

  console.log(`     Total accounts:  ${chalk.bold(results.length)}`);
  console.log(`     Successful:      ${chalk.green.bold(successCount)}`);
  console.log(`     Failed:          ${failedCount > 0 ? chalk.red.bold(failedCount) : chalk.green.bold(failedCount)}`);
  console.log(`     Total time:      ${chalk.bold(formatDuration(totalDuration))}`);
  console.log(`     Success Keys:    ${chalk.green('success_keys.txt')}`);
  console.log(`     Failed CSV:      ${chalk.red('failed_accounts.csv')}`);
  console.log('');

  process.exit(failedCount > 0 ? 1 : 0);
}

main().catch((err) => {
  logUpdate.done();
  console.error(chalk.red(`\n  ❌ Fatal error: ${err.message}\n`));
  process.exit(1);
});
