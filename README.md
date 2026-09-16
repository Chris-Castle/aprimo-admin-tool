# Aprimo Admin Tools

A standalone desktop app (Electron) with tools for Aprimo administrators. Sign in once with your Aprimo credentials and access all tools from a single home screen.

> **This is a sample tool.** Embedding a client secret in a desktop application is acceptable for internal use by a small number of trusted admins, but a server-side token broker is recommended for broader distribution.

## Tools

### Classifications Exporter
Export your classification tree to Excel. For every selected node: hierarchy path, ID, system name, localized names for the languages you pick, parent info, and an optional record count. Downloads as `classifications.xlsx`.

### Data Model Explorer
Select any field definition to see a visual graph of everywhere it is used — field groups, content types, classifications, cross-field expression references, and rules.

## How auth works

Sign-in uses the OAuth 2.0 **Authorization Code + PKCE** flow with a **loopback redirect** (RFC 8252 — the pattern recommended for native apps):

1. Enter your Aprimo **environment**, **client ID**, and **client secret** once.
2. The app opens your **system browser** to Aprimo's sign-in page — SSO, MFA, and password managers all work normally.
3. After sign-in, Aprimo redirects to `http://127.0.0.1:3002/callback`, which a local listener inside the app catches.
4. The app exchanges the code for tokens directly against Aprimo and stores them encrypted using your **OS keychain key** (via Electron `safeStorage`) — never in plaintext, never in the shipped binary.

Tokens are refreshed automatically if your registration issues refresh tokens (the app requests `offline_access` and auto-detects). Otherwise the browser sign-in re-opens when the access token expires.

### One-time Aprimo setup

In Aprimo, go to **Settings → Registrations** and create (or edit) a registration:

- **Grant type:** Authorization Code with PKCE
- **Redirect URI:** `http://127.0.0.1:3002/callback` (this exact string)

Note the **Client ID** and **Client Secret** — you'll enter them in the app on first launch.

### SSO users

Because sign-in happens in the system browser, SSO and MFA work automatically — Aprimo redirects to your identity provider (Okta, Azure AD, Ping, etc.) and the app only receives the resulting code.

Two things to verify on the Aprimo side:

- The redirect URI (`http://127.0.0.1:3002/callback`) must be registered on the same PKCE registration your SSO users authenticate through.
- The client secret is still required for SSO users. The secret authenticates the *app* to Aprimo at the token-exchange step; SSO authenticates the *person*. They are separate concerns.

### Security note

The secret is entered at runtime and stored encrypted on each user's machine. Scope this registration to the **minimum permissions needed** (ideally read-only) so a leaked secret limits exposure to reading data rather than modifying the DAM.

## Run locally

```bash
npm install
npm start        # bundles the renderer, then launches the app
```

## Build a distributable

```bash
npm run build          # current OS
npm run build:win      # Windows (NSIS installer)
npm run build:mac      # macOS (.dmg)
npm run build:linux    # Linux (AppImage)
```

Output lands in `dist/`. GitHub Actions builds all three platforms automatically — see `.github/workflows/build.yml`. Push a `v*` tag to create a GitHub Release with installers attached.

## Project layout

```
electron/
  auth.js       PKCE flow, loopback listener, token exchange, refresh, keychain storage
  main.js       Window creation and IPC wiring
  preload.js    Secure IPC bridge to the renderer
renderer/
  app.js        Main renderer entry point, classifications exporter logic
  data-model.js Data model explorer logic (Cytoscape graph)
  index.html    UI shell and styles
build/
  icon.png      App icon (source; electron-builder converts per platform)
.github/
  workflows/
    build.yml   CI — builds and releases on all platforms
```
