# Discord Server Backup

This is a Node.js command-line utility to backup all messages in a Discord server to a local SQLite database.

## Getting Started

To get started with this project, follow these steps:

1. Clone the repository to your local machine using `git clone https://github.com/benkaiser/discord-server-backup.git`
2. Install the required dependencies by running `npm install` (or `yarn`)
3. Create a Discord bot and add it to your server following [these instructions](https://discordjs.guide/preparations/setting-up-a-bot-application.html).
4. Create a `.env` file at the root of the project and add your Discord bot's client ID as shown below:
   ```
   DISCORD_BOT_TOKEN=your-discord-bot-client-id
   ```
5. Run the project using `npm start`

## Usage

To backup all messages in a Discord server, type the following command in a server text channel where the bot is present:

```
!backup
```

This will backup all messages in the server to a local SQLite database named `discord.db`. The messages will be stored in the `messages` table of the database. The bot will also store channel and guild data in the `channels` and `guilds` tables, respectively.

## License

This project is licensed under the MIT License.