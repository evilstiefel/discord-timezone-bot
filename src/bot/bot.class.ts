import { format, utcToZonedTime } from 'date-fns-tz';
import { enUS } from 'date-fns/locale';
import * as Discord from 'discord.js';
import { EMPTY, from, interval, Observable, of, Subscription, iif, timer } from 'rxjs';
import { catchError, filter, map, startWith, switchMap, retryWhen, tap } from 'rxjs/operators';

(enUS as any).code = 'en-US';

export interface IBotConfig {
  token: string;
  reconnect: boolean;
}

export interface IGuildSettings {
  timezones: string[];
}

export class TimezoneBot {
  private config: IBotConfig;
  private client: Discord.Client;
  private storage: any;
  private subscriptions: { id: string, subscription: Subscription }[] = [];
  constructor(config: IBotConfig, storage: any) {
    this.config = config;
    this.client = new Discord.Client();
    this.storage = storage;
    console.log(`Constructor called`);

    this.client.on('ready', () => this.createSubscriptions());
    this.client.on('disconnect', (event: CloseEvent) => this.handleDisconnect());
    this.client.on('message', (message: Discord.Message) => this.handleMessage(message));
    this.client.on('guildCreate', (guild: Discord.Guild) => {
      console.log(`guildCreate called for guild ${guild.name}`);
      this.addGuild(guild)
    });
    this.client.on('guildDelete', (guild: Discord.Guild) => this.removeSubscription(guild.id));
  }

  /**
   * Connect to the discord network, retrying when something goes wrong (like network outage)
   */
  connect() {
    from(this.client.login(this.config.token)).pipe(
      retryWhen((error: Observable<Discord.DiscordAPIError>) => {
        return error.pipe(
          tap(err => console.log(err.message)),
          switchMap(() => iif(() => this.config.reconnect, timer(3000), EMPTY))
        )
      })
    ).subscribe(_ => {
      console.log(`[Timezone Bot] Connected to Discord!`);
    });
  }

  private createSubscriptions() {
    console.log('Client is ready');
    if (this.client) {
      this.client.guilds.forEach(guild => {
        console.log(`Trying to set up timer for guild ${guild.name}`);
        this.subscriptions = this.subscriptions.concat({ id: guild.id, subscription: this.addGuild(guild) });
      })
      if (this.client.guilds.array().length === 0) {
        console.log('[Timezone Bot] The bot has not been invited to any servers yet :(');
      }
    } else {
      console.log(`Client unavailable`);
    }
  }

  private removeSubscription(guildId: string) {
    const subPair = this.subscriptions.find(s => s.id === guildId);
    if (subPair) {
      subPair.subscription.unsubscribe();
      this.subscriptions = this.subscriptions.filter(s => s.id !== guildId);
    }
  }

  private getConfig(guildId: string): Observable<IGuildSettings> {
    return from(this.storage.getItem(guildId) as Promise<IGuildSettings>).pipe(
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

  private updateConfig(guildId: string, tz: string): Observable<IGuildSettings> {
    return this.getConfig(guildId).pipe(
      switchMap(config => {
        config.timezones = config.timezones.filter(zone => zone !== tz).concat(tz);
        return from(this.storage.setItem(guildId, config) as Promise<IGuildSettings>).pipe(
          map(_ => config)
        )
      })
    );
  }

  private addGuild(guild: Discord.Guild): Subscription {
    return from(guild.fetchMember(this.client.user)).pipe(
      filter(member => member.id === this.client.user.id),
      switchMap(member => interval(1000 * 60).pipe(
        startWith(0),
        switchMap(_ => this.getConfig(guild.id)),
        map(config => {
          const { timezones } = config;
          if (timezones.length === 0) {
            return ['Not Configured'];
          }
          try {
            return timezones.map(tz => this.getTimeFromString(tz))
          } catch {
            return ['Invalid timezones'];
          }
        }),
        switchMap(times => from(member.setNickname(times.slice(0, 2).join(', '))).pipe(
          catchError((err: Discord.DiscordAPIError) => {
            console.log(`Error updating nickname on server ${guild.name}`);
            console.log({ msg: err.message });
            return EMPTY;
          }),
          map(result => ({ result, times }))
        )),
        catchError((err: Discord.DiscordAPIError) => {
          console.log(`Error setting up guild ${guild.name} with id ${guild.id}`);
          console.log({ msg: err.message });
          return EMPTY;
        })
      ))
    ).subscribe()
  }

  private handleMessage(message: Discord.Message) {
    if (message.channel.type !== 'text') {
      return;
    }
    const words = message.cleanContent.split(' ');
    if (!message.member) {
      console.log(`Message received without member information, skipping...`);
      console.log({ message });
      return;
    }
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
                  this.getTimeFromString(tz);
                } catch (e) {
                  return of({ title: 'Error', description: `${tz} is not a valid timezone!` });
                }
                return this.updateConfig(message.guild.id, tz).pipe(
                  map(_ => (<Discord.RichEmbed>{
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
                return of(<Discord.RichEmbed>{
                  title: 'Error',
                  description: 'You lack the necessary permissions'
                });
              } else {
                const tz = words[2];
                if (tz) {
                  return from(this.getConfig(message.guild.id)).pipe(
                    switchMap(config => {
                      if (config.timezones.findIndex(zone => zone === tz) !== -1) {
                        config.timezones = config.timezones.filter(zone => zone !== tz);
                        return from(this.storage.setItem(message.guild.id, config)).pipe(
                          map(_ => (<Discord.RichEmbed>{
                            title: 'Success',
                            description: `${tz} removed from config — updates to the nickname take up to one minute`
                          }))
                        )
                      } else {
                        return of(<Discord.RichEmbed>{
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
                return from(this.storage.setItem(message.guild.id, { timezones: [] })).pipe(
                  map(_ => (<Discord.RichEmbed>{
                    title: 'Success',
                    description: 'All timezones have been removed.'
                  }))
                )
              }
            }
            /**
             * When there is no command, show the configured timezones and the respective times
             */
            case undefined: {
              return this.getConfig(message.guild.id).pipe(
                map(config => {
                  if (config.timezones.length === 0) {
                    return (<Discord.RichEmbed>{
                      title: 'Timezone overview',
                      description: 'No timezones configured!'
                    });
                  }
                  return (<Discord.RichEmbed>{
                    title: 'Timezone overview',
                    fields: config.timezones.map(tz => ({
                      inline: true,
                      name: tz,
                      value: this.getTimeFromString(tz)
                    }))
                  });
                })
              )
            }
            /**
             * for everything that isn't a valid command following !time, print this error message
             */
            default:
              return of(<Discord.RichEmbed>{
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

  private handleDisconnect() {
    console.info('Disconnected from discord, unsubscribing from all update-feeds...');
    this.subscriptions.forEach(sub => sub.subscription.unsubscribe());
  }

  private getTimeFromString(tz: string, timeFormat: string = 'h:mmbbbbb zzz'): string {
    return format(utcToZonedTime(new Date(), tz), timeFormat, { locale: enUS, timeZone: tz });
  }
}

export default TimezoneBot;
