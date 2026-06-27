# Qwen Auto-Key Generator

CLI automation bot that registers Qwen Cloud accounts via the Gmail dot trick, solves slider captchas for free, and scrapes API keys.

## Features

- **Automated Account Creation**: Automatically registers accounts on Qwen Cloud.
- **Gmail Dot Trick**: Uses the Gmail dot trick to generate multiple aliases from a single Gmail address.
- **Email Verification**: Automatically reads your Gmail using IMAP to retrieve verification codes.
- **Captcha Solver**: Uses Playwright and image processing (Jimp) to automatically solve slider captchas.
- **API Key Scraping**: Automatically extracts API keys after successful registration.

## Requirements

- [Node.js](https://nodejs.org/) (v16 or higher recommended)
- A Gmail account with **2FA enabled** and an **App Password**.
- Proxies (Optional but recommended to prevent IP bans).

## Installation

1. Clone this repository:

   ```bash
   git clone https://github.com/wanglinsaputra/bwen.git
   cd bwen
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## Configuration

1. Copy the example environment file and configure it:

   ```bash
   cp .env.example .env
   ```

2. Open `.env` and fill in your details:
   - `GMAIL_USERNAME`: Your base Gmail address (e.g., `yourname@gmail.com`).
   - `GMAIL_APP_PASSWORD`: Your 16-character Gmail App Password. (Do NOT use your normal password. Generate one [here](https://myaccount.google.com/apppasswords)).
   - `QWEN_SSO_URL`: The Qwen Cloud SSO URL.
   - `HEADLESS`: Set to `true` to run invisibly, or `false` if you want to watch the browser work.

3. (Optional) Add your proxies:
   Create or edit `proxy.txt` in the root directory and add your proxies, one per line. Supported formats:
   - `user:pass@host:port`
   - `ip:port`
   - `ip:port:user:pass`

## Usage

### Development Mode

To run the bot in development mode using `ts-node`:

```bash
npm run dev
```

### Production Mode

To build and run the compiled JavaScript:

```bash
npm run build
npm start
```

## Output

- The registered accounts and scraped API keys will be saved to `accounts.csv`.
- Temporary files might be stored in the `scratch/` directory.

## Disclaimer

This project is for educational purposes only. Use responsibly and adhere to the terms of service of the targeted platforms.

## License

[MIT](LICENSE) — feel free to use, modify, and distribute.
