import { Collection, ChannelType, Client, FetchMessagesOptions, Guild, Message, GatewayIntentBits, TextChannel } from 'discord.js';
import dotenv from 'dotenv';
dotenv.config();
import { verbose } from 'sqlite3';
const sqlite3 = verbose();
const db = new sqlite3.Database('discord.db');

interface IChannel {
  channel_id: string;
  channel_name: string;
  guild_id: string;
  last_message_id?: string;
}

interface IMessage {
  message_id: string;
  author_id: string;
  channel_id: string;
  content: string;
  created_at: number;
}

// Ensure that the messages table exists
db.run(`CREATE TABLE IF NOT EXISTS messages (
  message_id TEXT PRIMARY KEY,
  author_id TEXT,
  channel_id TEXT,
  content TEXT,
  attachments TEXT,
  created_at INTEGER
)`);

// create channels table if not exists
db.run(`
  CREATE TABLE IF NOT EXISTS channels (
    channel_id TEXT PRIMARY KEY,
    channel_name TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    last_message_id TEXT,
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
  console.log(message);
  if (message.content === '!backup') {
    const guild = message.guild;
    if (!guild) {
      message.channel.send("This command must be run in a guild.");
      return;
    }
    const channels: Collection<string, TextChannel > = guild.channels.cache.filter(channel => channel.type === ChannelType.GuildText) as Collection<string, TextChannel>;

    let messageCount = 0;
    for (const channel of channels.values()) {
      const lastMessageId = await getLastMessageId(channel.id);
      const messages = await fetchMessages(channel, undefined, lastMessageId);
      backupMessages(messages);
      messageCount += messages.length;
    }

    if (messageCount > 0) {
      await updateLastMessageId();
      message.channel.send(`Backed up ${messageCount} more messages when scanning ${channels.size} channels.`);
    } else {
      message.channel.send("No messages found in any channels.");
    }
  }
});

async function fetchMessages(channel: TextChannel, limit: number | undefined, after?: string) {
  const messages: Message[] = [];
  let lastId: string | undefined;

  while (true) {
    const options: FetchMessagesOptions = { limit: 100 };
    if (lastId) {
      options.before = lastId;
    }
    if (after) {
      options.after = after;
    }

    const fetchedMessages = await channel.messages.fetch(options);
    const fetchedMessagesArray: Message[] = [...fetchedMessages.values()];
    messages.push(...fetchedMessagesArray);

    if (fetchedMessagesArray.length < 100 || (limit !== undefined && messages.length >= limit)) {
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
      INSERT OR IGNORE INTO messages (message_id, channel_id, author_id, created_at, content, attachments)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    const insertParams = [
      message.id,
      message.channel.id,
      message.author.id,
      message.createdTimestamp,
      message.content,
      JSON.stringify([...message.attachments.values()])
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

function updateLastMessageId(): Promise<void> {
  return new Promise((resolve, reject) => {
    db.all(
      `
      SELECT
        channels.channel_id,
        MAX(messages.created_at) AS max_timestamp,
        messages.message_id
      FROM channels
      LEFT JOIN messages
        ON channels.channel_id = messages.channel_id
      GROUP BY channels.channel_id
      `,
      (err, rows: Array<IChannel & IMessage & { max_timestamp: number }>) => {
        if (err) {
          reject(err);
        } else {
          rows.forEach(row => {
            const { channel_id, message_id } = row;
            db.run(
              `
              UPDATE channels
              SET last_message_id = ?
              WHERE channel_id = ?
              `,
              [message_id, channel_id],
              err => {
                if (err) {
                  reject(err);
                }
              }
            );
          });
          resolve();
        }
      }
    );
  });
}


function getLastMessageId(channelId: string): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    db.get('SELECT last_message_id FROM channels WHERE channel_id = ?', [channelId], (err, row: IChannel) => {
      if (err) {
        reject(err);
      } else if (!row) {
        resolve(undefined); // channel not found
      } else {
        resolve(row.last_message_id);
      }
    });
  });
}