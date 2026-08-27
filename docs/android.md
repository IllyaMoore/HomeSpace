# The Android app

A native client for the HomeSpace daemon: Kotlin, Jetpack Compose, Material 3.
Not a wrapped web view — it talks to the same HTTP API the browser UI uses, and
does the things a phone can do that a browser tab cannot.

```
android/
├── settings.gradle.kts
├── gradle/libs.versions.toml        version catalog
└── app/src/main/kotlin/io/github/illyamoore/homespace/
    ├── MainActivity.kt              edge-to-edge host, notification intents
    ├── FileActions.kt               share sheet + DownloadManager
    ├── data/
    │   ├── Models.kt                wire types, mirroring docs/api.md
    │   ├── HomeSpaceClient.kt       OkHttp + kotlinx.serialization
    │   ├── EventStream.kt           SSE as a Flow
    │   ├── ServerStore.kt           DataStore server registry
    │   └── HomeSpaceRepository.kt   connection, cache, and stream lifecycle
    ├── ui/
    │   ├── theme/                   the web palette as Material 3 roles
    │   ├── HomeSpaceViewModel.kt
    │   ├── HomeSpaceApp.kt          connect gate, then a four-tab frame
    │   ├── components/
    │   └── screens/                 Connect, Overview, Files, Sessions, Agents
    ├── notify/Notifications.kt
    └── work/SessionWatchWorker.kt
```

- **minSdk 26** (Android 8.0), **targetSdk 35**, JDK 17.
- No dependency injection framework, no navigation graph. Every screen reads
  one ViewModel, and no tab takes an argument, so a graph would add a back
  stack to reason about for nothing.

## What it does that the browser cannot

**Notifies you when an agent finishes.** While the app is open, the SSE stream
fires a notification the moment a session leaves `working`. While it is closed,
a WorkManager job checks in. That job's floor is 15 minutes and Doze can stretch
it further, so treat background notifications as a catch-up rather than a live
feed.

**Plays NAS media in place.** ExoPlayer streams video and audio straight off the
share using the daemon's Range support, so nothing is copied to the phone first.

**Hands files to the rest of Android.** The share sheet passes a URL to whatever
app claims the type; the download button goes through `DownloadManager`, which
survives the app being killed and writes to the public Downloads folder.

## Talking to the daemon

Everything goes through `HomeSpaceClient`. Two details are worth knowing:

- **Bearer token per request**, not an interceptor, because one OkHttp instance
  is shared across every NAS the app knows.
- **Token in the query string** for the SSE stream, images and media. Neither
  `EventSource`, Coil, nor ExoPlayer will attach a header for you, so the daemon
  accepts `?token=` on exactly those routes.

`normalizeBaseUrl` accepts what people actually type — `nas.local`,
`nas.local:7333`, `http://nas.local:7333/` — and rebuilds the result from the
parsed URL rather than trimming strings. It keeps a reverse-proxy subpath, drops
a default port, and discards a pasted query string.

## Building

```sh
cd android
./gradlew assembleDebug      # app/build/outputs/apk/debug/app-debug.apk
./gradlew testDebugUnitTest
./gradlew lintDebug
```

You need the Android SDK (platform 35) and JDK 17. Android Studio will install
both; from the command line, `sdkmanager "platforms;android-35" "build-tools;35.0.0"`.

## CI

Two workflows, both under `.github/workflows/`.

**`android.yml`** runs on any push or PR that touches `android/`: unit tests,
lint, and a debug APK uploaded as `homespace-debug-<sha>`. Reports upload even
when the build fails, which is when they matter.

**`android-release.yml`** runs on a `v*` tag, or manually. It builds a release
APK, uploads it, and attaches it to a **draft** GitHub Release. It lives in its
own file because `android.yml` filters on `paths`, and a path filter on a tag
push does not evaluate the way you would expect — the release would silently
never run.

### Signing

Release signing is optional. Without the secrets the workflow still produces an
APK; it just comes out unsigned, named `-unsigned`, and has to be signed before
it will install.

To sign, generate a keystore and add four repository secrets:

```sh
keytool -genkeypair -v -keystore homespace.jks -keyalg RSA -keysize 4096 \
        -validity 10000 -alias homespace
base64 -w0 homespace.jks    # paste into HOMESPACE_KEYSTORE_BASE64
```

| Secret | What it holds |
| --- | --- |
| `HOMESPACE_KEYSTORE_BASE64` | the keystore file, base64-encoded |
| `HOMESPACE_KEYSTORE_PASSWORD` | keystore password |
| `HOMESPACE_KEY_ALIAS` | key alias (`homespace` above) |
| `HOMESPACE_KEY_PASSWORD` | key password |

Locally, the same values can go in `android/keystore.properties`
(git-ignored) as `storeFile`, `storePassword`, `keyAlias`, `keyPassword`.

**Keep the keystore.** Android identifies an app by its signing key: lose it and
you cannot ship an update over an installed copy.

## Installing the APK

Debug and release builds have different application IDs (`.debug` suffix), so
both can sit on one device. Sideloading needs "install unknown apps" enabled for
whatever app opens the file.

## Cleartext HTTP

The daemon has no TLS and lives on a LAN, so `network_security_config.xml`
permits cleartext. The connect screen warns whenever the address is not `https`.
User-installed CAs are trusted too, so fronting the daemon with your own
certificate works. See [security.md](security.md).

## Testing

```sh
cd android && ./gradlew testDebugUnitTest
```

43 unit tests, covering the parts most likely to break against a changing
daemon: URL building and encoding, auth headers, lenient decoding of every wire
type, error mapping, SSE frame parsing, and the formatters.

The client has also been run against a **live daemon** — a real Claude Code
session, start to result — to confirm every wire type decodes from the JSON the
server actually emits rather than from hand-written mocks. That check found two
bugs the unit tests had not: `normalizeBaseUrl` turned a bare `"http://"` into
`"http://http:"`, and a pasted path was read as a hostname.

There are no Compose UI tests yet, and no instrumented tests — the emulator time
is not worth it for a UI this thin over a well-tested client.

### What CI has verified

Both workflows are green on this branch. `assembleDebug` produces a ~21 MB APK;
`assembleRelease` produces ~2.3 MB, so R8 and the kotlinx.serialization keep
rules in `proguard-rules.pro` are doing their job — without them a minified
build compiles and then fails to parse anything at runtime.

## Not built yet

- **Answering permission prompts.** A session in `manual` mode stalls waiting
  for an approval nobody can give. Use `plan` or `acceptEdits`. This is the same
  gap the web UI has, and the same fix — an approvals endpoint — closes both.
- Pairing by QR code, instead of typing a 43-character token on a phone.
- A home-screen widget for running sessions.
- Play Store packaging (an App Bundle and the store listing).
