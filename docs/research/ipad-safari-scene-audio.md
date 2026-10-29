# Research: what iPad Safari allows for Scene audio

Findings for [#244](https://github.com/Larront/grimoire/issues/244), on the map
[Grimoire on the web](https://github.com/Larront/grimoire/issues/242).

Researched 2026-10-30. Current releases at that date: Safari 27.0 (iOS/iPadOS 27,
September 2026). Facts only, no design decisions for Grimoire.

**How to read the confidence marks**

- **[Apple]**: Apple or WebKit wrote it (WebKit blog, Apple developer docs, a WebKit
  engineer's comment on WebKit Bugzilla).
- **[Source]**: read directly from the WebKit source code on `main` (October 2026).
  This is what the code does. It has not been checked on an iPad.
- **[Compat]**: MDN browser-compat-data or caniuse. Both are maintained by the community
  and based on testing, not on what Apple says.
- **[Observed]**: reports from developers in bug threads or forums. Not confirmed by
  Apple and not reproduced here.

**What Grimoire does today** (`src/lib/stores/audio-engine.svelte.ts`): one shared
`AudioContext` with a master `GainNode`. Each local slot `fetch`es the whole file,
decodes it fully with `decodeAudioData` into an `AudioBuffer`, and plays it through an
`AudioBufferSourceNode` (with `loop` set for looping slots) and its own `GainNode`. Fades
use `linearRampToValueAtTime`. No `<audio>` elements are used for local slots.

---

## 1. Starting sound: the user-gesture rule

**The rule.** In WebKit, an `AudioContext` starts out blocked. It is unblocked the first
time it tries to play, or `resume()` is called, while the page has _transient user
activation_. A tap, click or key press grants that activation, and it lasts **5 seconds**.
Once unblocked, the flag stays cleared for the life of **that** `AudioContext`.

- [Source] `AudioContext::constructCommon` adds `RequireUserGestureForAudioStartRestriction`
  when the page requires a user gesture for audio playback. iOS Safari does.
  `willBeginPlayback()` removes it only if `shouldDocumentAllowWebAudioToAutoPlay()`
  passes, and that check ends with `window->hasTransientActivation()`.
  ([AudioContext.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/webaudio/AudioContext.cpp))
- [Source] Transient activation lasts 5 s:
  `static constexpr Seconds defaultTransientActivationDuration { 5_s };`
  ([LocalDOMWindow.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/LocalDOMWindow.cpp)).
  So an `await` between the tap and `resume()` or `start()` is fine as long as it
  finishes within about 5 s. This follows from the code and has not been tested on a device.
- [Apple] The original iOS rule, from 2012: `play()` and `load()` "are also inactive until
  the user initiates playback, unless … triggered by user action". The same document says
  "This requirement applies to media played by `<audio>` tags, `<video>` tags, and Web
  Audio." ([Safari HTML5 Audio and Video Guide, iOS-Specific Considerations](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/Using_HTML5_Audio_Video/Device-SpecificConsiderations/Device-SpecificConsiderations.html),
  archived, last updated 2012-12-13.)
- [Apple] What counts as a gesture: a handler for `touchend`, `click`, `doubleclick` or
  `keydown` ([New `<video>` Policies for iOS](https://webkit.org/blog/6784/new-video-policies-for-ios/),
  2016, iOS 10).

**Does one unlock cover later playback started by other taps?**

- **Web Audio: yes, for the same `AudioContext`.** [Source] The restriction is a flag
  on the context, and nothing in `AudioContext.cpp` puts it back once it has been
  removed. Later `AudioBufferSourceNode.start()` calls on that running context need no
  further gesture. A **new** `AudioContext` starts blocked again and needs its own
  gesture. So a Scene switch started from any later tap, such as a Scene link in a PDF,
  plays on an already-unlocked context.
- **`<audio>` elements: the unlock belongs to each element.** [Source] The audio rule
  (`RequireUserGestureForAudioRateChange`) is stored on each element's media session.
  `HTMLMediaElement::removeBehaviorRestrictionsAfterFirstUserGesture()` clears it for
  _that element_ when `play()` or `load()` runs inside a gesture. It also records
  "user interacted with a media element" on the main document, but
  `MediaElementSession::playbackStateChangePermitted` reads that record only behind a
  per-site quirk. So each new `<audio>` element needs its own gesture-initiated
  `play()` or `load()`. After that, `play()` on the same element works without a gesture.
  ([MediaElementSession.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/MediaElementSession.cpp),
  [HTMLMediaElement.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/HTMLMediaElement.cpp))
- **The "interrupted" state.** On iOS the context can move to the non-standard state
  `"interrupted"`, for example during a phone call or Siri, or when another app takes the
  audio session. [Compat] `BaseAudioContext.state` `interrupted` has been listed since
  Safari 9. [Source] After an interruption, `resumeRendering()` reports `interrupted`
  again if the media session is still interrupted. [Observed] Contexts sometimes stay
  stuck in `interrupted`, or report `running` but make no sound, after backgrounding or
  in Home Screen apps:
  [bug 273511](https://bugs.webkit.org/show_bug.cgi?id=273511) (iOS 17, open),
  [bug 281955](https://lists.webkit.org/pipermail/webkit-unassigned/2024-October/1191544.html)
  (2024), and
  [bug 291892](https://bugs.webkit.org/show_bug.cgi?id=291892) (iOS 18 to 26; one user
  reported it fixed in iOS 26.2 beta 3, but Apple has not confirmed).

**Versions.** The unprefixed `AudioContext`, spec-aligned behaviour and AudioWorklet
arrived in Safari 14.1 / iPadOS 14.5 [Apple]
([New WebKit Features in Safari 14.1](https://webkit.org/blog/11648/new-webkit-features-in-safari-14-1/)).
`decodeAudioData` has returned a Promise since Safari 14.1 [Compat].

---

## 2. Many tracks at once

**Simultaneous Web Audio sources: there is no fixed limit on iPad.**

- [Source] WebKit's only cap on contexts is `maxHardwareContexts = 4`, and the check
  is compiled only under `#if OS(WINDOWS)`. It does not apply to iOS or iPadOS
  ([AudioContext.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/webaudio/AudioContext.cpp)).
- Neither the Web Audio spec nor WebKit caps the number of `AudioBufferSourceNode`s.
  The practical limits are CPU and memory.

**Simultaneous `<audio>` elements**

- [Apple, outdated] The 2012 guide says "all devices running iOS are limited to
  playback of a single audio or video stream at any time" (same archived guide as above).
- [Source] Current WebKit enforces "one at a time" (`ConcurrentPlaybackNotPermitted`) only
  for the `VideoAudio` media type, which means `<video>` with sound. Plain `<audio>`
  elements are not restricted by it.
  `MediaSessionManageriOS::resetRestrictions()` adds `ConcurrentPlaybackNotPermitted`,
  `BackgroundProcessPlaybackRestricted` and `SuspendedUnderLockPlaybackRestricted` to
  `VideoAudio` only
  ([MediaSessionManagerIOS.mm](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/audio/ios/MediaSessionManagerIOS.mm)).
- [Apple] A WebKit engineer, 2018: "On iOS, there is only one video element with audio
  that can play at a time." ([bug 176282](https://bugs.webkit.org/show_bug.cgi?id=176282), comment 1)
- [Observed] In the same thread, several separate `<audio>` elements played at once
  intermittently on iOS 13.6 and reliably on iOS 14.

**Memory taken by decoded audio**

- [Spec] `decodeAudioData` decodes to linear PCM and resamples to the context's
  `sampleRate`. An `AudioBuffer` holds 32-bit floats. The cost in memory is therefore
  **seconds × sampleRate × channels × 4 bytes**, no matter how small the source file is.
  ([Web Audio API spec: decodeAudioData](https://www.w3.org/TR/webaudio/#dom-baseaudiocontext-decodeaudiodata),
  [AudioBuffer](https://www.w3.org/TR/webaudio/#AudioBuffer))

  | Length of track (stereo, 48 kHz) | Decoded size |
  | -------------------------------- | ------------ |
  | 1 minute                         | ≈ 23 MB      |
  | 10 minutes                       | ≈ 230 MB     |
  | 60 minutes                       | ≈ 1.38 GB    |

  48 kHz is a common hardware rate. The real rate is whatever `ctx.sampleRate` reports.

- [Source] WebKit's decoder holds the whole compressed file _and_ the whole decoded
  result in memory during decoding. `demuxWebMData` and `demuxAVFData` read every sample
  into a `Vector`, then `createBus` allocates an `AudioBus` for the full frame count
  ([AudioFileReaderCocoa.mm](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/audio/cocoa/AudioFileReaderCocoa.mm)).
- [Apple] **There is no published memory limit, and no way to read one from JavaScript.**
  A WebKit engineer reproduced a tab being killed by iOS's memory killer at "over 1.5GB"
  while decoding, and wrote: "We cannot use that much memory on iOS without getting
  killed" and "Sadly, there is not really a way to know from JS."
  ([bug 227636](https://bugs.webkit.org/show_bug.cgi?id=227636), 2021, Safari 14, still open).
- [Observed] On an iPad 5th gen, repeatedly decoding and creating a source node
  crashed the tab after about 10–12 iterations
  ([bug 230192](https://bugs.webkit.org/show_bug.cgi?id=230192), 2021). Decoded memory
  was reported to be freed about a minute late
  ([bug 189337](https://bugs.webkit.org/show_bug.cgi?id=189337), 2018). Back-to-back
  `decodeAudioData` calls failed where calls about 100 ms apart worked, and the maximum
  number of calls differed between iPhone and iPad (bug 227636, reporter).

**Decoding fully versus streaming through a media element**

- _Full decode_ (`decodeAudioData` → `AudioBufferSourceNode`, what Grimoire does): memory
  as calculated above. Looping is sample-accurate (see §4). Volume is through `GainNode`.
- _Streaming_ (`<audio src>`, optionally routed into the graph with
  `createMediaElementSource`): only a small decode buffer is held. The trade-offs on
  WebKit:
  - The loop is done by the media element, not Web Audio, and is **not seamless**. See §4.
  - Each element needs its own gesture-initiated `play()` (§1).
  - A playing, audible `<audio>` changes the page's audio session to "media playback" (§5).
  - Setting `HTMLMediaElement.volume` from script had **no effect on iPadOS before Safari
    26.0** [Apple]: "Fixed media elements on iPadOS to support the volume being changed by
    web developers, similar to macOS and visionOS."
    ([WebKit Features in Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)).
    Before that, [Apple] "The `volume` property is not settable in JavaScript. Reading the
    `volume` property always returns 1." (2012 guide). [Compat] MDN marks
    `HTMLMediaElement.volume` as a partial implementation on Safari iOS for the same reason.
  - Setting `.volume` on an element connected to an `AudioContext` had no effect until
    **Safari 27.0** [Apple]
    ([WebKit Features for Safari 27.0](https://webkit.org/blog/18325/webkit-features-for-safari-27-0/)).
    Volume through a `GainNode` placed after `createMediaElementSource` is not affected.

---

## 3. Screen lock and backgrounding

**Web Audio stops by default when Safari goes to the background or the iPad locks.**

- [Source] iOS sets `BackgroundProcessPlaybackRestricted` on the `WebAudio` media type
  (`MediaSessionManageriOS::resetRestrictions()`). When the app goes to the background,
  which includes the screen locking, `applicationDidEnterBackground` interrupts sessions
  with that restriction
  ([MediaSessionManagerInterface.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/audio/MediaSessionManagerInterface.cpp)).
  This restriction was added in January 2021
  ([commit 7b6e8ee](https://github.com/WebKit/WebKit/commit/7b6e8ee368d4ca4174f119d54471d627d64b7395),
  [bug 220879](https://bugs.webkit.org/show_bug.cgi?id=220879)).
- [Apple] WebKit's Jer Noble, 2022: "On iOS, WebAudio is considered "Ambient" audio
  from the system's perspective, and ambient audio is blocked by the system once the app
  producing it is no longer foreground."
  ([bug 198277, comment 71](https://bugs.webkit.org/show_bug.cgi?id=198277#c71))
- [Apple] Apple's own definition of the `ambient` category: "Screen locking and the
  Silent switch … silence your audio."
  ([AVAudioSession.Category.ambient](https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/ambient))

**`navigator.audioSession.type = "playback"` keeps Web Audio playing in the background.**

- [Source] `AudioContext::shouldOverrideBackgroundPlaybackRestriction()` returns
  `hasPlayBackAudioSession(document)`, which is true when the page's audio session type
  is `playback` or `play-and-record`. The layout test
  [`webaudio-background-playback.html`](https://github.com/WebKit/WebKit/blob/main/LayoutTests/media/webaudio-background-playback.html)
  asserts: default type, so Web Audio stops in the background; `playback` or
  `play-and-record`, so it keeps playing.
- [Apple] The fix that made this work is
  [bug 261554](https://bugs.webkit.org/show_bug.cgi?id=261554), "[iOS] AudioContext is
  getting suspended when page goes in the background even if navigator.audioSession.type
  is set to playback". It landed on WebKit `main` on 2024-03-01
  ([commit b848143](https://github.com/WebKit/WebKit/commit/b848143a2ad57c80405dc5b30e61c750f5896d72))
  and on the Safari 17 release branch (`safari-7618-branch`) on 2024-06-06. The same
  commit lets such an `AudioContext` show **Now Playing / lock-screen controls** and
  respond to remote play and pause.
- [Observed] Reporters on that bug say it worked in iOS 17.1, broke in 17.2 and 17.3,
  and worked again in **iOS 17.5**. Treat iPadOS 17.5 or later, and certainly 18 or later,
  as the versions where this works. Apple does not publish an exact version.
- [Apple] A WebKit engineer, 2024: "since iOS 17, `navigator.audioSession.type = "playback"`"
  keeps audio from being suspended
  ([bug 237322, comment 6](https://bugs.webkit.org/show_bug.cgi?id=237322)).

**`<audio>` elements**

- [Source] Plain `<audio>` (`MediaType::Audio`) has none of the background or lock
  restrictions on iOS. Only `VideoAudio` gets `SuspendedUnderLockPlaybackRestricted`.
  An audible `<audio>` therefore keeps playing when Safari is in the background or the
  screen is locked, and it puts the page in the media-playback category (§5).

**Home Screen web apps behave differently**

- [Apple] For years, audio stopped when a _standalone_ Home Screen web app left the
  foreground, while the same page kept playing in Safari. WebKit's Maciej Stachowiak:
  "this is indeed fixed", shipped in **iOS 15.4**
  ([bug 198277](https://bugs.webkit.org/show_bug.cgi?id=198277), comments 75–76;
  duplicate of [bug 232909](https://bugs.webkit.org/show_bug.cgi?id=232909)).
  The test case reporters used was a looping media element.
- [Observed] Home Screen apps still have their own Web Audio bugs: a context that is
  silent after coming back from the background, sometimes reporting `running`. Only
  clearing the cache or reinstalling the Home Screen app helped
  ([bug 291892](https://bugs.webkit.org/show_bug.cgi?id=291892), iOS 18 to 26, open). An
  iOS 26 regression where an `<audio>` element fails to play on reopening a Home Screen
  app is tracked as bug 295518, which that thread links to.
- [Apple] Since **iOS/iPadOS 26**, "By default, every website added to the Home Screen
  opens as a web app" (users can turn off "Open as Web App")
  ([News from WWDC25: WebKit in Safari 26 beta](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/)).
  So on iPadOS 26 and later, adding Grimoire to the Home Screen puts it in the standalone mode above.

---

## 4. Seamless loops and fades

**Looping with `AudioBufferSourceNode.loop` is sample-accurate.**

- [Spec] The source node loops the in-memory buffer between `loopStart` and `loopEnd`
  without restarting a decoder ([Web Audio spec: AudioBufferSourceNode](https://www.w3.org/TR/webaudio/#AudioBufferSourceNode)).
- [Apple] A WebKit bug where iOS handled the `duration` argument of `start()` wrongly on a
  looping node, so starts with an offset sometimes failed, was fixed in January 2023
  ([bug 248658](https://bugs.webkit.org/show_bug.cgi?id=248658), 259234@main. Going by
  the date, it most likely shipped in Safari 16.4.)
- [Apple] "Fixed stale audio buffer data after seeking when playing sound through an
  AudioContext": Safari 26.0
  ([WebKit Features in Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)).

**Looping with `<audio loop>`, alone or through `createMediaElementSource`, is not seamless.**

- [Apple] WebKit's Chris Dumez reproduced the gap ("I definitely hear a pause between the
  loops now. The behavior is different than in Chrome.") and explained it: "The looping
  logic happens on media side and not on WebAudio side."
  ([bug 230553](https://bugs.webkit.org/show_bug.cgi?id=230553), open since 2021. Duplicates
  go back to 2009: [bug 28748](https://bugs.webkit.org/show_bug.cgi?id=28748).)

**The file itself can add a gap.**

- [Observed] Safari's `decodeAudioData` returned an MP3 buffer about 3000 samples shorter
  than Chrome's, cutting the start
  ([bug 223519](https://bugs.webkit.org/show_bug.cgi?id=223519), Safari 14, open, no
  analysis by WebKit). MP3 and AAC encoders add priming and padding samples. Whether a
  given file loops cleanly depends on how that padding is trimmed, and browsers differ on
  this. Uncompressed WAV has no padding.

**Gain ramps and fades**

- [Compat] `linearRampToValueAtTime`, `exponentialRampToValueAtTime`, `setTargetAtTime`,
  `setValueAtTime` and `setValueCurveAtTime` have been supported since Safari 6.
  `cancelAndHoldAtTime` since **14.1**. `cancelScheduledValues` was only partial before
  14.1, because it did not cancel a curve already in progress
  ([MDN BCD AudioParam](https://github.com/mdn/browser-compat-data/blob/main/api/AudioParam.json)).
- [Apple] WebKit's automation timeline was rewritten to match the spec in late 2020, and
  this shipped in Safari 14.1. Related fixes:
  [bug 215904](https://bugs.webkit.org/show_bug.cgi?id=215904) (linear ramp formula),
  bug 216284 (ramps with no preceding event had no effect), and
  [bug 216804](https://bugs.webkit.org/show_bug.cgi?id=216804) (`setTargetAtTime`
  followed by a ramp).
- Spec behaviour that matters for fades: a ramp runs from the _previous scheduled event_,
  not from the current value. On spec-aligned engines, including Safari 14.1 and later,
  a ramp with no `setValueAtTime` before it can jump or appear to do nothing. Writing
  `.value` directly while automation is scheduled is ignored or overridden.
  ([Web Audio spec: AudioParam automation](https://www.w3.org/TR/webaudio/#dom-audioparam-linearramptovalueattime))
- No current open WebKit bug about clicks or glitches in gain ramps turned up in this research.

---

## 5. The silent switch and the audio session

**Web Audio follows Silent mode by default. `<audio>` does not.**

- [Source] With no override, WebKit picks the iOS audio-session category from what the
  page is playing (`MediaSessionManagerCocoa::updateSessionState()`):
  - any audible `<video>`, or audible `<audio>`/`<video>`, gives **`MediaPlayback`**;
  - otherwise, if Web Audio is in use, **`AmbientSound`**.

  ([MediaSessionManagerCocoa.mm](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/audio/cocoa/MediaSessionManagerCocoa.mm))

- [Apple] What the categories do. `ambient`: "audio from other apps mixes with your
  audio. Screen locking and the Silent switch … silence your audio." `playback`: "your
  app audio continues with the Silent switch set to silent or when the screen locks", and
  is "nonmixable — activating your session will interrupt any other audio sessions"
  ([ambient](https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/ambient),
  [playback](https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/playback)).
- [Observed, acknowledged by Apple] With the switch on silent, `<audio>` is audible and
  Web Audio is not ([bug 237322](https://bugs.webkit.org/show_bug.cgi?id=237322), iOS 15).
  The workaround used before the Audio Session API was to play a silent `<audio>` file.
  That moves the whole page into `MediaPlayback`, so Web Audio becomes audible too.
  Wikipedia shipped this, with side effects on performance and lock-screen controls.

**A page can influence it with the Audio Session API.**

- [Compat] `navigator.audioSession` and `AudioSession.type` were added in **Safari 16.4**,
  iOS the same. `AudioSession.state` and `statechange` are not supported
  ([MDN BCD AudioSession](https://github.com/mdn/browser-compat-data/blob/main/api/AudioSession.json),
  [MDN: AudioSession.type](https://developer.mozilla.org/en-US/docs/Web/API/AudioSession/type),
  [W3C Audio Session draft](https://www.w3.org/TR/audio-session/)). It is not supported in
  Chrome or Firefox.
- [Source] How WebKit maps each type to an iOS category
  ([DOMAudioSession.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/audiosession/DOMAudioSession.cpp)):

  | `navigator.audioSession.type` | iOS category                        | Silent mode           | Other apps' audio (e.g. Music, Spotify) |
  | ----------------------------- | ----------------------------------- | --------------------- | --------------------------------------- |
  | `auto` (default)              | chosen from what is playing (above) | depends               | depends                                 |
  | `playback`                    | `MediaPlayback`                     | plays                 | interrupted                             |
  | `ambient`, `transient`        | `AmbientSound`                      | silenced              | mixes                                   |
  | `transient-solo`              | `SoloAmbientSound`                  | silenced (bug 264473) | interrupted                             |
  | `play-and-record`             | `PlayAndRecord`                     | plays                 | interrupted                             |

  Setting the type needs no user gesture. It does need the Microphone permissions policy
  enabled for the document; if not, it is silently ignored. That only matters inside an
  iframe.

- [Apple] "the default type is `ambient` … muted when the phone is muted"; with
  `playback` the audio is not suspended (WebKit's Jean-Yves Avenard,
  [bug 237322, comment 6](https://bugs.webkit.org/show_bug.cgi?id=237322), 2024).
- [Apple + Observed] `transient` and `transient-solo` are silenced by Silent mode. WebKit's
  youenn fablet (iOS 18, 2025-01-24) says this matches Apple's documentation for the
  ambient category. One developer reported no sound from them at all on iOS 18.3.1.
  `transient` mixes with the Music app (iOS 17.4). `play-and-record` paused other apps'
  audio once the microphone was in use (iOS 17.4)
  ([bug 264473](https://bugs.webkit.org/show_bug.cgi?id=264473), resolved INVALID).

**What Silent mode is on an iPad**

- [Apple] Most current iPads have no hardware switch. Silent mode is a Control Center
  button, and "certain models" have a side switch that can be set to mute or to rotation
  lock. Apple says Silent mode does not mute music, podcasts, movies and TV
  ([Adjust the volume and silence on iPad](https://support.apple.com/guide/ipad/ipad9940e758/ipados)).
  This was read from a search snippet because the page itself would not load. Web Audio
  under the default `ambient` category _is_ muted by it, as shown above.

---

## 6. Formats iPad Safari decodes

Version numbers are iPadOS/Safari. Support for `<audio>` and for `decodeAudioData` is
listed separately where they differ. Both rely on Apple's media frameworks: [Source]
`decodeAudioData` uses a WebM demuxer for WebM and AVFoundation/AudioToolbox for
everything else, including Ogg (`'Oggf'` maps to `audio/ogg`)
([AudioFileReaderCocoa.mm](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/audio/cocoa/AudioFileReaderCocoa.mm)).

| Format                | iPad Safari                                                                                  | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MP3**               | Yes, all versions                                                                            | [Compat] Safari 3.1 / iOS 3 ([MDN audio codecs](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Audio_codecs)). [Observed] Leading samples can be lost when decoding (bug 223519, §4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **AAC** (.m4a/.mp4)   | Yes, all versions                                                                            | [Compat] MDN. This is Apple's native codec.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **ALAC** (.m4a)       | Yes                                                                                          | [Compat] MDN: "macOS and iOS have integrated support".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **WAV** (PCM)         | Yes                                                                                          | Not listed clearly in MDN's tables. Long-standing support through AudioToolbox, which is [Source] the path `decodeAudioData` uses. Not confirmed by a first-party statement.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **FLAC**              | Yes, **iOS 11+**                                                                             | [Compat] caniuse: iOS Safari 11.0+ "y" ([caniuse FLAC](https://caniuse.com/flac)); MDN codec table: Safari 11. MDN's container guide contradicts this ("not supported at all on iOS"), and that line looks stale. No first-party Apple statement was found.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Ogg Vorbis** (.ogg) | **iPadOS 18.4+** only                                                                        | [Apple] "adding Ogg container support for both Opus and Vorbis audio on macOS Sequoia 15.4, iOS 18.4, iPadOS 18.4, and visionOS 2.4" ([WebKit Features in Safari 18.4](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/), 2025-03-31). [Compat] caniuse: iOS 17.4–18.3 Vorbis only in WebM, not Ogg; before 17.4 not at all. [Apple] MIME type matters. WebKit's Karl Dubost, 2025-07-02: "Safari and Chrome do not support application/x-ogg" but "they both support audio/ogg", and a file served with the wrong type is downloaded instead of played ([bug 258081](https://bugs.webkit.org/show_bug.cgi?id=258081)). [Observed] A 2025 third-party test calls Safari 18.4's Ogg support incomplete and buggy ([frequal.com](https://frequal.com/java/OggOpusStillNotWorkingInSafari18_4.html)). |
| **Ogg Opus** (.opus)  | **iPadOS 18.4+**                                                                             | [Apple] same Safari 18.4 note. [Compat] caniuse: iOS 18.4+ "y". Before that, Opus only in CAF (iOS 11+) or WebM (iOS 17.4+).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **WebM Opus/Vorbis**  | `decodeAudioData`: from about iOS 15. `<audio>`: iOS 17.4+ (Opus), with regressions reported | [Observed] Safari 15 claimed WebM Opus in `canPlayType` but `decodeAudioData` failed ([bug 183852](https://bugs.webkit.org/show_bug.cgi?id=183852), [bug 238546](https://bugs.webkit.org/show_bug.cgi?id=238546)). Later reports say Web Audio worked while `<audio>` did not on iOS 17. [Apple] A WebM Vorbis file playing "in burst" was fixed in May 2024 ([bug 273866](https://bugs.webkit.org/show_bug.cgi?id=273866), 278665@main). Safari 27.0 fixed decoding WebM with more than 2 channels, and fixed `decodeAudioData` on MP4 files containing Opus.                                                                                                                                                                                                                                                  |

Note for GMs bringing their own files: before iPadOS 18.4, `.ogg` files (very common in
TTRPG ambience packs) do not decode in iPad Safari at all. From 18.4 they should, but
with the reliability caveats above.

---

## Version cheat-sheet

| iPadOS / Safari | What changed for this question                                                                                                    |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 11              | FLAC; Opus in CAF only                                                                                                            |
| 14.5 / 14.1     | Unprefixed, spec-aligned Web Audio; AudioWorklet; `cancelAndHoldAtTime`; Promise-based `decodeAudioData`                          |
| 15.4            | Audio keeps playing when a standalone Home Screen web app is backgrounded (media elements)                                        |
| 16.4            | `navigator.audioSession.type`; fix for looping `AudioBufferSourceNode` started with offset or duration                            |
| 17.4            | WebM Opus/Vorbis in `<audio>` (caniuse, partial)                                                                                  |
| 17.5–18         | `audioSession.type = "playback"` keeps Web Audio playing in the background or with the screen locked, with Now Playing controls   |
| 18.4            | Ogg Vorbis and Ogg Opus                                                                                                           |
| 26.0            | `HTMLMediaElement.volume` settable on iPadOS; every Home Screen site opens as a web app; AudioContext stale-buffer-after-seek fix |
| 26.2            | (Observed) Home Screen web app silent-AudioContext bug possibly fixed                                                             |
| 27.0            | `.volume` works on elements routed into an `AudioContext`; multichannel WebM and MP4-Opus decoding fixes                          |

## Open questions this research could not settle

- The actual memory ceiling for a Safari tab on a given iPad model. Apple does not
  publish it and JavaScript cannot read it (bug 227636). It can only be measured on devices.
- Whether `<audio loop>` is still audibly gapped on iPadOS 26/27. Bug 230553 is still open,
  but nobody has confirmed it on recent versions.
- Exactly which point release first shipped the bug 261554 fix (17.5 according to a user
  report, the 17.x branch according to the commit, 18.0 at the latest).
- How the `"interrupted"` and silent-but-`running` states behave in practice on
  iPadOS 26.2 and later.
