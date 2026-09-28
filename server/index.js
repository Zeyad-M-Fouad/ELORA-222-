import express from 'express';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { migrate } from './lib/db.js';
import { seed } from './db/seed.js';
import { errorHandler } from './lib/errors.js';
import { publicRouter } from './routes/public.js';
import { adminRouter } from './routes/admin/index.js';

export function createApp() {
  migrate();
  seed();

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/public', publicRouter);
  app.use('/api/admin', adminRouter);

  // Static: customer storefront at /, admin dashboard at /admin.
  app.use('/admin', express.static(path.join(ROOT, 'public', 'admin')));
  app.use(express.static(path.join(ROOT, 'public')));

  app.get('/admin/*', (req, res) => res.sendFile(path.join(ROOT, 'public', 'admin', 'index.html')));

  app.use(errorHandler);
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  app.listen(config.port, config.host, () => {
    console.log(`Eloria listening on http://${config.host}:${config.port}`);
  });
}
