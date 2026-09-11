// Boot: config, store, AI, delivery, seed, listen.

import { loadConfig, configHealth } from './config.js';
import { createStore } from './store.js';
import { createAi } from './ai.js';
import { createDelivery } from './delivery.js';
import { createApp } from './app.js';
import { buildSeed, seedSummary } from './seed.js';
import { todayISO } from '../shared/dates.js';

const config = loadConfig(process.env);
const logger = console;

const store = createStore({ dataDir: config.dataDir, logger, firm: config.firm, tz: config.tz });
store.load();

const ai = createAi({ config, logger });
const delivery = createDelivery({ config, logger });

async function main() {
  const data = store.read();
  if (config.seedDemo && !data.deals.length && !data.partners.length) {
    const seeded = buildSeed({ config, today: todayISO(config.tz) });
    await store.replace(seeded);
    logger.info(`[pulse] demo seeded: ${JSON.stringify(seedSummary(store.read()))}`);
  }

  const app = createApp({ config, store, ai, delivery, logger });
  const server = app.listen(config.port, () => {
    const health = configHealth(config);
    logger.info(`\nPARTNER PULSE is up on http://localhost:${config.port}`);
    logger.info(`  timezone ${config.tz} - today is ${todayISO(config.tz)}`);
    logger.info(`  AI: ${health.aiEnabled ? `${config.ai.model} (effort ${config.ai.effort})` : 'offline mode, deterministic fallbacks'}`);
    logger.info(`  delivery: sms=${config.sms.provider} email=${config.email.provider}`);
    logger.info(`  data: ${store.filePath}`);
    for (const warning of health.warnings) logger.warn(`  ! ${warning}`);
    logger.info('');
  });

  const shutdown = (signal) => {
    logger.info(`[pulse] ${signal} received, finishing writes`);
    server.close(async () => {
      await store.idle();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 4000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('[pulse] failed to start:', err);
  process.exit(1);
});
