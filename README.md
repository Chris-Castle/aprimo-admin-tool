# Aprimo Classifications Exporter

A standalone desktop app (Electron) that exports Aprimo classifications to Excel.
It is a focused, single-tool extraction of the `export-classifications` tool from
`aprimo-editor-tools`, with the web app's PKCE auth replaced by a desktop-native
loopback flow so it runs entirely on your machine with no deployment and no
Next.js server.

## How auth works

Sign-in uses the OAuth 2.0 **Authorization Code + PKCE** flow with a **loopback
redirect** (the pattern recommended for native apps, RFC 8252):

1. You enter your Aprimo **environment**, **client ID**, and **client secret** once.
2. The app opens your **system browser** to Aprimo's sign-in page (so SSO, MFA,
   and password managers all work normally).
3. After you sign in, Aprimo redirects to `http://127.0.0.1:3002/callback`, which
   a tiny local listener inside the app catches.
4. The app exchanges the code for tokens directly against Aprimo and stores them
   in your **OS keychain** (via Electron `safeStorage`) — never in plaintext, never
   in the shipped binary.

Tokens are refreshed automatically **if** your registration issues refresh tokens
(the app requests `offline_access` and auto-detects). If it doesn't, the app simply
re-opens the browser sign-in when the access token expires.

### SSO users

Because sign-in happens in the system browser against Aprimo's `/authorize`
endpoint, **SSO and MFA work automatically** — Aprimo redirects the browser to your
identity provider (Okta, Azure AD, Ping, etc.), the user authenticates there, and
the app only receives the resulting code. No code change or special handling is
needed for SSO users.

Two things to get right on the Aprimo side:

- The loopback **redirect URI** (`http://127.0.0.1:3002/callback`) must be
  registered on the **same** PKCE registration your SSO users authenticate through.
  If SSO is tied to a different registration, that URI won't be recognized for them.
- The **client secret is still required for every user**, SSO or not. The secret
  authenticates the *app* to Aprimo at the token-exchange step; the user's SSO
  authenticates the *person*. They are separate concerns — SSO does not remove the
  secret requirement.

Do one real end-to-end sign-in with an actual SSO account (not just a local-password
admin) as the true test.

### One-time Aprimo setup

In Aprimo, go to **Settings → Registrations** and create (or edit) a registration:

- **Grant type:** Authorization Code with PKCE
- **Redirect URI:** `http://127.0.0.1:3002/callback` (this exact string)

Note the **Client ID** and **Client Secret** — you'll enter them in the app.

> **Security note.** Aprimo requires a **confidential** client (with a secret),
> and this tool talks only to Aprimo — there is no intermediate server. The secret
> is therefore entered at runtime and stored in each user's **OS keychain**; it is
> never baked into the shipped binary, and it is sent only over TLS to Aprimo's
> token endpoint. Because every user who runs the app holds the secret on their
> machine, this is intended as an **admin tool for a small number of trusted users**.
> The most effective safeguard is to **scope this registration to the minimum
> permissions the export needs** (ideally read-only access to classifications and
> languages), so a leaked secret can only read the classification tree rather than
> modify the DAM.

## Run it locally

```bash
npm install
npm start        # bundles the renderer, then launches the app
```

## Build a distributable

```bash
npm run build          # current OS
npm run build:win      # Windows .exe (NSIS installer)
npm run build:mac      # macOS .dmg
npm run build:linux    # Linux AppImage
```

Output lands in `dist/`.

## What it exports

For every selected classification node: hierarchy path, ID, system name, localized
name(s) for the languages you pick, parent ID / system name / localized name, and
an optional record count per node. Downloads as `classifications.xlsx`.

## Project layout

- `electron/auth.js` — PKCE, loopback listener, token exchange, refresh, keychain storage
- `electron/main.js` — window + IPC wiring
- `electron/preload.js` — safe IPC bridge to the renderer
- `renderer/` — the export UI and logic (bundled to `bundle.js`)
