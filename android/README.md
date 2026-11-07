# Cloudreve Android

Native Android client for Cloudreve. Kotlin + Jetpack Compose, Material 3.

Status: **Phase E — v0.1 implemented.** Sign in, browse, download, upload,
rename, mkdir, delete, thumbnails, share-link creation. See `../ROADMAP.md`
for the remaining scope.

## Build

```bash
cd android
ANDROID_HOME=$HOME/Android/Sdk ./gradlew :app:assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
```

CI runs `assembleDebug` on every PR.

## Development backend

`dev/devserver.py` (stdlib Python) builds the server from this checkout,
runs it on `127.0.0.1:5212` and fills a dev account with sample data so
the app can be exercised without touching a real deployment. The emulator
reaches it at `http://10.0.2.2:5212`; sign in as `dev@example.com` /
`cloudreve-dev`.

```bash
dev/devserver.py all     # build + start + seed + push sample files to the emulator
dev/devserver.py login   # install the debug APK and sign in on the emulator via adb
dev/devserver.py status  # pid, API health, credentials
dev/devserver.py reset   # wipe the database and start over
```

Sample data: photos (Lorem Picsum), generated multi-page PDFs, Big Buck
Bunny clips, generated WAVs, a zip, source files, two large blobs for
transfer-progress testing, deep folders, long and non-ASCII names. State
lives in `dev/.data/` (gitignored). Install `ffmpeg`, `vips` or LibreOffice
before the first start to get video, PDF and document thumbnails.

## What's implemented

- `api/v4` auth: password login → access/refresh tokens, single-flight
  refresh on 401, server-side revocation on sign-out
- File browser: folder navigation, cursor pagination, pull-refresh,
  mkdir / rename / delete / download (cache + FileProvider open)
- Uploads: SAF document picker or share-sheet target, WorkManager
  background worker with progress notification, chunked through the
  upload-session flow (local + presigned remote policies)
- Thumbnails via `/file/thumb` (Coil, lazily resolved per row)
- Share-link creation (`PUT /share`), link copied to clipboard
- Search by name as you type (`GET /file?uri=…?name=<q>&case_folding`,
  which works on every server; the full-text endpoint is off unless the
  admin enabled FTS). Scope chips (this folder / everywhere) and type chips
  (images, videos, audio, documents); result rows show the file's folder
- Camera auto-upload: periodic WorkManager sync of new MediaStore
  photos/videos to a configurable remote folder, Wi-Fi-only constraint,
  media-permission gated toggle, synced/failed ID dedup, manual
  "sync now" — settings dialog in the files top bar
- Offline favorites: "Keep offline" in a file's menu downloads to
  `filesDir/offline/` and registers the entry (DataStore JSON);
  star icon in the top bar opens the offline list — open via
  FileProvider, re-download to refresh, remove to delete
- DocumentsProvider: the whole tree appears in the system Files app /
  SAF pickers — browse, open (cached download), thumbnails, rename,
  delete, and search all proxy to `api/v4`
- Task notifications: periodic `GET /workflow` poll posts a
  notification when a task completes/fails/cancels — toggle in the
  settings dialog, runtime POST_NOTIFICATIONS permission gated
- OAuth sign-in: "Sign in with browser" opens the server's consent
  page with PKCE; the `/callback/desktop` page deep-links the code
  back through `cloudreve://mount`, exchanged at `/session/oauth/token`
- Local sync folder: pick a device folder (SAF, persisted permission)
  and a remote folder — periodic WorkManager worker mirrors new/changed
  files upstream, subdirectory structure preserved, unchanged files
  skipped via mtime/size signatures, Wi-Fi-only option
- Quick Settings tile toggling camera backup, with active/inactive state

## UX (feat/android-ux)

Goal: feel like the system Files app.

- Home page like the Files app: search field, Recent strip (newest files
  anywhere in the drive), Images / Videos / Audio / Documents tiles (each a
  server-side `?category=` search listed newest first with the file's
  folder in the subtitle), My files, Offline files
- Material You dynamic colour; folder name as title with parent path
  below; search, list/grid toggle and an overflow menu (sort, select,
  refresh, offline files, settings) instead of a row of icons
- Rows without dividers, rounded thumbnail tiles with per-type icons and
  tints, `size • date` subtitles; grid view with adaptive tiles
- Sort by name / size / date (tap again to flip), persisted, sent to the
  server as `order_by`; folders always first
- Long-press selection (haptic) with select-all, move, copy and batch
  delete; per-file actions in a bottom sheet headed by the file's
  thumbnail and details; Move to / Copy to open a full-screen folder picker
- Upload name clashes are resolved before queuing: Replace (new version),
  Keep both (` (1)` suffix) or Skip
- Delete offers Undo (restores from the trash); Offline files is a full
  screen listing local copies with thumbnails, update and remove
- Trash collection with Restore and Delete forever; share links created
  on demand from a sheet with expiry and optional password, then Copy or
  the system share sheet; Details sheet (size, location, dates, dimensions)
- Folder listings cached per path and shown instantly on re-entry while a
  fresh listing loads behind a thin bar
- Uploads: byte-level progress in a card above the destination folder's
  files and in a notification with Cancel; the folder refreshes itself
  when the batch lands. The home page shows an activity card for uploads
  and for the periodic camera-backup / folder-sync workers while they run. Downloads show a progress ring on the tile; a
  second tap cancels; cached copies open at once
- Images and Videos categories render as an edge-to-edge photo grid (play
  badge on videos); the viewer closes on a vertical swipe
- In-app viewer: swipeable image gallery with pinch zoom, video and
  audio streamed with media3, PDF pages via `PdfRenderer`, plain text
  and source files; everything else goes to the system via `ACTION_VIEW`
- Settings as a full screen (photo backup, folder sync, notifications,
  account)

## Planned next

- No iOS. Ever.
