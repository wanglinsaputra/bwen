import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '..', '.env') });

export const config = {
  gmailUsername: process.env.GMAIL_USERNAME || '',
  gmailAppPassword: process.env.GMAIL_APP_PASSWORD || '',
  headless: (process.env.HEADLESS || 'true') === 'true',
};

export function validateConfig(): void {
}

export function validateGmailConfig(): void {
  const missing: string[] = [];
  if (!config.gmailUsername) missing.push('GMAIL_USERNAME');
  if (!config.gmailAppPassword) missing.push('GMAIL_APP_PASSWORD');
  if (missing.length > 0) {
    console.error(`\n  ❌ Missing env vars: ${missing.join(', ')}`);
    console.error('  📄 Copy .env.example to .env and fill in your credentials.\n');
    process.exit(1);
  }
}

