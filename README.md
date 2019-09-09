# Description
This bot enables some helpful functions when your users have different timezones. You can add an arbitrary number of zones, for which the bot will provide the current time whenever a user asks for it (`!time` command).

# Installation
Install all packages by running `npm ci` and then compile the bot via `tsc` (Typescript 3.6 is recommended). In the output folder _dist_, run index.js via your node installation. Note that it it important where you run your node executable. I'd recommend starting it from project root, e.g. `node dist/index.js`, since the folder you start the process from is the one where the storage-folder is created and the bot looks for the `.env` file, as follows:

Before running the bot, please create a file called *.env* in the project root (or wherever you want to base your bot-related folders). The contents should be as follows:

~~~bash
API_TOKEN=<YOUR-TOKEN-HERE>
~~~

Obviously, replace the token with your bot API-key from Discord.

# Usage
When you join the bot to your server, there are no default timezones configured. You can add timezones via the `!time add <timezone>` command. Note that all timezones follow the IANA specification as shown on [https://en.wikipedia.org/wiki/List_of_tz_database_time_zones](Wikipedia) (column _TZ database name_). You can also remove timezones via `!time remove <timezone>`.

All commands are listed via `!time help`. Note that only admins can change the settings for the bot, while all users have access to the list command.

Additionally, the first two time-zones specified work as the placeholder for the nickname of the bot, which are updated every minute. For this to work, the bot needs the permission to change its nickname.
