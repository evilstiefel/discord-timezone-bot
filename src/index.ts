import TimezoneBot, { IBotConfig } from './bot/bot.class';

const storage: any = require('node-persist');

storage.init().then(() => {
  const config: IBotConfig = {
    reconnect: true,
    token: '<your-bot-token-here>',
  }
  const bot: TimezoneBot = new TimezoneBot(config, storage);
  bot.connect();
});
