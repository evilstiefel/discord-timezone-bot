import { format, utcToZonedTime } from 'date-fns-tz';
import { enUS } from 'date-fns/locale';
import * as Discord from 'discord.js';
import { concat, EMPTY, from, interval, Observable, of, Subscription } from 'rxjs';
import { catchError, delay, finalize, map, mapTo, retryWhen, startWith, switchMap } from 'rxjs/operators';
import TimezoneBot, { IBotConfig } from './bot/bot.class';

const storage: any = require('node-persist');

storage.init().then(() => {
  const config: IBotConfig = {
    reconnect: true,
    token: '***REMOVED***',
  }
  const bot: TimezoneBot = new TimezoneBot(config, storage);
  bot.connect();
});
