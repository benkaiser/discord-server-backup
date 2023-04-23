import { Collection, ChannelType, Client, FetchMessagesOptions, Guild, Message, GatewayIntentBits, TextChannel } from 'discord.js';
import dotenv from 'dotenv';
dotenv.config();
import { verbose } from 'sqlite3';
const sqlite3 = verbose();
const db = new sqlite3.Database('discord.db');

// Ensure that the messages table exists
db.run(`CREATE TABLE IF NOT EXISTS messages (
  message_id TEXT PRIMARY KEY,
  author_id TEXT,
  channel_id TEXT,
  content TEXT,
  created_at INTEGER
)`);

// create channels table if not exists
db.run(`
  CREATE TABLE IF NOT EXISTS channels (
    channel_id TEXT PRIMARY KEY,
    channel_name TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    FOREIGN KEY (guild_id) REFERENCES guilds(guild_id)
  )
`);

// create guilds table if not exists
db.run(`
  CREATE TABLE IF NOT EXISTS guilds (
    guild_id TEXT PRIMARY KEY,
    guild_name TEXT NOT NULL
  )
`);

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.login(process.env.DISCORD_BOT_TOKEN);

client.on('ready', () => {
  console.log(`Discord connected!`);
});

client.on('messageCreate', async (message: Message) => {
  if (message.content === '!backup') {
    // Get the guild from the message
    const guild = message.guild;
    if (!guild) {
      message.channel.send("This command must be run in a guild.");
      return;
    }
    const channels: Collection<string, TextChannel > = guild.channels.cache.filter(channel => channel.type === ChannelType.GuildText) as Collection<string, TextChannel>;

    let messageCount = 0;
    for (const channel of channels.values()) {
      const messages = await fetchMessages(channel, 100);
      backupMessages(messages);
      messageCount += messages.length;
    }

    if (messageCount > 0) {
      message.channel.send(`Backed up ${messageCount} messages across ${channels.size} channels.`);
    } else {
      message.channel.send("No messages found in any channels.");
    }
  }
});

async function fetchMessages(channel: TextChannel, limit: number) {
  const messages: Message[] = [];
  let lastId;

  while (true) {
    const options: FetchMessagesOptions = { limit: 100 };
    if (lastId) {
      options.before = lastId;
    }

    const fetchedMessages = await channel.messages.fetch(options);
    const fetchedMessagesArray: Message[] = [...fetchedMessages.values()];
    messages.push(...fetchedMessagesArray);

    if (fetchedMessagesArray.length < 100 || messages.length >= limit) {
      break;
    }

    lastId = fetchedMessagesArray[fetchedMessagesArray.length - 1].id;
  }

  return messages.slice(0, limit);
}

function backupMessages(messages: Message[]) {
  const channelData = new Map(); // to store channel data to be inserted into database
  const guildData = new Map(); // to store guild data to be inserted into database

  for (const message of messages) {
    // get guild and channel data
    const guild: Guild = message.guild!;
    const channel = message.channel as TextChannel;

    // store channel data to be inserted into database
    if (!channelData.has(channel.id)) {
      channelData.set(channel.id, {
        channel_id: channel.id,
        channel_name: channel.name,
        guild_id: guild.id
      });
    }

    // store guild data to be inserted into database
    if (!guildData.has(guild.id)) {
      guildData.set(guild.id, {
        guild_id: guild.id,
        guild_name: guild.name
      });
    }

    const insertQuery = `
      INSERT OR IGNORE INTO messages (message_id, channel_id, author_id, created_at, content)
      VALUES (?, ?, ?, ?, ?)
    `;
    const insertParams = [
      message.id,
      message.channel.id,
      message.author.id,
      message.createdTimestamp,
      message.content
    ];
    db.run(insertQuery, insertParams, err => {
      if (err) {
        console.error(`Error inserting message ${message.id}: ${err.message}`);
      }
    });
  }


  // insert channel data into database
  const channelInsertQuery = `
    INSERT OR IGNORE INTO channels (channel_id, channel_name, guild_id)
    VALUES (?, ?, ?)
  `;
  for (const channel of channelData.values()) {
    const channelInsertParams = [
      channel.channel_id,
      channel.channel_name,
      channel.guild_id
    ];
    db.run(channelInsertQuery, channelInsertParams, err => {
      if (err) {
        console.error(`Error inserting channel ${channel.channel_id}: ${err.message}`);
      }
    });
  }

  // insert guild data into database
  const guildInsertQuery = `
    INSERT OR IGNORE INTO guilds (guild_id, guild_name)
    VALUES (?, ?)
  `;
  for (const guild of guildData.values()) {
    const guildInsertParams = [
      guild.guild_id,
      guild.guild_name
    ];
    db.run(guildInsertQuery, guildInsertParams, err => {
      if (err) {
        console.error(`Error inserting guild ${guild.guild_id}: ${err.message}`);
      }
    });
  }
}