# Deploying PharmaTrack to Vercel + Turso

The repo is deploy-ready: `vercel.json` builds `api/index.js` (the exported Express app)
as a serverless function and routes all traffic to it; `public/**` is bundled for the SPA.
Schema + demo seed are applied automatically on the first request (`ready()` in
`server/index.js`), so there is no manual migration step.

Two things below need YOUR browser login (a headless assistant can't do them):
`vercel login` and creating the Turso database. After that the deploy is one command.

## 1. Create a Turso database (free)

Sign up at https://turso.tech, then either use the dashboard or the CLI:

```bash
# Windows install (PowerShell):  irm https://get.tur.so/install.ps1 | iex   (or use WSL/scoop)
turso auth login
turso db create pharmatrack
turso db show pharmatrack --url        # -> libsql://pharmatrack-<org>.turso.io
turso db tokens create pharmatrack     # -> the auth token (copy it)
```

## 2. Log in to Vercel

The CLI is already installed globally (`vercel --version` -> 55.x).

```bash
vercel login          # opens the browser; pick the account you created
```

## 3. Set environment variables

Either in the Vercel dashboard (Project -> Settings -> Environment Variables, all
environments) or via CLI after the first `vercel link`:

```bash
vercel env add DATABASE_URL          # paste the libsql://... URL from step 1
vercel env add DATABASE_AUTH_TOKEN   # paste the Turso token from step 1
vercel env add JWT_SECRET            # a long random string
```

See `.env.example` for the full list.

## 4. Deploy

From the project root:

```bash
vercel          # first run links/creates the project (accept the defaults)
vercel --prod   # promote to production
```

## 5. Verify

- `GET https://<your-app>.vercel.app/api/health` -> `{"status":"ok", ...}`
- Open the app and log in with a demo account: `amit@pharmatrack.demo` / `demo123`
  (Product Manager / HO). Other demo logins are `*@pharmatrack.demo` / `demo123`.

## Notes

- The demo seed runs once against an empty database. For a clean production instance,
  gate or remove `seedIfEmpty` in `server/db/seed.js` if you don't want demo data live.
- Vercel's filesystem is read-only + ephemeral, so the local `file:` DB default is not
  usable in production — `DATABASE_URL` (Turso) must be set. `npm test` locally uses a
  throwaway temp file DB and needs no env.
