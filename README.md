# Busyness

CRM, basic ERP and bookkeeping for a small Norwegian business. Built in phases; **phase 1 (foundation and
security) is complete**: login with mandatory two-factor authentication, roles, an append-only audit log, encrypted
document storage, nightly encrypted backups with an automatic weekly restore test, and GDPR export/anonymisation.

> Figures produced by this system should be reviewed by you or an accountant before anything is submitted to the
> authorities.

- [Stack](#stack)
- [Run it locally](#run-it-locally)
- [Deploying (free tier: Netlify + Neon + Cloudflare R2 + Backblaze B2 + Brevo)](#deploying)
- [Backups and restore](#backups-and-restore)
- [Security overview](#security-overview)
- [GDPR](#gdpr)
- [Open questions and configurable rules](#open-questions-and-configurable-rules)
- [Project layout](#project-layout)

## Stack

| Part | Choice | Why |
|---|---|---|
| App | Next.js 16 (App Router), React 19, TypeScript (strict) | One codebase, widely used, runs on Netlify's free plan |
| Database | PostgreSQL 17 (Neon, Frankfurt) | Exact `NUMERIC` money, and the database itself enforces the audit rules |
| Database access | Drizzle ORM + postgres.js | Parameterised queries only; close to SQL |
| Money | `Money` class on decimal.js, `NUMERIC` in the database | Never floating point (`src/lib/money.ts`) |
| Auth | Own small implementation on vetted primitives: argon2id (hash-wasm), TOTP (@oslojs/otp), Google OAuth with PKCE (arctic) | Two-factor login is enforced for *every* login, including Google, which off-the-shelf libraries did not guarantee |
| Languages | next-intl; Norwegian bokmål default, English optional | |
| Tests | Vitest against a real Postgres, Playwright in a real browser | |
| Backups | restic (encrypted, deduplicated) + rclone, run by GitHub Actions | |

## Run it locally

Requirements: Node 22+ (24 recommended), Docker Desktop.

```bash
npm install
docker compose up -d db mail        # Postgres on port 5433, Mailpit (email catcher) on http://localhost:8025
cp .env.example .env.local          # then set ENCRYPTION_KEY, see the comment in the file
npm run db:migrate
npm run seed                        # fictional company "Fjordlys Testfirma AS" + 3 users
npm run dev                         # http://localhost:3000
```

Log in as `eier@fjordlys.test` (owner), `ansatt@fjordlys.test` (employee) or `regnskap@fjordlys.test`
(read-only accountant) with the password the seed script prints. For the two-factor code, either add the printed key
to an authenticator app, or run `npm run dev:totp -- eier@fjordlys.test` (local databases only).

| Command | What it does |
|---|---|
| `npm test` | Unit and integration tests (rebuilds the `busyness_test` database) |
| `npm run test:e2e` | Browser tests: login, 2FA, roles, invitation flow (needs `db` and `mail` running) |
| `npm run lint` / `npm run typecheck` | |
| `npm run db:generate` | Create a migration after changing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations and (re)apply the app role's privileges |
| `npm run create-owner -- you@example.com` | Invite the first owner; prints the link |
| `npm run user:reset-mfa -- user@example.com` | Emergency 2FA reset (e.g. the only owner lost their phone) |
| `npm run audit:verify` | Check the audit log hash chain |

## Deploying

Everything below has a free tier. Total cost: 0 kr, as long as you stay within the limits (Neon 0.5 GB, R2 10 GB,
B2 10 GB, Brevo 300 emails/day).

### 1. GitHub
Create a **private** repository and push this code. CI runs on every push.

### 2. Neon (database, Frankfurt)
1. Create a project in region **AWS Europe Central 1 (Frankfurt)**, Postgres 17.
2. In the **SQL Editor** (not the "Roles" page: roles made there get extra powers), create the restricted app role:
   ```sql
   CREATE ROLE busyness_app LOGIN PASSWORD '<long random password>';
   ```
3. You now have two connection strings:
   - **Owner** (`neondb_owner`), *direct* (no `-pooler` in the host): used for migrations and backups.
   - **App** (`busyness_app`), *pooled* (host contains `-pooler`): used by the running app.
   Both need `?sslmode=require`.

### 3. Cloudflare R2 (documents, EU)
1. Create a bucket with **jurisdiction: European Union**. (Cloudflare asks for a card, but does not charge under 10 GB.)
2. Create an API token with *Object Read & Write* on that bucket only (for the app), and a second one with
   *Object Read* only (for backups).
3. The endpoint looks like `https://<account-id>.eu.r2.cloudflarestorage.com`.

### 4. Backblaze B2 (backups, EU, separate provider)
1. Sign up and choose the **EU Central** region (you choose this at sign-up).
2. Create a private bucket, e.g. `busyness-backup`, and an application key limited to that bucket.
3. Your restic repository is `s3:https://s3.eu-central-003.backblazeb2.com/busyness-backup/restic`
   (check the endpoint shown on your bucket page).
4. Invent a long `RESTIC_PASSWORD`. **Store it in your password manager and on paper.** Without it the backups cannot
   be read by anyone, including you.

### 5. Brevo (email)
Create an account, verify a sender address, and create an SMTP key. Your `SMTP_URL` is
`smtp://<login>:<smtp-key>@smtp-relay.brevo.com:587`. Any other SMTP provider works the same way.

### 6. Google login (optional)
Google Cloud Console → APIs & Services:
1. OAuth consent screen: External; scopes `openid`, `email`, `profile`.
2. Credentials → OAuth client ID → Web application. Authorised redirect URI:
   `https://<your-site>.netlify.app/api/auth/google/callback`.

### 7. Netlify (the app)
1. Import the GitHub repository. Netlify detects Next.js; `netlify.toml` runs migrations on production deploys only.
2. Site configuration → Build & deploy: **turn off deploy previews and branch deploys.** They would run against the
   production database.
3. Environment variables (see `.env.example` for descriptions):

   | Variable | Value |
   |---|---|
   | `APP_URL` | `https://<your-site>.netlify.app` |
   | `DATABASE_URL` | Neon **app** role, pooled |
   | `DATABASE_MIGRATION_URL` | Neon **owner**, direct. Scope it to *Builds* only if your plan allows |
   | `APP_DB_ROLE` | `busyness_app` |
   | `ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Keep a copy in your password manager: without it, everyone must set up 2FA again |
   | `MAIL_TRANSPORT` / `SMTP_URL` / `MAIL_FROM` | `smtp` / Brevo URL / `Firmanavn <you@example.com>` |
   | `STORAGE_DRIVER` | `s3` |
   | `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` | R2 endpoint / `auto` / bucket name |
   | `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | R2 read-write token |
   | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | optional |

4. Deploy. Then, on your own computer, with `DATABASE_URL` set to the production app connection string and the same
   `ENCRYPTION_KEY`, `APP_URL`, `MAIL_*` values as Netlify, run `npm run create-owner -- you@example.com` and open the
   link it prints (it is also emailed).

If a required variable is missing or wrong, the server refuses to start and the Netlify function log names it.

### 8. Backups (GitHub Actions)
Repository → Settings → Secrets and variables → Actions → *Secrets*:

| Secret | Value |
|---|---|
| `BACKUP_DATABASE_URL` | Neon **owner**, direct connection |
| `RESTIC_REPOSITORY` | from step 4 |
| `RESTIC_PASSWORD` | from step 4 |
| `B2_KEY_ID` / `B2_APPLICATION_KEY` | B2 application key |
| `R2_BUCKET` / `R2_ENDPOINT` | from step 3 |
| `R2_BACKUP_ACCESS_KEY_ID` / `R2_BACKUP_SECRET_ACCESS_KEY` | R2 **read-only** token |

Optional *variable* `PG_MAJOR` if Neon runs a Postgres version other than 17. Run *Actions → Nightly backup → Run
workflow* once, then *Weekly restore test → Run workflow*. GitHub emails you when a scheduled run fails.

## Backups and restore

**What is backed up, nightly at about 02:17:** a full `pg_dump` of the database and every stored document. restic
encrypts the data before it leaves the GitHub runner and stores it with Backblaze B2, a different provider and
location from the database (Neon) and the documents (R2). It keeps 30 daily, 12 monthly and 6 yearly snapshots
(`BACKUP_KEEP_*`). Each database snapshot is tagged with the start of the audit log's head hash at that moment.

**Automatic proof, weekly:** `scripts/backup/restore-test.sh` restores the latest snapshot into an empty database and
checks that:
- the restic repository is intact (5 % of the data is re-read);
- the restored audit log hash chain is unbroken;
- every document recorded in the database exists in the backup with the same SHA-256 fingerprint.

### Restore procedure (tested)
Use this to recover from data loss or move to a new host. It was run end-to-end while building phase 1:
restore → `db:migrate` → `audit:verify` as the app role.

1. Install `restic` and the Postgres client tools (`pg_restore`, `psql`), or use the Docker image:
   `docker compose --profile tools run --rm backup-tools bash`.
2. Set `RESTIC_REPOSITORY`, `RESTIC_PASSWORD`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (the B2 key).
3. Pick a snapshot: `restic snapshots --tag db` (default: the latest).
4. Get the dump: `restic dump --tag db latest /db.dump > db.dump` (or replace `latest` with a snapshot ID).
5. Create an **empty** database (a new Neon project, or a new database in the old one), and create the app role in
   it (Deploying, step 2).
6. Restore: `pg_restore --no-owner --no-privileges --exit-on-error --dbname="<owner URL of new db>" db.dump`.
7. Re-apply privileges: `DATABASE_MIGRATION_URL="<owner URL>" npm run db:migrate`.
8. Verify: `DATABASE_URL="<app URL>" npm run audit:verify` should print "Audit log intact".
9. Documents: `restic restore latest --tag files --target ./restored`, then upload the contents of
   `restored/tmp/busyness-files/` to the R2 bucket with the same paths:
   `rclone copy ./restored/tmp/busyness-files r2:<bucket>`.
10. Point Netlify's `DATABASE_URL` / `DATABASE_MIGRATION_URL` at the new database and redeploy.

Test locally at any time:
```bash
docker compose --profile tools run --rm backup-tools bash /scripts/backup.sh
docker compose --profile tools run --rm backup-tools bash /scripts/restore-test.sh
```
(On Git Bash for Windows, prefix with `MSYS_NO_PATHCONV=1`.)

## Security overview

| Area | How |
|---|---|
| Passwords | argon2id (19 MiB, t=2), at least 12 characters, checked against HaveIBeenPwned (only a 5-character hash prefix leaves the server) |
| Two-factor | TOTP is mandatory for every user and every login method; codes cannot be reused; 10 single-use recovery codes (stored hashed); TOTP secrets encrypted with AES-256-GCM |
| Sessions | 160-bit random tokens, only their SHA-256 stored; `HttpOnly`, `Secure`, `__Host-` cookie; 2 h idle / 12 h absolute; a password-only session lasts 10 minutes and can only reach the 2FA step; a new token is issued after 2FA |
| Sign-up | Invitation only (7 days, single use); Google only for existing users or invitees, with a verified email |
| Access control | Checked on the server in every page, action and API route (`src/server/auth/dal.ts`); roles in `src/lib/permissions.ts` |
| Rate limiting | In Postgres (shared by all serverless instances): per IP, per account, per 2FA user, for password reset and invitations |
| SQL injection | Parameterised queries only (Drizzle) |
| XSS | React escaping + strict Content-Security-Policy with a per-request nonce |
| CSRF | All changes are POST Server Actions; Next.js rejects ones whose Origin does not match the host; `SameSite=Lax` cookies; OAuth `state` + PKCE |
| Clickjacking, sniffing | `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, HSTS, strict Referrer-Policy |
| Secrets | Environment variables only, validated at start-up; `.env*` files are git-ignored |
| Encryption at rest | Neon, R2 and B2 encrypt at rest; backups are additionally restic-encrypted; 2FA secrets app-encrypted |
| Audit log | See below |
| Dependencies | `npm audit --omit=dev` in CI. Known findings currently exist only in dev tools (ESLint, drizzle-kit), which are not shipped |

### The audit log
- Every insert, update and delete on audited tables is recorded **by a database trigger**, in the same transaction as
  the change. Changes made without an actor (`withAudit()`) are rejected by the database.
- Logins, failed logins, 2FA events, exports and verifications are recorded as events.
- The app's database role has no `UPDATE`/`DELETE`/`TRUNCATE` permission on the log, and a trigger blocks them even for
  the owner role.
- Each row contains the SHA-256 of its content plus the previous row's hash. Changing or deleting any row behind the
  database's back breaks the chain, which *Audit log → Verify*, `npm run audit:verify`, every backup and every restore
  test detect.
- Secrets (password hashes, 2FA secrets, tokens) are never copied into the log.

## GDPR
- **Data minimisation:** users' name, email and role; login history (time, IP, browser). Customer data comes in
  phase 2.
- **Access/portability:** *My account → Download* (JSON); the owner can export any user's data from *Users*.
- **Erasure:** the owner can deactivate and then *anonymise* a former user: name and email are replaced and
  credentials removed; the change itself is logged with its content redacted.
- **Bookkeeping retention wins over erasure** where the law requires it (bokføringsloven). Documents cannot be deleted
  before their retention date (enforced by the database).
- **Hosting:** data is stored in the EU (Neon Frankfurt, R2 EU, B2 EU). Requests are processed by Netlify, which may be
  in the USA.

## Open questions and configurable rules
These are things I am not certain about. They are settings or documented here instead of being guessed. Please check
them with your accountant.

1. **Retention period:** 5 years after the end of the financial year for primary documentation (bokføringsloven § 13).
   Stored as the setting `retention.primary_documentation_years`.
2. **Storage abroad:** the data is *stored* in the EU/EEA, but Netlify may *process* requests in the USA. I believe this
   is fine for the bookkeeping rules on storage location, but this is unconfirmed.
3. **Audit log vs. right to erasure:** older audit entries keep the personal data they contained (for example a
   former user's email as the actor). This is justified as part of the accounting and security records, but have it
   reviewed. A later option is to encrypt personal data in the log per person, so it can be erased by deleting that
   person's key.
4. **Netlify free tier limits:** functions have a short time limit. That's fine for normal use. The "download
   everything" export (phase 7) will be built to work in steps or via GitHub Actions.

## Project layout
```
src/
  app/(public)/      login, 2FA, invitation, password reset, privacy (no session needed)
  app/(app)/         logged-in pages: dashboard, company, users, audit log, account, help
  app/api/           Google OAuth, GDPR exports, health check
  db/                schema.ts and SQL migrations (0001 = audit log, triggers, file protection)
  lib/               money, crypto, audit, rate limiting, passwords, TOTP, permissions, email, storage
  server/            auth service + session + data access layer, user admin, company
  messages/          nb.json, en.json (interface text and in-app user guide)
  proxy.ts           Content-Security-Policy with nonce
scripts/             migrate, seed, create-owner, reset-mfa, audit:verify, backup/*.sh
tests/               unit and integration tests (Vitest, real Postgres)
e2e/                 browser tests (Playwright)
```
