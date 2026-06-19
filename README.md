# Anti Mr Scam bot

A Node.js Discord bot that uses OCR and image hashing to analyze attached images and images shown
in Discord link previews. When an image contains a withdrawal keyword and a
successful-status keyword, the bot:

1. Deletes the message.
2. Applies a timeout to the author.
3. Sends a report to the moderation channel.

The bot does not implement or execute bans or kicks.

## Detection rules

The OCR result must contain both of these keyword groups:

- Withdrawal group: `Withdrawal`.
- Successful-status group: `Success`, `Succeeded`, or `Successful`.

The keywords:

- Are case-insensitive.
- Can appear in any order.
- Can appear on different lines or far apart in the image.
- Must appear as complete words.

For example, an image containing `Withdrawal` near the top and `Succeeded`
near the bottom is considered a match.

The bot scans:

- Images uploaded directly as Discord attachments.
- Images and thumbnails displayed in Discord embeds generated from links.
- Images and embeds contained in forwarded message snapshots.
- Every image in a multi-image message.

Each image is evaluated independently. If any single image contains a matching
withdrawal keyword and successful-status keyword, the entire outer message is
deleted and the user who sent or forwarded it is timed out when Discord allows
it.

Discord may generate a link preview shortly after the original message is
created. The bot handles both new-message and message-update events so those
delayed previews are scanned as well. A plain link that Discord does not
convert into an image embed is not downloaded automatically.

## Requirements

- Node.js 20 or newer.

## Discord permissions

### OAuth2 scopes

When generating the bot invitation in the Discord Developer Portal, select:

- `bot` — adds the bot account to the server.
- `applications.commands` — installs the `/setup` slash command. Discord
  includes this scope by default when the `bot` scope is selected, but it
  should remain enabled.

### Bot permissions

Grant the bot these permissions:

| Permission | Where it is required | Purpose |
| --- | --- | --- |
| **View Channels** | Monitored channels and the moderation channel | Receives new messages and accesses the configured moderation channel. |
| **Manage Messages** | Monitored channels | Deletes messages containing a matching image. |
| **Moderate Members** | Server-wide | Applies the configured timeout to the message author. |
| **Send Messages** | Moderation channel | Sends moderation alerts. |
| **Embed Links** | Moderation channel | Sends the formatted moderation report embed. |

The combined permission integer for these five permissions is
`1099511655424`. It can be entered in an OAuth2 bot invitation as the
`permissions` value.

The bot does not require **Administrator**, **Ban Members**, or **Kick
Members**. Granting Administrator is not recommended.

### Role hierarchy

The bot's highest role must be above the roles of users it needs to time out.
Discord does not allow the bot to time out:

- The server owner.
- Members with the **Administrator** permission.
- Members whose highest role is equal to or above the bot's highest role.

If the bot cannot apply a timeout because of role hierarchy or permissions, it
still attempts to delete the message and records the timeout failure in the
moderation alert.

Messages from administrators are still scanned. When an administrator sends a
matching image, the bot attempts to delete the message and always sends the
moderation alert. Discord does not allow the timeout itself to be applied to an
administrator, so the alert records that timeout as failed.

### Administrator permissions

The person running `/setup moderation-channel` or `/setup status` must have
the **Manage Server** permission. The bot itself does not need Manage Server.

### Gateway intent

In the
[Discord Developer Portal](https://discord.com/developers/applications), open
the application, go to **Bot > Privileged Gateway Intents**, and enable
**Message Content Intent**. Discord considers attachments part of message
content; without this intent, the bot receives an empty attachment collection.

## Installation

```bash
pnpm install
cp .env.example .env
```

Set `DISCORD_TOKEN` in `.env`.

## Running the bot

```bash
pnpm start
```

The first OCR run may download the English language data and take longer.
The worker is reused for subsequent images.

## Discord setup

After starting the bot, a server administrator can use Discord's native slash
command interface:

```text
/setup moderation-channel channel:#moderation
```

Discord displays a channel picker for the `channel` option. The selection is
saved separately for each server and persists across restarts in
`data/settings.json`.

Use `/setup status` to view the currently configured moderation channel. The
commands require the **Manage Server** permission and their responses are only
visible to the administrator who runs them.

The bot does not scan images in a server until its moderation channel has been
configured.

## Configuration

| Variable | Required | Default |
| --- | --- | --- |
| `DISCORD_TOKEN` | Yes | — |
| `TIMEOUT_MINUTES` | No | `1440` (24 hours) |
| `MAX_IMAGE_SIZE_MB` | No | `8` |
| `IMAGE_DOWNLOAD_TIMEOUT_MS` | No | `15000` |

Discord limits timeouts to a maximum of 28 days.

## Tests

```bash
pnpm test
```
