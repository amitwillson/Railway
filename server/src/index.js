import config from './config.js';
import { createApp } from './app.js';
import { getDb, closeDb } from './db/index.js';
import { startScheduler, stopScheduler, checkpoint } from './lib/scheduler.js';

const app = createApp();

const server = app.listen(config.port, config.host, () => {
  const { port, host, env } = config;
  console.info(`\n  Railway Inspection & Compliance Management System`);
  console.info(`  API      http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/api`);
  console.info(`  Health   http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/api/health`);
  console.info(`  Database ${config.dbFile}`);
  console.info(`  Uploads  ${config.uploadDir}`);
  console.info(`  Mode     ${env}\n`);
  const counts = getDb()
    .prepare(
      `SELECT (SELECT COUNT(*) FROM stations) AS stations,
              (SELECT COUNT(*) FROM inspection_items) AS items,
              (SELECT COUNT(*) FROM users) AS users,
              (SELECT COUNT(*) FROM observations) AS observations`
    )
    .get();
  if (counts.users === 0) {
    console.warn('  No users found. Run "npm run seed --workspace server" to load master and demo data.\n');
  } else {
    console.info(
      `  Master data: ${counts.stations} stations, ${counts.items} inspection items, ` +
        `${counts.users} users, ${counts.observations} observations\n`
    );
  }
  startScheduler();
});

const shutdown = (signal) => {
  console.info(`\n[${signal}] shutting down`);
  stopScheduler();
  server.close(() => {
    checkpoint();
    closeDb();
    process.exit(0);
  });
  // Never hang forever on a stuck connection.
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
