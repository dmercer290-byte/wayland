# Android App

Native Android client (`android/` in this repo) that syncs with a Wayland
server. Kotlin + Jetpack Compose. It keeps a local JSON cache of conversations
and messages, so previously synced chats are readable offline; when connected
it lists conversations, shows history, and sends messages to the agent.

## Requirements

- A running Wayland server reachable from the phone: desktop app with WebUI
  enabled, or the headless server (`bun run server:start:prod:remote` /
  [deploy-server.md](deploy-server.md)). Remote access must be allowed.
- The server login credentials (username + password).

## Build

CI: the **Android App** workflow (`.github/workflows/android-app.yml`) builds
a debug APK on every change under `android/` — download it from the run's
artifacts. Locally: open `android/` in Android Studio (it generates the Gradle
wrapper on first sync), or `gradle assembleDebug` with Gradle 8.10 + JDK 17.

Note: the APK is a debug build and unsigned for store purposes. For
Play-store or long-term sideload distribution, set up a signing key and a
release build type.

## Protocol

The app speaks the same remote bridge as the browser WebUI (all verified
against this repo's source):

1. `POST /login` `{username, password}` → auth cookie
   (`src/process/webserver/routes/authRoutes.ts`).
2. `GET /api/ws-token` → short-lived WebSocket token.
3. WebSocket to `/?token=...`. Frames are `{"name": string, "data": any}`;
   reply to `ping` with `pong` (`websocket/WebSocketManager.ts`).
4. RPC envelope (`@office-ai/platform` bridge): request
   `subscribe-<provider>` with `{id, data}`, response arrives as
   `subscribe.callback-<provider><id>`. Inbound names must pass the remote
   allowlist (`src/common/adapter/bridgeAllowlist.ts`).

Providers used: `database.get-user-conversations`,
`database.get-conversation-messages`, `chat.send.message`
(`src/common/adapter/ipcBridge.ts`).

## Current scope / next steps

- Read + send + offline cache. Streaming updates arrive as bridge emitter
  events (`BridgeClient.onEvent`) but v1 refreshes by re-fetching after send —
  wiring the streamed message events into the chat view is the first upgrade.
- Cleartext HTTP is permitted for LAN servers (see the manifest note). Use
  HTTPS or a VPN/tunnel for anything beyond your own network.
- QR pairing (`/api/auth/qr-login`) exists server-side and would remove the
  password step on the phone.
