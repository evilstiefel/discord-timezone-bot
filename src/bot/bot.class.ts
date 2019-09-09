import * as Discord from 'discord.js';
import { Subscription, from, interval, Observable, EMPTY, of, defer } from 'rxjs';
import { filter, switchMap, map, catchError, delay, retryWhen, tap } from 'rxjs/operators';
import { format } from 'date-fns-tz';
import { enUS } from 'date-fns/locale';
import { utcToZonedTime } from 'date-fns-tz';
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
  private subscriptions: Subscription[] = [];
  constructor(config: IBotConfig, storage: any) {
    this.config = config;
    this.client = new Discord.Client();
    this.storage = storage;
    console.log(`Constructor called`);
  }

  connect() {
    this.client.login(this.config.token).then(() => {
      console.log(`Connected to discord successfully!`);
    }).catch((err) => {
      console.log(`Error connecting to discord`);
      console.log({ err });
    });
    this.client.on('ready', () => this.createSubscriptions())
    this.client.on('disconnect', (event: CloseEvent) => this.handleDisconnect())
    this.client.on('message', (message: Discord.Message) => this.handleMessage(message));
    this.client.on('guildCreate', (guild: Discord.Guild) => this.addGuild(guild))
  }

  private createSubscriptions() {
    console.log('Client is ready');
    if (this.client) {
      this.client.guilds.forEach(guild => {
        this.subscriptions = this.subscriptions.concat(this.addGuild(guild));
      })
    } else {
      console.log(`Client unavailable`);
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
          tap(_ => {
            console.log(`Set-up complete for guild ${guild.name}, timezones: ${times.join(', ')}`)
          }),
          catchError(err => {
            console.log(`Error updating nickname on server ${guild.name}`);
            console.log({ err });
            return EMPTY;
          })
        )),
        catchError(err => {
          console.log(`Error setting up guild ${guild.name} with id ${guild.id}`);
          console.log({ err });
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
                    description: 'Timezones reset to default value of PST'
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
                  let description = (config as IGuildSettings).timezones.map(tz => `${tz}: ${format(utcToZonedTime(new Date(Date.now()), tz), 'h:mmbbbbb zzz', { locale: enUS, timeZone: tz })}`).join('\n');
                  if (config.timezones.length === 0) {
                    description = 'No timezones configured!'
                  }
                  return (<Discord.RichEmbed>{
                    title: 'Timezone overview',
                    fields: config.timezones.map(tz => ({
                      inline: true,
                      name: tz,
                      value: this.getTimeFromString(tz)}))
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
    this.subscriptions.forEach(sub => sub.unsubscribe());
    if (this.config.reconnect) {
      this.connect();
    }
  }

  private getTimeFromString(tz: string): string {
    return format(utcToZonedTime(new Date(), tz), 'h:mmbbbbb zzz', { locale: enUS, timeZone: tz });
  }
}

export default TimezoneBot;
