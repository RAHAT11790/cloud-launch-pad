# Multi-audio MKV playback + player optimization

## Finding (live check of the given link)
- Video: H.264 1080p
- Audio: 3 AAC tracks — Hindi, English, Japanese
- Subtitle: English (ASS)

Browsers play MKV with only the first audio track and give the site no way to switch (MX Player works because it has its own decoder). All codecs here are browser-supported, so switching is possible if the player unpacks the file itself.

## What to build
1. **In-browser MKV engine**: the player reads the MKV in small byte chunks (Range requests), separates video + the chosen audio track, and feeds them to the browser (Media Source). No server change, works with the existing thousands of links.
2. **Audio menu**: list tracks by language (Hindi / English / Japanese), instant switching keeping the current time. Remember the user's last language.
3. **Subtitles**: show the embedded English subtitle as an optional track.
4. **Fallback**: if a file uses an unsupported audio codec (AC3/DTS) or the engine fails, fall back to normal playback automatically — never a black screen.
5. **Speed/optimization**: fast start (small first chunk), prefetch ahead, fast seeking via the MKV index, cleanup of old buffer to avoid lag on mobile.
6. **Polished player UI**: clean audio/subtitle/quality sheet, loading states, clear error messages.

## Testing
- Live test with this exact URL in the real player: confirm 3 tracks appear, each language actually plays, seeking and switching work, screenshots on mobile + desktop.
- Check HLS/AN and normal MP4 links still play as before.

## Technical details
- Demux with a lightweight EBML/Matroska parser (or `mkvdemux`-style lib) + remux to fMP4 (mp4box.js/mux.js-style) into MSE SourceBuffers (`video/mp4; codecs="avc1…, mp4a.40.2"`).
- Cues element used for seek; fallback to native `<video src>` on any error.
- Integrate into the existing VideoPlayer (not SaltPlayer).
