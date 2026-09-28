import { all, get, run } from '../lib/db.js';

export function getSetting(key, fallback = '') {
  const row = get('SELECT value FROM settings WHERE key = ?', key);
  return row ? row.value : fallback;
}

export function getAllSettings() {
  const out = {};
  for (const row of all('SELECT key, value FROM settings')) out[row.key] = row.value;
  return out;
}

export function setSettings(entries) {
  for (const [key, value] of Object.entries(entries)) {
    run(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      key, String(value),
    );
  }
  return getAllSettings();
}

/** Contact information exposed to the public website (WEB-01). */
export function publicSettings() {
  const s = getAllSettings();
  return {
    business_name: s.business_name || 'Eloria',
    business_email: s.business_email || '',
    business_phone: s.business_phone || '',
    whatsapp_number: s.whatsapp_number || '',
    business_address: s.business_address || '',
    business_hours: s.business_hours || '',
    currency: s.currency || 'EGP',
  };
}
