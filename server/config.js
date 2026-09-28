import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = process.env.ELORIA_DATA_DIR || path.join(ROOT, 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });

export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  dbPath: process.env.ELORIA_DB || path.join(DATA_DIR, 'eloria.db'),
  outboxDir: path.join(DATA_DIR, 'outbox'),
  sessionTtlDays: 14,
  // Admin bootstrap (seeded only if the user does not exist yet).
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'eloria-admin',
  // Email: 'outbox' writes .eml files under data/outbox (safe default, no SMTP needed).
  // 'smtp' uses SMTP_URL with nodemailer (e.g. smtps://user:pass@smtp.host:465).
  emailTransport: process.env.EMAIL_TRANSPORT || 'outbox',
  smtpUrl: process.env.SMTP_URL || '',
  emailFrom: process.env.EMAIL_FROM || 'Eloria Orders <orders@eloria.example>',
  // Order-code alphabet excludes ambiguous characters.
  codeAlphabet: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',
};
