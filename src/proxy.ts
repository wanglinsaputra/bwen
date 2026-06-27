import fs from 'fs';
import path from 'path';

export interface ProxyConfig {
  ip: string;
  port: number;
  username?: string;
  password?: string;
}

/**
 * READ THIS FOR USE YOUR PROXY
 * Load proxies from proxy.txt in project root.
 * Supports three formats per line:
 *   ip:port                    (unauthenticated)
 *   ip:port:user:pass          (authenticated, legacy)
 *   user:pass@host:port        (authenticated, new)
 *
 * Returns empty array if file missing or empty.
 */
export function loadProxies(): ProxyConfig[] {
  const filePath = path.resolve(process.cwd(), 'proxy.txt');

  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const proxies: ProxyConfig[] = [];

  for (const line of lines) {
    if (line.startsWith('#')) continue;

    if (line.includes('@')) {
      const [credentials, hostPort] = line.split('@');
      const [username, password] = credentials.split(':');
      const [host, portStr] = hostPort.split(':');
      const port = parseInt(portStr, 10);
      if (isNaN(port)) continue;
      proxies.push({ ip: host, port, username, password });
    } else {
      const parts = line.split(':');
      if (parts.length < 2) continue;
      const host = parts[0];
      const port = parseInt(parts[1], 10);
      if (isNaN(port)) continue;
      const proxy: ProxyConfig = { ip: host, port };
      if (parts.length >= 4) {
        proxy.username = parts[2];
        proxy.password = parts.slice(3).join(':');
      }
      proxies.push(proxy);
    }
  }

  return proxies;
}

export function getProxyByIndex(proxies: ProxyConfig[], index: number): ProxyConfig | undefined {
  if (proxies.length === 0) return undefined;
  return proxies[index % proxies.length];
}

export function proxyToString(proxy?: ProxyConfig): string {
  if (!proxy) return 'none';
  return proxy.username
    ? `${proxy.ip}:${proxy.port}`
    : `${proxy.ip}:${proxy.port}`;
}
