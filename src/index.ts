import TimezoneBot, { IBotConfig } from './bot/bot.class';
import { config } from 'dotenv';

const storage: any = require('node-persist');
const settings = config().parsed;

if (settings === undefined || !settings.hasOwnProperty('API_TOKEN')) {
  console.error('No API_TOKEN in .env present, aborting...');
} else {
  storage.init().then(() => {
    const config: IBotConfig = {
      reconnect: true,
      token: settings.API_TOKEN,
    }
    const bot: TimezoneBot = new TimezoneBot(config, storage);
    bot.connect();
  });
}
