# Fio app foundation

Fio is a no-login mobile writing assistant foundation built with React Native, Expo Router, HeroUI Native, and Uniwind. This is a maintainable app base for product validation, **not a production-ready release**.

## Run and check

```sh
npm install
npm run ios
npm run android
npm run web

npm run lint
npm run lint:css
npm run format:check
npm run expo-check
npm run export:web
```

The main preview route is `/`. History is available at `/history`.

## Implemented

- Every app launch opens a new, empty conversation without creating a history record.
- A non-empty submitted turn creates one thread; later turns update that same thread.
- User writing, optional thread-level reference context, and image reference metadata persist even when Fio cannot reply. Reference context autosaves when editing finishes and is not copied into user turns or artifacts.
- Supplied writing can be turned into a clearly labeled, editable manual artifact.
- Artifact edits save automatically when editing finishes. **Undo edit** restores the last saved artifact text.
- **Copy** writes the selected artifact text exactly and shows success or failure.
- History can refresh, reopen, and permanently delete saved threads.
- Save and load errors are visible in the UI.
- Selected screenshots/photos are copied into the app document directory before they are attached, then displayed as references after relaunch. No OCR or image interpretation is claimed.
- Local writes are serialized, and thread revisions prevent an older save from overwriting a newer saved revision.

## Deliberately unavailable

- Azure Realtime/Live native voice-to-voice is not configured. **Talk to Fio** and **Read aloud** remain visible but truthfully report this state and direct people to the working text path.
- There are no generated Fio replies, canned corrections, browser dictation, standalone TTS, simulated delays, or listening animation.
- There is no login, cloud sync, hosted storage, OCR, image understanding, publishing, or deployment.
- Bilt Cloud versus an owned backend remains an open decision.

## Architecture

Fio domain models and replaceable boundaries live under `lib/fio/`:

- `types.ts`: `Thread`, `Turn`, `Attachment`, and `Artifact`, plus repository, voice, clipboard, and durable attachment interfaces.
- `local-thread-repository.ts`: isolated AsyncStorage adapter for same-device thread persistence.
- `attachment-service.ts`: isolated native app-document-directory image copy and web-preview reference adapter.
- `services.ts`: unconfigured voice adapter and exact clipboard adapter.
- `thread-store.tsx`: UI-facing state and persistence orchestration.

Screens use these interfaces rather than cloud SDKs. Credentials must remain out of the client when voice and backend integrations are added.

## Local persistence limits

Current storage is a foundation adapter, not a final backend decision. Data stays on the current app installation, does not sync across devices, is not shared between native and web, and can be lost when browser/site data or the app is removed. It has no account recovery, remote backup, multi-device conflict handling, encryption policy, retention policy, or server-side access controls.

Before production, verify private no-login backend behavior, backend privacy and retention, durable attachment lifecycle, offline/error behavior, native Azure voice capture/playback, interruption handling, consent, and credentials kept on a trusted server boundary. Cross-device synchronization and reinstall recovery are out of scope for this foundation.

## Backend portability

Published GitHub Repository sync behavior documents export of the client project. Automatic export of Bilt Cloud function/automation source, PostgreSQL schema or migrations, row-access policies, and storage-bucket definitions remains unconfirmed. Hosted data and secrets are not treated as exported source.

When a backend is implemented, explicitly version its actual function source, migrations/schema changes, access policies, and bucket declarations in the owned repository, then check those definitions against deployed resources. Do not rely on client export as a backend backup.
