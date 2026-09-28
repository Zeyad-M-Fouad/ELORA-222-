import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

/**
 * Email dispatch.
 * - transport 'outbox' (default): writes RFC-822 .eml files under data/outbox so nothing is
 *   lost without SMTP; the file acts as the delivered message.
 * - transport 'smtp': sends through nodemailer using SMTP_URL.
 * Returns { delivered, error } — callers persist delivery state and support retry.
 */
export async function sendEmail({ to, subject, text }) {
  const from = config.emailFrom;
  if (config.emailTransport === 'smtp' && config.smtpUrl) {
    try {
      const nodemailer = (await import('nodemailer')).default;
      const transport = nodemailer.createTransport(config.smtpUrl);
      await transport.sendMail({ from, to, subject, text });
      return { delivered: true };
    } catch (err) {
      return { delivered: false, error: String(err.message || err) };
    }
  }
  try {
    fs.mkdirSync(config.outboxDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeSubject = subject.replace(/[^a-z0-9]+/gi, '-').slice(0, 60).toLowerCase();
    const file = path.join(config.outboxDir, `${stamp}-${safeSubject}.eml`);
    const eml = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      text,
      '',
    ].join('\r\n');
    fs.writeFileSync(file, eml, 'utf8');
    return { delivered: true, outboxFile: file };
  } catch (err) {
    return { delivered: false, error: String(err.message || err) };
  }
}
