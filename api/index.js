// Vercel serverless entry point. The Express app is defined in server/index.js and
// exported (it only calls listen() when run directly). Vercel's @vercel/node builder
// wraps this exported handler and dispatches every incoming request to it.
module.exports = require('../server/index.js');
