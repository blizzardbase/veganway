// Password reset mail. Only this adapter talks to Resend; addresses never enter the database or logs.
import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export interface ResetMail {
  to: string;
  link: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  configured: boolean;
  send(mail: ResetMail, signal: AbortSignal): Promise<void>;
}

export function resetMail(to: string, link: string): ResetMail {
  const first = 'Someone asked to reset your VeganWay password.';
  const expires = 'It works for 30 minutes.';
  const ignore = 'If you did not ask, ignore this email. Your password stays the same.';
  const escaped = link.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return {
    to, link, subject: 'Reset your VeganWay password',
    text: `${first}\n\n${link}\n\n${expires}\n\n${ignore}`,
    html: `<div style="font-family:Arial,sans-serif;color:#15201a;line-height:1.5"><p>${first}</p><p><a href="${escaped}" rel="noreferrer" style="color:#0f6b4a">Reset your password</a></p><p>${expires}</p><p>${ignore}</p></div>`,
  };
}

export function memoryMailer(directory?: string): Mailer & { sent: ResetMail[] } {
  const sent: ResetMail[] = [];
  return {
    configured: true,
    sent,
    async send(mail, signal) {
      signal.throwIfAborted();
      if (directory) {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const path = join(directory, randomUUID());
        await writeFile(`${path}.tmp`, JSON.stringify(mail), { mode: 0o600, signal });
        await rename(`${path}.tmp`, `${path}.json`);
      }
      sent.push(mail);
    },
  };
}

// One call per mail, so a send only key is enough. Open and click tracking are Resend domain settings,
// off for new domains; keep them off in the Resend dashboard (docs: README, RESEND_API_KEY).
export function resendMailer(options: { apiKey?: string; from?: string; fetch?: typeof fetch }): Mailer {
  const { apiKey, from } = options;
  const request = options.fetch ?? fetch;
  const domain = from?.match(/@([^<>\s]+)>?$/)?.[1]?.toLowerCase();
  let nextCall = 0;
  async function call(path: string, init: RequestInit, signal: AbortSignal) {
    // Keep setup and sends below Resend's default ten calls per second, including concurrent requests.
    const now = Date.now();
    const startsAt = Math.max(now, nextCall);
    nextCall = startsAt + 125;
    await delay(startsAt - now, undefined, { signal });
    const response = await request(`https://api.resend.com${path}`, {
      ...init, signal, redirect: 'error',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    });
    if (!response.ok) throw new Error('ResetMailFailed');
    return response;
  }
  return {
    configured: Boolean(apiKey && from && domain),
    async send(mail, signal) {
      if (!apiKey || !from || !domain) throw new Error('ResetMailUnconfigured');
      await call('/emails', {
        method: 'POST',
        body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
      }, signal);
    },
  };
}
