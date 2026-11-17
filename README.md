# Telegram MCP: self-hosted Cloudflare Worker

Explicit message reading and authorized sending; no wake/background polling, no instruction execution from messages. Config files only, no management UI. Dedicated Telegram bot and dedicated database required.

## What is and is not ready

This standalone entry point validates per-client bearer credentials before deriving the caller identity. Public `oai-authenticated-*` headers are ignored. NEVER deploy `worker/index.js` directly: its identity contract is Sites-only. Wrangler uses `worker/standalone.js`.

Tested locally with Node mock HTTP and SQLite. Not deployed/tested on your Cloudflare account or against a real Telegram bot. No OAuth authorization server is implemented. This supports HTTP MCP clients that securely supply Authorization: Bearer. The local Plugin Creator package schema accepts API-key/Bearer metadata (see below), matching this server. However, the public OpenAI authentication guide states ChatGPT cannot present custom API keys. These are conflicting package-vs-runtime signals: schema acceptance does NOT prove this Dot can connect. End-to-end connection remains untested. OAuth may be required for the target host; it is NOT implemented here. Never select unauthenticated access or put credentials in URL query/path.

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

## Candidate plugin metadata, NOT a verified Dot connection

The documented portable plugin schema supports:

```json
"extensions": {
  "com.openai": {
    "auth": {"type": "api_key", "headerScheme": "bearer"}
  }
}
```

This belongs under the individual remote server in `mcp.json`, not at the top level. No key belongs in the package.

After obtaining your actual deployed URL, generate a credential-free package:

```sh
node scripts/make-plugin.mjs https://YOUR-ACTUAL-WORKER-HOST/mcp
tar -czf telegram-mcp-plugin.tar.gz telegram-mcp-plugin
```

Give the assistant the actual non-secret endpoint and package, not your keys. It can verify the endpoint and create the private plugin through the supported plugin workflow. Only if the platform actually offers supported API-key credential entry, enter the MCP client key (same value as MCP_CLIENT_OWNER), never your Telegram bot token. The exact connection UI and end-to-end Dot invocation remain untested until a real endpoint exists. Public OpenAI docs: https://developers.openai.com/plugins/build/auth (Client identification) currently state custom API keys cannot be presented by ChatGPT; treat this candidate manifest as unverified, not a ready-to-install solution. If the platform offers no supported credential-entry control, stop rather than paste the key into conversation or put it into manifest/URL. Plugin creation alone does not prove successful authentication.

## Verify without posting a message

Use your HTTP MCP client's secure bearer-header setting and the deployed HTTPS URL ending /mcp. Call telegram_status; ensure only that credential's aliases are listed. Missing/wrong credentials must return HTTP 401, even with a forged oai-authenticated-user-id header. Check telegram_read only after you authorize the destination's contents to be read. Test send only to an explicitly authorized recipient with a stated harmless test message. Never blindly retry an unknown receipt.

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

Experimental release under MIT. See SECURITY.md for hosting trust and known operational gaps. The bearer-key manifest is a candidate connection configuration, not evidence of successful Dot integration. Do not publish credentials to Issues or PRs.
