# Axiom Twitter Discord Bot

A Discord bot that sends tweets from people followed on Axiom to a Discord channel.

## Features

- Fetches tweets from the Axiom Twitter API
- Posts tweets to a specified Discord channel in real-time
- Supports tweets with text, images, and other media
- Avoids duplicate tweets by tracking processed tweet IDs
- Beautiful embedded messages with user avatars and tweet metadata

## Setup

### Prerequisites

- Node.js 16.x or higher
- A Discord account and a registered Discord bot
- Access to Axiom Twitter feed

### Installation

1. Clone this repository:
   ```
   git clone <repository-url>
   cd axiom-twitter-discord-bot
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Copy the example environment file and fill in your credentials:
   ```
   cp .env.example .env
   ```

4. Edit the `.env` file and add your:
   - Discord bot token
   - Discord channel ID
   - Axiom cookies for authentication

### Getting the Axiom Cookies

To get the cookies needed for authenticating with the Axiom API:

1. Login to your Axiom account in a web browser
2. Open the Developer Tools (F12 or right-click > Inspect)
3. Go to the Network tab
4. Visit any page on Axiom that requires authentication
5. Select any request to the Axiom domain
6. In the request headers, find the "Cookie" header
7. Copy the entire cookie string and paste it in your `.env` file

### Creating a Discord Bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to the "Bot" tab
4. Click "Add Bot"
5. Copy the token and add it to your `.env` file
6. Under "Privileged Gateway Intents", enable the necessary intents (at minimum, "Server Members Intent" and "Message Content Intent")
7. Use the following URL to invite the bot to your server (replace `YOUR_CLIENT_ID` with your bot's client ID):
   ```
   https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=274877910016&scope=bot
   ```

## Running the Bot

Start the bot with:

```
npm start
```

For development with auto-restart on file changes:

```
npm run dev
```

## Configuration

You can configure the following options in the `.env` file:

- `DISCORD_TOKEN`: Your Discord bot token
- `DISCORD_CHANNEL_ID`: The ID of the channel where tweets will be posted
- `AXIOM_COOKIES`: The cookies used for authentication with Axiom
- `AXIOM_TWITTER_API_URL`: The URL for the Axiom Twitter API
- `POLLING_INTERVAL`: How often to check for new tweets (in milliseconds)

## Troubleshooting

- If the bot is not sending tweets, check your Axiom cookies - they may have expired
- Make sure the bot has permission to send messages in the specified channel
- Check the console logs for any error messages

## License

This project is licensed under the MIT License - see the LICENSE file for details. 