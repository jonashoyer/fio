# Fio native voice foundation

Fio is a no-login React Native/Expo writing assistant foundation. The manual writing, artifact, attachment, and same-installation history flow remains the reliable fallback. This is **not production-ready**.

## Run and check

```sh
npm install
npm run ios
npm run android
npm run lint
npm run lint:css
npm run format:check
npm run expo-check
npm run export:web
```

Routes: `/` for the conversation and `/history` for saved local threads.

## Implemented

- New empty conversation on launch; non-empty turns create and update local history.
- Separate autosaved reference context, durable native photo references, and no OCR/image-understanding claim.
- Manual message/reply/notes/document artifacts with stable IDs, selection, autosave, one-step edit Undo, and exact Copy.
- `You said` and `Fio said` turns, with completed voice transcripts saved locally when received.
- Native-only WebRTC audio/data-channel transport using `react-native-webrtc`.
- Microphone capture starts only after **Talk to Fio**, after broker/session validation.
- Real transport states only: connecting, listening, processing, speaking, stopped, and error. Stop listening, Stop Fio, and Mute/Unmute act on the native transport.
- SecureStore installation credential storage. Registration saves `device_id` and the one-time `credential` before any authenticated request.
- `Authorization: Bearer` installation authentication and `X-Fio-Sync-Token` carry-forward, including registration.
- Typed client methods for the supplied thread, operation, artifact, tool, deletion, and voice-session routes.
- Strict 128 KiB UTF-8 text checks, mapped authorization/capacity/cancellation/idempotency errors, and a reusable one-in-flight FIFO queue that preserves an unknown-outcome operation’s original ID/body for retry.
- Provider data-channel handling for the five backend artifact tools and local `artifact_select`. Tool targets must match the current thread; results return only after the backend reports persisted `data`.
- Read aloud and Copy capture the exact selected artifact snapshot. The read snapshot is visible and remains frozen while a long request would run.

## Required private configuration

The native client reads only:

```sh
EXPO_PUBLIC_FIO_API_BASE_URL=https://your-private-fio-api.example
```

This must be a public **URL**, not a secret. Long-lived Azure and Redis credentials stay on the Next.js server. Do not add them to Expo environment variables or the client bundle.

The mobile broker parser currently fails closed unless `POST /api/fio/voice/sessions` returns confirmed `temporary_credential`, `webrtc_call_url`, and a `tools` string array containing exactly these trusted server-installed capabilities:

```text
artifact_list
artifact_read
artifact_create
artifact_update
artifact_undo
artifact_select
```

Those response field names were not available in this repository’s backend handoff and must be confirmed with the backend owner before claiming a live integration. The client does not send session instructions, tool schemas, or an arbitrary model prompt.

The supplied thread API does not define the JSON shape of `initial`/`change`, remote thread-ID mapping, session tool argument schemas, or the trusted read-aloud request event. Therefore local manual writes are not yet mirrored to the remote FIFO, a new unsaved voice thread cannot safely become a remote tool target, and Read aloud deliberately does not send text to Azure. These are explicit integration blockers, not simulated behavior.

## Native iOS route

`react-native-webrtc` is a custom native module and is **not testable proof in Expo Go or the browser preview**.

- Bilt route: **Deploy & Share → Test on iPhone**, then run its fresh five-minute install command on a Mac with Xcode and a USB-connected iPhone.
- Exported/local route: `npm run ios` (`expo run:ios`) on macOS with Xcode.
- Current fallback iOS bundle identifier: `me.bilt.fio`; Bilt may override it through `BILT_IOS_BUNDLE_ID`.
- The app includes `expo-dev-client`, `expo-secure-store`, the WebRTC config plugin, and an iOS microphone usage description.

No native build was produced in this Linux sandbox. Permission denial, audio routing, interruption behavior, WebRTC transport, Azure media, and exact read-back must be tested on that private native build.

## Local persistence limits

Local threads remain readable when the API or voice broker is unavailable. Data stays in this installation and can be lost if app/site data is removed. Cross-device synchronization and reinstall recovery are out of scope. A canceled voice session ignores later provider events and never reports stale tool success.

## Backend portability

Published GitHub Repository sync documents client export. Automatic export of cloud function source, PostgreSQL schema/migrations, access rules, and bucket declarations remains unconfirmed; hosted data and secrets are not exported source. Future backend function source, migrations, policies, and storage declarations must be explicitly versioned and checked against deployed resources.
