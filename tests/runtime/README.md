# Workers fetch regression

Run `npm test` for the Node unit suite, then `npm run test:workerd` with the Cloudflare `workerd` executable on PATH. Alternatively set `WORKERD_BIN` to its absolute path. No package is installed by this test.

The regression runs the actual worker source using native Workers `fetch`. All outbound requests are routed to an in-process mock service. It uses fake tokens and destination IDs, never contacts Telegram, never deploys a Worker, and does not require Cloudflare credentials.

It checks successful plain-text, HTML and MarkdownV2 send payloads, a formatted edit payload, and read paths, plus refused redirects on send, edit and read paths. The `redirect: 'error'` baseline fails at the send assertion because Cloudflare only accepts `follow` and `manual`. `manual` plus an explicit 3xx check preserves the no-redirect security boundary.

Validated with workerd 1.20261019.1 and compatibility date 2026-10-26. This is a runtime compatibility regression, not proof that a production bot token or destination is valid. Production deployment retains its existing compatibility date.
