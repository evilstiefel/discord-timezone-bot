import { format, utcToZonedTime } from 'date-fns-tz';
import { enUS } from 'date-fns/locale';
import * as Discord from 'discord.js';
import { concat, EMPTY, from, interval, Observable, of, Subscription } from 'rxjs';
import { catchError, delay, finalize, map, mapTo, retryWhen, startWith, switchMap } from 'rxjs/operators';

const storage: any = require('node-persist');
(enUS as any).code = 'en-US';

interface IGuildSettings {
  timezones: string[];
}

const ratelimits: string[] = [];

const client: Discord.Client = new Discord.Client();

const subscriptions: Subscription[] = [];

type initializeFn = () => void;
type messageFn = (message: Discord.Message) => void;

const getConfig = (id: string): Observable<IGuildSettings> => {
  return from(storage.getItem(id) as Promise<IGuildSettings>).pipe(
    map(config => {
      if (config === undefined) {
        return ({ timezones: [] });
      }
      if (config.hasOwnProperty('timezones')) {
        return config;
      } else {
        return ({ timezones: [] });
      }
    })
  );
}

const updateConfig = (server: string, tz: string): Observable<IGuildSettings> => {
  return getConfig(server).pipe(
    switchMap(config => {
      if (config) {
        config.timezones = config.timezones.filter(zone => zone !== tz).concat(tz);
      } else {
        config = { timezones: [tz] };
      }
      return from(storage.setItem(server, config) as Promise<any>).pipe(
        map(_ => config as IGuildSettings)
      )
    }),
  )
}

const updateNickname = (guild: Discord.Guild, client: Discord.Client, config: IGuildSettings): Observable<boolean> => {
  return of(guild).pipe(
    switchMap(guild => guild.fetchMember(client.user)),
    mapTo(true)
  )
}

/**
 * This handles the message commands using !time
 */
const handleMessage = (message: Discord.Message): void => {
  if (message.channel.type !== 'text') {
    return;
  }
  const words = message.cleanContent.split(' ');
  const permissions = new Discord.Permissions(message.member.permissions.bitfield);
  of(words).pipe(
    switchMap(words => {
      if (words[0] === '!time') {
        switch (words[1]) {
          /**
           * When the user requests help, list all available commands and print a short description of each
           */
          case 'help': {
            return of({
              title: 'Commands available',
              description: `
              !time — returns a list of all timezones configured with the current local time
              !time reset — removes all saved timezones
              !time add <timezone> — <timezone> refers to a timezone description, e.g. Europe/Berlin or America/Los_Angeles
              !time remove <timezone> — removes <timezone> from the configuration, if present

              Note that only the first two timezones are shown in the nickname of the bot in the client list
              `
            })
          }
          /**
           * Command to add a single timezone to the server, must be IANA style.
           * Can only be used as an admin
           */
          case 'add': {
            if (!permissions.has(['ADMINISTRATOR'])) {
              return of({
                title: 'Error',
                description: 'You lack the necessary permissions'
              });
            }
            const tz = words[2];
            if (tz) {
              try {
                format(utcToZonedTime(new Date(Date.now()), tz), 'h:mmbbbbb zzz', { locale: enUS, timeZone: tz })
              } catch (e) {
                return of({ title: 'Error', description: `${tz} is not a valid timezone!` });
              }
              return updateConfig(message.guild.id, tz).pipe(
                map(_ => ({
                  title: 'Success',
                  description: `The timezone ${tz} was added successfully — updates to the nickname take up to one minute`,
                }))
              );
            }
          }
          /**
           * Command to remove a single timezone from the server's config.
           * Can only be used as an admin
           */
          case 'remove': {
            if (!permissions.has('ADMINISTRATOR')) {
              return of({
                title: 'Error',
                description: 'You lack the necessary permissions'
              });
            } else {
              const tz = words[2];
              if (tz) {
                return from(getConfig(message.guild.id)).pipe(
                  switchMap(config => {
                    if (config.timezones.findIndex(zone => zone === tz) !== -1) {
                      config.timezones = config.timezones.filter(zone => zone !== tz);
                      return from(storage.setItem(message.guild.id, config)).pipe(
                        map(_ => ({
                          title: 'Success',
                          description: `${tz} removed from config — updates to the nickname take up to one minute`
                        }))
                      )
                    } else {
                      return of({
                        title: 'Error/Success',
                        description: `${tz} was never configured in the first place`
                      })
                    }
                  })
                )
              }
            }
          }
          /**
           * When the user is an admin, he can reset all stored configuration, removing all timezones
           */
          case 'reset': {
            if (!permissions.has('ADMINISTRATOR')) {
              return of({
                title: 'Error',
                description: 'You lack the necessary permissions',
              })
            } else {
              return from(storage.setItem(message.guild.id, { timezones: [] })).pipe(
                map(_ => ({
                  title: 'Success',
                  description: 'Timezones reset to default value of PST'
                }))
              )
            }
          }
          /**
           * When there is no command, show the configured timezones and the respective times
           */
          case undefined: {
            if (ratelimits.includes(message.guild.id)) {
              return EMPTY;
            } else {
              ratelimits.push(message.guild.id);
              return getConfig(message.guild.id).pipe(
                map(config => {
                  let description = (config as IGuildSettings).timezones.map(tz => `${tz}: ${format(utcToZonedTime(new Date(Date.now()), tz), 'h:mmbbbbb zzz', { locale: enUS, timeZone: tz })}`).join('\n');
                  if (description.length === 0) {
                    description = 'No timezones configured!'
                  }
                  return ({
                    title: 'Timezone overview',
                    description
                  });
                }),
                finalize(() => setTimeout(() => ratelimits.splice(ratelimits.indexOf(message.guild.id), 1), 1000))
              )
            }
          }
          /**
           * for everything that isn't a valid command following !time, print this error message
           */
          default:
            return of({
              title: 'Invalid command',
              description: 'Sorry, the command was not recognized'
            });
        }
      } else {
        return EMPTY;
      }
    }),
    switchMap(response => message.channel.send(new Discord.RichEmbed(response))),
    catchError(err => {
      console.log({ err });
      return EMPTY;
    })
  ).subscribe()
}

