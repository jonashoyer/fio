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

## GPT-Live-1 frontend boundary

GPT-Live-1 is the only voice protocol represented by the client. The dormant API client accepts a phone-generated WebRTC offer only through:

```text
POST https://fioai.vercel.app/api/fio/voice/live/sessions
```

It sends `{ sdp, thread_id? }` with the installation Bearer credential and latest `X-Fio-Sync-Token`. It requires HTTP `201`, an SDP answer bound to that offer, `model: "gpt-live-1"`, Azure/WebRTC identifiers, `credential_expires_at: null`, the reviewed tool-contract version, and either `confirmed` or `awaiting_session_started`. It rejects old URL/client-secret grants and never calls retired `/voice/sessions`.

The Live protocol groundwork:

- unwraps `response.event` and accepts `response.output_item.done` function calls only;
- allows backend `artifact_list`, `artifact_read`, `artifact_create`, `artifact_update`, and `artifact_undo`, plus local `artifact_select`;
- binds calls to the captured session/thread, validates local artifact targets, deduplicates `call_id`, and serializes work through one FIFO;
- generates write operation IDs from the trusted session/call binding rather than treating model-supplied IDs as authorization;
- sends correlated `response.item.create` function outputs followed by `response.create`;
- strips thread/session/call identifiers and `kind` from generic `artifact_create` backend arguments.

The media/tool gate requires a complete effective `session.started` or `session.updated` event. Mobile source embeds the reviewed nonsecret generated bundle from `docs/voice_agent_prompt_and_tools.md` and independently requires the exact voice instructions, `delegation.type: "responses"`, broker-reported backend model, delegated instructions, `tool_choice: "auto"`, `parallel_tool_calls: false`, and all six canonical function definitions. Missing fields remain `awaiting`; any mismatch is `unavailable`. `tool_contract_version` and broker status alone never open the gate.

## Expo Go voice incompatibility

Expo Go can load the manual app, but its React Native JavaScript runtime does not expose a WebRTC peer connection. `react-native-webview` 13.16.1 is included, and WKWebView can support browser WebRTC from a secure HTTPS document, but this project has no reviewed hosted bridge page or narrow credential/session protocol. Inline HTML is not used. There is also no eager `react-native-webrtc` import or custom native build route in this repository.

Therefore no microphone, output audio, model call, or tool execution is enabled in Expo Go. A genuine iPhone route requires either a reviewed HTTPS media bridge or a custom development build with an isolated compatible native WebRTC adapter. Neither route has been run on an iPhone Air/iOS 27.2, so no phone voice success is claimed.

## Broker readiness and configuration

The client reads the public full API prefix without adding `/api/fio` again:

```sh
EXPO_PUBLIC_FIO_API_BASE_URL=https://fioai.vercel.app/api/fio
```

This public value is not a secret and is not proof of broker readiness. The production alias may resolve to a ready deployment while the new Live broker code and canonical server-only Azure/Upstash configuration are still undeployed. No registration or session request should be made to infer readiness until the backend owner confirms deployment.

The reviewed nonsecret Live contract version is:

```text
fio-live-v1:c5e965a0e17ab8901e7745a125b9c7726eb16a160b67650550f4454381cc66af
```

The embedded bundle is marked `Unvetted Synthetic` with content SHA-256 `c5e965a0e17ab8901e7745a125b9c7726eb16a160b67650550f4454381cc66af`. The broker implementation is still local and may change; any deployed version or effective-session drift must keep voice unavailable until the mobile bundle is reviewed and updated.

The local product still distinguishes message, reply, notes, and document artifacts. The generic backend `artifact_create` contract does not carry `kind`, so preserving those distinct kinds remains a full-scope backend contract gap; full PRD acceptance is not claimed. Final Live transcript/read-aloud event shapes, deployed broker parity with the embedded bundle, and a supported device transport are still required before enabling media.

## Local persistence limits

Local threads remain readable when the API or voice broker is unavailable. Data stays in this installation and can be lost if app/site data is removed. Cross-device synchronization and reinstall recovery are out of scope.

## Backend portability

Published GitHub Repository sync documents client export. Automatic export of cloud function source, PostgreSQL schema/migrations, access rules, and bucket declarations remains unconfirmed; hosted data and secrets are not exported source. Future backend function source, migrations, policies, and storage declarations must be explicitly versioned and checked against deployed resources.
