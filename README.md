# Fio Expo Go foundation

Fio is a no-login React Native/Expo writing assistant foundation. The manual writing, artifact, attachment, and same-installation history flow is the runnable path today. This is **not production-ready**.

## Run and check

```sh
npm install
npx expo start
npm run lint
npm run lint:css
npm run format:check
npm run expo-check
npm run export:web
```

Routes: `/` for the conversation and `/history` for saved local threads. The iPhone route for this pass is the Expo Go QR shown by the preview.

## Implemented and runnable

- New empty conversation on launch; non-empty turns create and update local history.
- Separate autosaved reference context, durable native photo references, and no OCR/image-understanding claim.
- Manual message/reply/notes/document artifacts with stable IDs, selection, autosave, one-step edit Undo, and exact Copy.
- Truthful unavailable behavior for **Talk to Fio** and **Read aloud**; no microphone, speech playback, browser dictation, or simulated answer starts on launch.
- SecureStore installation credential storage and typed API groundwork for the supplied device, thread, operation, artifact, tool, deletion, and voice-session routes.
- Strict 128 KiB UTF-8 text checks, mapped authorization/capacity/cancellation/idempotency errors, and a reusable one-in-flight FIFO queue.
- Read aloud and Copy capture the exact selected artifact snapshot. Read aloud does not send or speak it while voice is unavailable.

## Expo Go voice feasibility result

Expo SDK 57 recommends `react-native-webview` 13.16.1 and documents it as included in Expo Go. Its iOS WKWebView supports WebRTC browser APIs on a secure HTTPS document origin, and React Native WebView exposes iOS media-capture permission handling.

That is not enough to ship a secure voice bridge from this client alone:

- Inline `source={{ html }}` content does not provide the trusted HTTPS origin needed for reliable microphone `getUserMedia` in WKWebView.
- A genuine bridge therefore needs a reviewed HTTPS page hosted by the trusted Fio API origin, plus its navigation/CSP/CORS rules and a narrow native-message protocol.
- This repository has no such hosted bridge page, and this pass does not authorize deploying one.
- The live broker response fields, six installed tool schemas, provider event shapes, and read-aloud request event remain unconfirmed.
- Passing the installation credential or arbitrary instructions/tools into an unrelated page would violate the trust boundary.

For those reasons no WebView voice bridge was added and no speech is simulated. The default native entrypoint deliberately has no `react-native-webrtc` import, so Expo Go can load the manual app. A physical iPhone has not proven microphone capture, Azure WebRTC, data-channel tools, or playback.

## Required private configuration for future broker work

The API client reads only:

```sh
EXPO_PUBLIC_FIO_API_BASE_URL=https://your-private-fio-api.example
```

This is a public **URL**, not a secret. Long-lived Azure and Redis credentials stay on the Next.js server. Do not add them to Expo environment variables or the client bundle.

The existing fail-closed parser expects the backend owner to confirm the voice-session response and exactly these trusted server-installed capabilities:

```text
artifact_list
artifact_read
artifact_create
artifact_update
artifact_undo
artifact_select
```

The client does not install session instructions, tool schemas, or an arbitrary model prompt. The supplied thread API also does not yet confirm the JSON shape of `initial`/`change`, remote thread-ID mapping, session tool arguments, or trusted read-aloud event.

## Local persistence limits

Local threads remain readable when the API or voice broker is unavailable. Data stays in this installation and can be lost if app/site data is removed. Cross-device synchronization and reinstall recovery are out of scope.

## Backend portability

Published GitHub Repository sync documents client export. Automatic export of cloud function source, PostgreSQL schema/migrations, access rules, and bucket declarations remains unconfirmed; hosted data and secrets are not exported source. Future backend function source, migrations, policies, and storage declarations must be explicitly versioned and checked against deployed resources.
