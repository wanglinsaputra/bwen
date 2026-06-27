import imaps from 'imap-simple';

const IMAP_CONFIG: imaps.ImapSimpleOptions = {
  imap: {
    user: '',
    password: '',
    host: 'imap.gmail.com',
    port: 993,
    tls: true,
    tlsOptions: { rejectUnauthorized: false },
    authTimeout: 15000,
  },
};

const SENDER_EMAIL = 'system_sg@notice.qwencloud.com';

export interface OtpResult {
  code: string | null;
  rawBody?: string;
}

export async function fetchOtp(
  username: string,
  appPassword: string,
  currentDotEmail: string
): Promise<OtpResult> {
  const config: imaps.ImapSimpleOptions = {
    imap: {
      ...IMAP_CONFIG.imap,
      user: username,
      password: appPassword,
    },
  };

  const connection = await imaps.connect(config);

  try {
    await connection.openBox('INBOX');

    const searchCriteria: any[] = [
      'UNSEEN',
      ['FROM', SENDER_EMAIL],
    ];

    const fetchOptions = {
      bodies: ['HEADER', 'TEXT'],
      markSeen: false,
    };

    const messages = await connection.search(searchCriteria, fetchOptions);

    let targetMessage: imaps.Message | null = null;
    for (const msg of messages) {
      const headerPart = msg.parts.find(part => part.which === 'HEADER');
      if (headerPart && headerPart.body && (headerPart.body as any).to) {
        const toHeader = Array.isArray((headerPart.body as any).to)
          ? (headerPart.body as any).to.join(' ')
          : (headerPart.body as any).to;

        if (toHeader.includes(currentDotEmail)) {
          targetMessage = msg;
          break;
        }
      }
    }

    if (!targetMessage) {
      return { code: null, rawBody: undefined };
    }

    await connection.addFlags(targetMessage.attributes.uid, '\\Seen');

    const textPart = targetMessage.parts.find(part => part.which === 'TEXT');
    const rawBody = textPart?.body ?? '';

    const cleanBody = rawBody.replace(/=\r?\n/g, '').replace(/=3D/g, '=');
    const plainText = cleanBody.replace(/<[^>]*>?/gm, '');
    const match = plainText.match(/Your verification code for Qwen Cloud is:\s*(\d{6})/i);

    if (!match || !match[1]) {
      return { code: null, rawBody: rawBody.substring(0, 500) };
    }

    const otpCode = match[1];
    return { code: otpCode, rawBody: rawBody.substring(0, 500) };

  } finally {
    try {
      await connection.end();
    } catch {
    }
  }
}

export async function pollForOtp(
  username: string,
  appPassword: string,
  currentDotEmail: string,
  maxAttempts = 30,
  intervalMs = 3000
): Promise<string> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await fetchOtp(username, appPassword, currentDotEmail);
    if (result.code) {
      return result.code;
    }

    if (attempt < maxAttempts) {
      await sleep(intervalMs);
    }
  }

  throw new Error('Failed to receive OTP after maximum poll attempts');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
