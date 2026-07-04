# D5 spam guard bot

A Node.js Discord bot that uses OCR and image hashing to analyze attached images and images shown
in Discord link previews. When an image contains a withdrawal keyword and a
payout keyword, the bot:

1. Deletes the message.
2. Applies a timeout to the author.
3. Sends a report to the moderation channel.

The bot does not implement or execute bans or kicks.

Invite the bot to your server:

[Discord OAuth2 invite](https://discord.com/oauth2/authorize?client_id=1517463038465282179)

## Detection rules

The OCR result must contain both of these keyword groups:

- Withdrawal group: `Withdrawal`.
- Payout group: `Success`, `Succeeded`, `Successful`, `Successfully`, or `USDT` in uppercase.

The keywords:

- Are case-insensitive.
- Can appear in any order.
- Can appear on different lines or far apart in the image.
- Must appear as complete words.

You can tune the detection sensitivity per server with `/setup paranoia`:

- `low` - exact visual hash match only.
- `medium` - visual hash match or OCR text containing `Withdrawal`, `Succeeded`, and `USDT`.
- `high` - visual hash match or OCR text containing `Withdrawal` and either `Succeeded` or `USDT`.

The default paranoia level is `high`.

Server admins can also:

- Set a custom timeout with `/setup timeout`.
- Exclude roles from detection with `/setup excluded-role add`, `/setup excluded-role remove`, and `/setup excluded-role list`.

For example, an image containing `Withdrawal` near the top and `Succeeded`
near the bottom is considered a match.

The bot scans:

- Images uploaded directly as Discord attachments.
- Images and thumbnails displayed in Discord embeds generated from links.
- Images and embeds contained in forwarded message snapshots.
- Every image in a multi-image message.

Each image is evaluated independently. If any single image contains a matching
withdrawal keyword and payout keyword, the entire outer message is
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

Messages from server administrators are ignored completely. The bot does not
scan them, delete them, or time them out.

Members with an excluded role are also ignored completely.

### Administrator permissions

The person running `/setup moderation-channel`, `/setup paranoia`, or
`/setup status` must have the **Manage Server** permission. The bot itself
does not need Manage Server.

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

### Server configuration

Server administrators with **Manage Server** can configure the bot with:

- `/setup moderation-channel` to choose where alerts are sent.
- `/setup paranoia` to set the per-server detection sensitivity.
- `/setup timeout` to set the per-server timeout.
- `/setup excluded-role ...` to manage ignored roles.
- `/setup status` to review the current configuration.

## Docker

The included image uses `node:22-alpine`, installs production dependencies
only, and runs the bot as the non-root `node` user.

Create the environment file before starting the container:

```bash
cp .env.example .env
```

Set `DISCORD_TOKEN` in `.env`, then build and start the bot:

```bash
docker compose up -d --build
```

View its logs:

```bash
docker compose logs -f bot
```

Stop the bot:

```bash
docker compose down
```

The Compose configuration creates two named volumes:

- `bot-data` stores the per-server moderation channel configuration.
- `ocr-cache` stores the downloaded Tesseract English language data.

Both volumes survive container recreation and image upgrades. Running
`docker compose down -v` deletes them, including the saved moderation channel
configuration.

### Ports

No ports need to be exposed or published. The bot connects outward to the
Discord Gateway over HTTPS and WebSocket connections. It does not run an HTTP
server or accept inbound network traffic.

The relevant Compose configuration intentionally contains no `ports` section:

```yaml
services:
  bot:
    build: .
    restart: unless-stopped
    env_file:
      - .env
    volumes:
      - bot-data:/app/data
      - ocr-cache:/app/tessdata
```

## Automatic deployment with GitHub Actions

The workflow in `.github/workflows/deploy.yml` runs on every push to `main`
and can also be started manually.

It performs these steps:

1. Installs dependencies and runs the test suite.
2. Builds the Docker image.
3. Publishes `latest` and commit-specific tags to GitHub Container Registry.
4. Optionally connects to a server over SSH, pulls the exact commit image, and
   restarts the bot with Docker Compose.

The published image name is:

```text
ghcr.io/dh-555/spam-guard-bot
```

### Server preparation

Install Docker Engine and the Docker Compose plugin on the destination server.
Create the deployment directory and its environment file once:

```bash
sudo mkdir -p /opt/d5-spam-guard-bot
sudo chown "$USER":"$USER" /opt/d5-spam-guard-bot
cd /opt/d5-spam-guard-bot
nano .env
```

The server-side `.env` must contain at least:

```env
DISCORD_TOKEN=your_real_bot_token
```

GitHub Actions deliberately does not overwrite this file.

The SSH user must be able to run `docker` and `docker compose` without an
interactive password prompt. No inbound application ports are required; only
SSH access is needed for deployment.

### GitHub Actions variables

Create these variables under **Settings > Secrets and variables > Actions**:

| Variable | Location | Required | Example |
| --- | --- | --- | --- |
| `ENABLE_DEPLOY` | Repository variable | Yes | `true` |
| `DEPLOY_PATH` | Repository or `production` environment variable | No | `/opt/d5-spam-guard-bot` |
| `DEPLOY_PORT` | Repository or `production` environment variable | No | `22` |

If `ENABLE_DEPLOY` is not exactly `true`, the workflow still tests and
publishes the image but skips the SSH deployment.

### GitHub Actions secrets

Create these secrets:

| Secret | Purpose |
| --- | --- |
| `DEPLOY_HOST` | Server hostname or IP address. |
| `DEPLOY_USER` | SSH username. |
| `DEPLOY_SSH_KEY` | Private SSH key used only for deployment. |
| `GHCR_USERNAME` | GitHub username used by the server to pull the image. |
| `GHCR_PULL_TOKEN` | Personal access token (classic) with `read:packages`. |

The corresponding public SSH key must be added to
`~/.ssh/authorized_keys` for `DEPLOY_USER`.

For a private GHCR package, `GHCR_PULL_TOKEN` needs permission to read
packages. If the package is made public, server-side registry authentication
can be removed from the workflow.

## Legal pages and GitHub Pages

The `docs/` directory contains a static legal site with:

- Privacy Policy: `docs/privacy.html`
- Terms of Service: `docs/terms.html`
- Legal landing page: `docs/index.html`

To publish it with GitHub Pages:

1. Open the repository on GitHub.
2. Go to **Settings > Pages**.
3. Under **Build and deployment**, select **Deploy from a branch**.
4. Select the `main` branch and the `/docs` folder.
5. Save the configuration.

The expected URLs are:

```text
https://dh-555.github.io/Anti-Mr-Scam-bot/
https://dh-555.github.io/Anti-Mr-Scam-bot/privacy.html
https://dh-555.github.io/Anti-Mr-Scam-bot/terms.html
```

The included policies are project-specific templates, not legal advice. The
person or organization operating the Bot should review them for the applicable
jurisdiction and deployment practices.

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

If a moderation channel has not been configured yet, the bot still scans and
moderates matching images. In that case, it deletes the message, applies the
timeout when possible, and posts a short notice in the same channel telling
admins to configure `/setup moderation-channel` for full alerts and details.

## Configuration

| Variable | Required | Default |
| --- | --- | --- |
| `DISCORD_TOKEN` | Yes | — |
| `TIMEOUT_MINUTES` | No | `1440` (24 hours) |
| `MAX_IMAGE_SIZE_MB` | No | `8` |
| `MAX_IMAGE_PIXELS` | No | `16000000` |
| `IMAGE_DOWNLOAD_TIMEOUT_MS` | No | `15000` |
| `OCR_CACHE_PATH` | No | `tessdata` |
| `OCR_EFFORT` | No | `high` |
| `VISUAL_REFERENCE_MANIFEST_PATH` | No | `generated/visual-reference-manifest.json` |
| `VISUAL_MATCH_THRESHOLD` | No | `6` |

`OCR_EFFORT` can be `low`, `medium`, or `high`. Higher effort tries more
preprocessing passes and crops, which improves blurry screen photos at the cost
of slower OCR.

Reference images live in the repository under `visual-references/`. The build
step hashes them with a perceptual hash and writes the manifest to
`generated/visual-reference-manifest.json`. At runtime, the bot reads only that
manifest. Lower thresholds are stricter; `0` means exact hash equality.

To regenerate the manifest locally:

```bash
pnpm build:visual-references
```

With the current reference folder, startup logs should include:

```text
[Visual matching] Loaded 19 reference hash(es).
```

Discord limits timeouts to a maximum of 28 days.

## Tests

```bash
pnpm test
```