/**
 * When the client connects to discord, load all configs for joined servers and
 * create the interval to update the nickname every minute.
 *
 * This means that after joining the bot to another server, it needs to be restarted,
 * otherwise it doesn't know about new guilds it was joined to.
 */
client.on('ready', () => {
  client.guilds.forEach(guild => {
    guild.fetchMember(client.user).then(member => {
      if (member.id === client.user.id) {
        subscriptions.push(interval(1000 * 60).pipe(
          startWith(0),
          switchMap(_ => getConfig(guild.id)),
          map(config => {
            let timezoneStrings: string[] = [];
            let timezones = [];
            if (config) {
              timezoneStrings = (config).timezones;
            }
            if (timezoneStrings.length === 0) {
              return ['Not configured'];
            }
            try {
              timezones = timezoneStrings.map(tz => format(utcToZonedTime(new Date(Date.now()), tz), 'h:mmbbbbb zzz', { locale: enUS, timeZone: tz }));
            } catch {
              timezones = ['Invalid timezones'];
            }
            return timezones;
          }),
          switchMap(timeZones => concat(
            from(member.setNickname(timeZones.slice(0, 2).join(', '))).pipe(
              catchError(err => {
                console.log(`Error updating nickname!`);
                console.log({ err });
                return EMPTY;
              })
            ),
          )),
        ).subscribe());
      }
    });
    console.log(`Connected to server: ${guild.name}`);
    guild.channels.forEach(channel => {
      console.log(`-- ${channel.name} (${channel.type}) - ${channel.id}`);
    });
  });
});


/**
 * Set up the callback-function when the bot receives a message in chat
 */
client.on('message', handleMessage);

client.on('disconnect', () => {
  subscriptions.forEach(sub => sub.unsubscribe());
  initializeBot();
});

const initializeBot: initializeFn = () => {
  const secret_token: string = '***REMOVED***';
  from(client.login(secret_token)).pipe(
    retryWhen(errors => {
      console.log(`Error connecting, delaying retry by 3 seconds...`);
      return errors.pipe(delay(3000));
    }),
  ).subscribe();
};
storage.init().then(() => {
  console.log(`Storage initialized`);
  initializeBot();
});