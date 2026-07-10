module.exports = {
  PORT: process.env.PORT || 3000,
  JWT_SECRET: process.env.JWT_SECRET || 'dev-only-secret-change-in-production',
  JWT_EXPIRY: '8h',
  // libSQL/Turso connection. Local dev/tests use a file; production sets DATABASE_URL to the
  // Turso database URL (libsql://...) plus DATABASE_AUTH_TOKEN.
  DB_URL: process.env.DATABASE_URL || process.env.DB_URL || 'file:pharmatrack.db',
  DB_AUTH_TOKEN: process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || '',
};
