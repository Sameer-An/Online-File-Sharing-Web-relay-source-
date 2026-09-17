# Relay

An MIT-licensed temporary text, file and folder sharing application. The application source is open source; the current deployment uses proprietary Cloudflare infrastructure and Sites hosting. It has not received an independent security audit or production load test.

## Features

Create an eight-digit room, join from another browser, share text and upload files and folders, copy text, download individual files, delete items, or close a room as its creator. Folder paths are retained; empty directories and whole-folder ZIP downloads are not supported. Limits: 20 MB per non-empty file, 100 MB cumulative uploads and 100 items per room. Expiry options: 15 minutes, 1 hour, 6 hours, 24 hours. Visible clients poll every three seconds; this is near-real-time, not WebSocket push.

## Item positions and sharing progress

Shared files and text are numbered from 1 in the current newest-first list. Positions update after additions and deletions. Upload progress comes from browser byte-transfer events. Each item shows queued, sending, saving, confirmed success, rejection, or uncertain confirmation. A full upload is not marked shared until the server acknowledges storage. Connection failures advise checking the shared list before retrying.

## Windows development

Install Node.js 22.13 or later and the pnpm version declared in package.json. Extract this archive, open its folder in VS Code, and open Terminal > New Terminal (PowerShell). From this project folder run:

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_natural_talon.sql
pnpm run dev
```

Use the localhost address printed by the development command. Secure cookies work on localhost and production HTTPS; arbitrary HTTP hosts will not persist the session. The downloaded manifest contains logical DB/BUCKET bindings without the original deployment identity. No environment secrets are needed for local emulation. See STARTER.md for the scaffold's runtime details. Production deployments require D1 and R2 provisioning and migration application, plus HTTPS. Sites handles these for the registered deployment. Do not deploy with an empty database.

## Architecture

- app/page.tsx: React workspace and refresh loop.
- app/api/relay/route.ts: request validation, room authorization, upload and download handlers.
- lib/relay-server.ts: binding access, session hashing, rate limiting and expiry cleanup.
- db/schema.ts and drizzle/: schema and versioned migrations.
- D1: room metadata, hashed codes, hashed session tokens, rate limits, text and file metadata.
- R2: private file bytes, accessible only through authorized handlers.

## Security and retention

Eight decimal digits have approximately 26.6 bits of entropy. Code possession permits reading, adding and deleting items. Do not use for passwords, identity documents or highly sensitive records. Codes are generated with cryptographic randomness and stored as SHA-256 hashes; their small search space means database compromise permits offline enumeration. Codes are never included in URLs. Session cookies use random tokens, HttpOnly, Secure and SameSite=Strict. Mutations require same-origin requests. Queries use prepared statements. Text is rendered as text, and files are served as binary attachments with nosniff rather than rendered inline. There is no end-to-end encryption or malware scanning.

Create: 10 requests per IP per ten-minute window. Join: 15 per IP per ten-minute window. Writes: 120 per IP per minute. Fixed windows allow bursts across boundaries and do not stop distributed attacks. The origin must receive trusted Cloudflare client IP headers; do not trust forwarded headers from arbitrary clients when porting this application. Public deployment needs global abuse controls, bot protection, cost caps and monitoring.

Every read, download and write verifies room expiry. Expired rooms are inaccessible immediately. Up to ten expired rooms are physically removed on each create/join request. No scheduled cleanup is configured: when idle, stored bytes may remain indefinitely. Closing a room attempts immediate deletion; storage errors are reported and can be retried. Provider backups and logs have independent retention. No secure-erasure guarantee is made.

Uploads reserve quota atomically before committing items; deletion does not replenish the cumulative quota. R2 and D1 are not a single transaction, so a process crash can leave orphan bytes or reserved quota. Production must add an orphan reconciliation task, scheduled cleanup and R2 lifecycle rules. A file upload is buffered up to 20 MB; high concurrency needs streaming uploads or presigned multipart storage, per-room sharding, and measured capacity planning. Polling produces database reads per connected client and should be replaced with an event service when needed. Serverless hosting alone does not prove scalability.

The hosted Sites version is initially owner-private and requires that owner's ChatGPT sign-in on every device. Code-only anonymous use needs a deliberate public access configuration. Never put private content in source control.

## Validation

See TESTING.md for the actual checks completed. Before any public release, independently audit access controls, distributed guessing defenses, retention jobs, dependency advisories and load behavior.
