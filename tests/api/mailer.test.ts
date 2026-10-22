import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryMailer, resendMailer, resetMail } from '../../server/lib/mailer.js';

test('Resend sends plain text and minimal HTML in one call, so a send only key is enough', async () => {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const mail = resetMail('synthetic.recipient@example.test', 'https://veganway.example/reset?token=synthetic');
  const mailer = resendMailer({
    apiKey: 'synthetic-test-key', from: 'VeganWay DXB <reset@veganway.example>',
    fetch: async (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
      return Response.json({ id: 'synthetic-id' });
    },
  });
  assert.equal(mailer.configured, true);
  await mailer.send(mail, AbortSignal.timeout(5000));
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), ['POST https://api.resend.com/emails']);
  assert.deepEqual(calls[0].body, {
    from: 'VeganWay DXB <reset@veganway.example>', to: [mail.to], subject: 'Reset your VeganWay password', text: mail.text, html: mail.html,
  });
  assert.equal(mail.text, `Someone asked to reset your VeganWay password.\n\n${mail.link}\n\nIt works for 30 minutes.\n\nIf you did not ask, ignore this email. Your password stays the same.`);
  assert.doesNotMatch(mail.html, /<img|<script|<style|tracking/i);
});

test('Resend failures surface as ResetMailFailed and never read or expose the provider error', async () => {
  const mailer = resendMailer({
    apiKey: 'synthetic-test-key', from: 'reset@veganway.example',
    fetch: async () => new Response('synthetic.recipient@example.test', { status: 403 }),
  });
  await assert.rejects(mailer.send(resetMail('synthetic.recipient@example.test', 'https://veganway.example/reset?token=synthetic'), AbortSignal.timeout(5000)), { message: 'ResetMailFailed' });
});

test('memory mailer records synthetic messages in memory and private JSON files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vw-mail-test-'));
  try {
    const mailer = memoryMailer(directory);
    const mail = resetMail('synthetic.recipient@example.test', 'http://veganway.test/reset?token=synthetic');
    await mailer.send(mail, AbortSignal.timeout(5000));
    assert.deepEqual(mailer.sent, [mail]);
    const files = await readdir(directory);
    assert.equal(files.length, 1);
    assert.deepEqual(JSON.parse(await readFile(join(directory, files[0]), 'utf8')), mail);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('concurrent reset deliveries keep this adapter within the provider call limit', async () => {
  const started: number[] = [];
  const mailer = resendMailer({
    apiKey: 'synthetic-test-key', from: 'reset@veganway.example',
    fetch: async () => {
      started.push(performance.now());
      return Response.json({ id: 'synthetic-id' });
    },
  });
  const mail = resetMail('synthetic.recipient@example.test', 'https://veganway.example/reset?token=synthetic');
  await Promise.all([1, 2, 3].map(() => mailer.send(mail, AbortSignal.timeout(5000))));
  assert.equal(started.length, 3);
  for (let i = 1; i < started.length; i++) assert.ok(started[i] - started[i - 1] >= 100, 'concurrent requests must not bypass call spacing');
});
