import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const project = `preview-smoke-${process.pid}`;
const env = { ...process.env,
  PREVIEW_AUTH_SECRET: randomBytes(32).toString('hex'),
  PREVIEW_DB_PASSWORD: randomBytes(32).toString('hex'),
  PREVIEW_BIND: '127.0.0.1', PREVIEW_PORT: '3199', PREVIEW_MAIL_PORT: '8199',
  PREVIEW_BASE_URL: 'http://127.0.0.1:3199',
};
if (!env.PREVIEW_IMAGE) throw new Error('Set PREVIEW_IMAGE to the locally built CI image');
const args = ['compose', '-p', project, '-f', 'compose.preview.yaml'];
function compose(...command) {
  const result = spawnSync('docker', [...args, ...command], { env, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Preview command failed: ${command[0]}`);
}
async function request(path, init) {
  const response = await fetch(`http://127.0.0.1:3199${path}`, { ...init, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Preview HTTP ${response.status} at ${path.split('?')[0]}`);
  return response;
}
try {
  compose('pull', 'postgres', 'mailpit');
  compose('up', '-d', '--wait', '--wait-timeout', '180');
  const health = await (await request('/api/health')).json();
  if (health.status !== 'ok') throw new Error('Preview database health failed');
  await request('/');
  await request('/api/auth/sign-in/magic-link', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: env.PREVIEW_BASE_URL },
    body: JSON.stringify({ email: 'preview-smoke@example.test', callbackURL: '/' }),
  });
  let message;
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await fetch('http://127.0.0.1:8199/api/v1/messages', { signal: AbortSignal.timeout(5000) });
    const inbox = await response.json();
    if (inbox.messages?.length) { message = inbox.messages[0]; break; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!message) throw new Error('Preview magic link did not reach Mailpit');
  const mail = await (await fetch(`http://127.0.0.1:8199/api/v1/message/${message.ID}`, { signal: AbortSignal.timeout(5000) })).json();
  const urls = `${mail.Text || ''} ${mail.HTML || ''}`.match(/http[^\s<>"']+/g) || [];
  const link = urls.map(value => value.replaceAll('&amp;', '&')).find(value => value.includes('/api/auth/magic-link/verify?'));
  if (!link || new URL(link).origin !== env.PREVIEW_BASE_URL) throw new Error('Preview sign-in URL missing or wrong origin');
  // Use a real browser so cookie security and redirects match the preview UX.
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(link, { waitUntil: 'load', timeout: 60000 });
    const session = await page.evaluate(async () => {
      const response = await fetch('/api/auth/get-session');
      return response.json();
    });
    if (session?.user?.email !== 'preview-smoke@example.test') throw new Error('Preview browser session was not authenticated');
  } finally { await browser.close(); }
  const worker = spawnSync('docker', [...args, 'ps', '--status', 'running', '--services', 'worker'], { env, encoding: 'utf8' });
  if (worker.status !== 0 || worker.stdout.trim() !== 'worker') throw new Error('Preview worker is not running');
  console.log('Preview image: migrations, health, worker and real Mailpit magic-link session passed.');
} finally {
  compose('down', '--volumes', '--remove-orphans');
}
