import * as Discord from "discord.js";
import { format } from "date-fns";
import { interval } from "rxjs";
import { startWith } from "rxjs/operators";
import { de } from "date-fns/locale";

const client: Discord.Client = new Discord.Client();

let testChannel: Discord.TextChannel | undefined;

client.on("ready", () => {
  client.guilds.forEach(guild => {
    guild.fetchMember(client.user).then(member => {
      if (member.id === client.user.id) {
        interval(1000 * 60).pipe(
          startWith(0),
        ).subscribe(_ => {
          console.log(`Updating time...`);
          member.setNickname(`${format(new Date(Date.now()), "EEEEEE HH:mm (OOO)", { locale: de})}`);
        });
      }
    });
    console.log(`Connected to server: ${guild.name}`);
    guild.channels.forEach(channel => {
      console.log(`-- ${channel.name} (${channel.type}) - ${channel.id}`);
      if (channel.name === "test" && channel.type === "text") {
        testChannel = channel as Discord.TextChannel;
        testChannel.send("Time-service is back online!")
          .catch(_ => console.log(`Error sending message to channel.`));
      }
    });
  });
});

const secret_token: string = "***REMOVED***";

client.login(secret_token);