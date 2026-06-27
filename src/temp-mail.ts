import { getTui } from './tui';

const TEMP_MAIL_API_BASE = 'https://www.nca.my.id/api/emails';
const CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function generateTempMailAddress(): string {
  const length = 8 + Math.floor(Math.random() * 3);
  let local = '';
  for (let i = 0; i < length; i++) {
    local += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  const email = `${local}@ncaori.my.id`;
  return email;
}



export async function pollTempMailAPI(
  emailAddress: string,
  workerId: number,
  maxRetries = 15,
): Promise<string> {
  const encoded = encodeURIComponent(emailAddress);
  const url = `${TEMP_MAIL_API_BASE}?recipient=${encoded}`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    getTui().updateWorker(workerId, `polling API for OTP (${attempt}/${maxRetries})...`);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Referer': 'https://www.nca.my.id/',
        },
      });

      if (!response.ok) {
        await sleep(3000);
        continue;
      }

      const data = await response.json() as Record<string, any>;

      if (data && data.emails && data.emails.length > 0) {
        const htmlContent: string = data.emails[0].body_html || '';
        const match = htmlContent.match(/>\s*(\d{6})\s*</);
        if (match && match[1]) {
          return match[1];
        }
      }

      await sleep(3000);
    } catch {
      await sleep(3000);
    }
  }

  throw new Error('Failed to retrieve OTP from temp mail API after maximum retries');
}



function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
