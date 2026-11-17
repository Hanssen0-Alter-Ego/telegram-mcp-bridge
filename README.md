# Telegram MCP: self-hosted Cloudflare Worker

Explicit message reading and authorized sending; no wake/background polling, no instruction execution from messages. Config files only, no management UI. Dedicated Telegram bot and dedicated database required.

## What is and is not ready

This standalone entry point validates per-client credentials before deriving the caller identity. Public `oai-authenticated-*` headers are ignored. NEVER deploy `worker/index.js` directly: its identity contract is Sites-only. Wrangler uses `worker/standalone.js`.

Tested locally with Node mock HTTP and SQLite. Not deployed/tested on your Cloudflare account or against a real Telegram bot. There is no OAuth server. Two transports authenticate against the same per-client key: Bearer on `/mcp`, and a fixed private capability URL `/mcp/<client-key>` for a private plugin, following Token Vault's packaging pattern. `auth: none` in the private plugin means the platform adds no credential; it does NOT disable server authentication. This does not depend on the Vault service being online. Native Dot end-to-end installation remains to be verified.

## Deploy yourself

Use a current Node LTS supporting node:sqlite for tests and official Wrangler v4.

```sh
npm test
npx wrangler@4 login
npx wrangler@4 d1 create telegram-mcp
```

Copy returned database_id into wrangler.jsonc. Review the account, Worker name and costs. Config starts disabled with no destinations. Keep it disabled until all steps and client authentication are checked.

```sh
npx wrangler@4 d1 migrations apply telegram-mcp --remote
npx wrangler@4 deploy
npx wrangler@4 secret put TELEGRAM_BOT_TOKEN
npx wrangler@4 secret put MCP_CLIENT_OWNER
```

At the first secret prompt, paste the dedicated bot's BotFather token locally. At the second, paste a freshly generated 32-byte base64url random key from a password manager or your own terminal. No secrets go into chat, Git, wrangler.jsonc, screenshots, command arguments, or exported logs. Keep the client key in your client's secure credential store. These are DIFFERENT secrets; never use the Telegram token as the MCP credential.

Client key must be 43–128 base64url characters. Generate a separate key per client and map its secret environment name in config/clients.js. Secret names use MCP_CLIENT_ prefix. Replacing/deleting a secret revokes that client's previous key. Never share one key across people who need distinct group access.

## Configure access

Edit config/destinations.js. Example:

```js
personal: {
  chatId: '123456789',
  description: 'My private bot chat',
  purpose: 'My requested messages and notifications',
  canRead: true,
  canSend: true,
  allowedCallerIds: ['owner']
}
```

Use the actual numeric chat ID, not a username; optional threadId targets exactly one topic. IDs and purposes are non-secret configuration. Add only chats the owner has authorized. After checking permissions, set enabled:true and run `npx wrangler@4 deploy`. This does not send messages or poll automatically.

For multiple users, add a distinct principal/secret in config/clients.js, then list that principal only on approved destinations. This authenticates MCP clients, NOT people who send Telegram messages. Sharing the same key means sharing the same permissions. No Telegram group member gains authority over the assistant by sending a message.

## Private plugin installation (Token Vault pattern)

The Telegram Bot Token stays ONLY in the Worker secret `TELEGRAM_BOT_TOKEN`. The independent MCP key is a credential granting the configured client's permissions. Set the deployed Worker's `PUBLIC_ORIGIN` to its exact public HTTPS origin (no path/trailing slash):

```sh
npx wrangler@4 secret put PUBLIC_ORIGIN
```

Locally create `.env.plugin`, mode 0600, with `PUBLIC_ORIGIN` and `MCP_CLIENT_KEY`. The key must be the SAME value stored as that client's Worker secret (for the owner, `MCP_CLIENT_OWNER`). Use a separate key and private archive for each independently permissioned client. Do not put the Bot Token in this file. Do not type secrets in command arguments or chat.

```sh
npm run plugin:build
```

This reads `.env.plugin` and creates `artifacts/telegram-mcp-private.tar.gz`. It includes the client key in a fixed MCP URL, the tool-use skill, modern and legacy manifests, and installation notes. It does not include `.env.plugin`, server config, D1, Bot Token, or unrelated files. The archive is a credential, not a public distributable; keep it private and never commit it. The script does not print its URL/key.

Install/update using the private Plugin Creator flow, without displaying connection configuration. If bundled remote MCP activation does not work, use Plugins > Add custom MCP server, paste the generated URL locally, select None (the server still validates the path key), and preserve that connection when adding the skill. A saved package is not proof of successful connection. Actually call `telegram_status` before enabling use; do not send real messages merely to test installation.

Do not open the private URL in an ordinary browser, paste it in conversation, or include it in logs/screenshots. Disable full request-URL logging at Cloudflare and any reverse proxy; application code never logs it and strips it before core dispatch, but provider logging is outside this code's control. A leaked URL/archive grants all that client's configured permissions until its key is rotated. Replace the server key and regenerate/reinstall that client's package to rotate it. Telegram Bot Token is a different credential and remains server-side.

For clients supporting secure Bearer header configuration, the existing credential-free `scripts/make-plugin.mjs https://HOST/mcp` remains available. No OAuth is required by the Worker; target-client activation is still an integration test, not guaranteed by the manifest.

## Verify without posting a message

Use the installed private plugin, or your HTTP MCP client's secure bearer-header setting with the deployed HTTPS URL ending /mcp. Call telegram_status; ensure only that credential's aliases are listed. Missing/wrong credentials must return HTTP 401, even with a forged oai-authenticated-user-id header. Check telegram_read only after you authorize the destination's contents to be read. Test send only to an explicitly authorized recipient with a stated harmless test message. Never blindly retry an unknown receipt.

## Data and operational limits

- Dedicated bot: do not share getUpdates consumer or configure webhook; this Worker refuses an existing webhook, never removes it.
- Telegram holds pending updates up to 24 hours; no arbitrary older chat history. Privacy mode limits visible group messages; disabling it increases collection and must be intentional.
- A poll necessarily receives bot-wide updates in process memory. Only configured chat/topics are persisted/returned. Keep bot out of unapproved groups.
- Inbox text/captions are stored in your D1 database indefinitely in this version. Choose retention before sustained use. No attachment downloads.
- Read operation advances the bot queue only after storage; concurrent callers share one guarded cursor.
- Receipt store reduces duplicate sends but ambiguous network failures remain unknown. No guarantee of exactly once.
- Observability is disabled in wrangler.jsonc. Do not log headers, token-bearing Telegram URLs, message bodies or secrets. Hosting-provider telemetry is outside this application's control.
- Start with a new D1 database. Do not reuse the database for another bot.
- Monitor your own Cloudflare usage/costs. Add operational rate controls before sharing widely. No broad-production security audit has been performed.

Reference: https://developers.cloudflare.com/workers/configuration/secrets/
Reference: https://developers.cloudflare.com/d1/wrangler-commands/

Pagination cursors are local ordinals within each chat/topic, not bot-wide Telegram update IDs or global database sequences. They remain stable while earlier records are retained. Future retention/deletion work must preserve or replace that contract. Computing these ordinals scans the selected chat; large inboxes need indexing/retention design before production-scale use.

## Open-source status

Experimental release under MIT. See SECURITY.md for hosting trust and known operational gaps. Neither packaging mode is evidence of successful Dot integration. Do not publish credentials to Issues or PRs.
