const express = require('express');
const path = require('path');
const { PORT } = require('./config');
const { ready } = require('./db/connection');
const { requireAuth } = require('./middleware/auth');

const app = express();
app.use(express.json({ limit: '10mb' }));

// Ensure schema + seed are applied before any request runs. ready() caches its promise,
// so this is a no-op after the first request (works for a long-lived server and for
// serverless cold starts on Vercel).
app.use((req, res, next) => { ready().then(() => next()).catch(next); });

// Tiny request log (structured logging comes in Phase 2).
app.use((req, res, next) => {
  const t = Date.now();
  res.on('finish', () => console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - t}ms`));
  next();
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', app: 'Pharos Marketing Effectiveness Platform' }));

app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api', requireAuth, require('./routes/masters.routes'));
app.use('/api/activities', requireAuth, require('./routes/activities.routes'));
app.use('/api/sales', requireAuth, require('./routes/sales.routes'));
app.use('/api/da', requireAuth, require('./routes/da.routes'));
app.use('/api', requireAuth, require('./routes/analytics.routes'));
app.use('/api', requireAuth, require('./routes/misc.routes'));

// Static SPA
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

// Central error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Only bind a port when run directly (local dev / tests). On Vercel the app is imported
// by api/index.js and invoked as a serverless function, so we must NOT call listen there.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Pharos Marketing Effectiveness Platform running at http://localhost:${PORT}`);
  });
}

module.exports = app;
