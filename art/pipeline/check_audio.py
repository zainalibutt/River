"""Gates for generated audio.

Sound is harder to review than geometry: a render can be looked at in a second,
and a hundred short files cannot be listened to on every build. So the things
that go wrong silently are checked instead.

Each gate exists because of a failure it catches, and each one blocks the build
rather than logging. Run with --self-test to prove they fire against input that
is deliberately broken - a gate nobody has seen fail is not known to work.
"""

import json
import math
import os
import struct
import sys
import wave

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'out', 'audio')

DOWNLOAD_BUDGET_KB = 1024
EXPECTED_RATE = 22050
EXPECTED_CHANNELS = 1

# A one-shot outside this is not a one-shot.
MIN_SECONDS = 0.02
MAX_SECONDS = 3.0

# Peak must leave headroom, because several of these layer.
MAX_PEAK = 0.92
# Anything under this is inaudible against a venue bed.
MIN_RMS = 0.004
# ...and anything over it will make a player reach for the volume.
MAX_RMS = 0.36
# The loudest effect may not be more than this many times the quietest.
MAX_RMS_SPREAD = 14.0

MAX_DC_OFFSET = 0.02
# A buffer that does not begin and end at zero clicks on every playback. This
# is about the discontinuity at the boundary, so it is the first and last
# sample specifically - a waveform that starts at zero and rises steeply within
# a millisecond is fine, and checking a window would reject it.
MAX_EDGE = 0.02


def read_wav(path):
    with wave.open(path, 'rb') as handle:
        channels = handle.getnchannels()
        rate = handle.getframerate()
        width = handle.getsampwidth()
        frames = handle.readframes(handle.getnframes())
    if width != 2:
        return None, channels, rate, 'sample width %d, expected 16 bit' % (width * 8)
    count = len(frames) // 2
    values = struct.unpack('<%dh' % count, frames)
    return [value / 32768.0 for value in values], channels, rate, None


def measure(samples):
    if not samples:
        return {'peak': 0.0, 'rms': 0.0, 'dc': 0.0, 'head': 0.0, 'tail': 0.0}
    peak = max(abs(value) for value in samples)
    rms = math.sqrt(sum(value * value for value in samples) / len(samples))
    dc = sum(samples) / len(samples)
    head = abs(samples[0])
    tail = abs(samples[-1])
    return {'peak': peak, 'rms': rms, 'dc': dc, 'head': head, 'tail': tail}


def check_clip(entry, samples, channels, rate):
    """Every gate for one file. Returns a list of failures, empty when it passes."""
    name = entry['id']
    failures = []

    if channels != EXPECTED_CHANNELS:
        failures.append('%s: %d channels, expected mono' % (name, channels))
    if rate != EXPECTED_RATE:
        failures.append('%s: %d Hz, expected %d' % (name, rate, EXPECTED_RATE))

    seconds = len(samples) / max(1, rate)
    if seconds < MIN_SECONDS or seconds > MAX_SECONDS:
        failures.append('%s: %.3fs outside %.2f to %.2f' % (name, seconds, MIN_SECONDS, MAX_SECONDS))

    stats = measure(samples)

    # The one that matters most. A file of zeros passes duration, passes peak,
    # passes size, and is the audio equivalent of the empty venue.
    if stats['rms'] < MIN_RMS:
        failures.append('%s: silent or near silent, rms %.5f' % (name, stats['rms']))
    if stats['rms'] > MAX_RMS:
        failures.append('%s: too loud, rms %.4f over %.2f' % (name, stats['rms'], MAX_RMS))
    if stats['peak'] > MAX_PEAK:
        failures.append('%s: peak %.3f leaves no headroom for layering' % (name, stats['peak']))
    if abs(stats['dc']) > MAX_DC_OFFSET:
        failures.append('%s: dc offset %.4f will click and eat headroom' % (name, stats['dc']))
    if stats['head'] > MAX_EDGE:
        failures.append('%s: starts at %.3f, will click on play' % (name, stats['head']))
    if stats['tail'] > MAX_EDGE:
        failures.append('%s: ends at %.3f, will click on stop' % (name, stats['tail']))

    return failures, stats


def check_music(manifest):
    """
    A track without a licence is a track that cannot ship.

    The slot is allowed to be empty. What is not allowed is a file present with
    nothing recording where it came from - that is how a public repository ends
    up publishing somebody's master.
    """
    failures = []
    for track in manifest.get('music', []):
        if track.get('file') is None:
            continue
        for field in ('title', 'licence', 'attribution'):
            if not track.get(field):
                failures.append('music %s: has a file but no %s' % (track.get('id'), field))
    return failures


def run(manifest_path=None):
    path = manifest_path or os.path.join(OUT_DIR, 'manifest.json')
    if not os.path.exists(path):
        print('FAIL: no audio manifest at ' + path)
        return 1
    with open(path, encoding='utf-8') as handle:
        manifest = json.load(handle)

    root = os.path.dirname(os.path.dirname(path))
    failures = []
    all_rms = []
    total_bytes = 0

    for entry in manifest.get('effects', []):
        file_path = os.path.join(root, entry['file'].replace('audio/', 'audio' + os.sep))
        if not os.path.exists(file_path):
            failures.append('%s: file missing at %s' % (entry['id'], file_path))
            continue
        total_bytes += os.path.getsize(file_path)
        samples, channels, rate, error = read_wav(file_path)
        if error is not None:
            failures.append('%s: %s' % (entry['id'], error))
            continue
        clip_failures, stats = check_clip(entry, samples, channels, rate)
        failures.extend(clip_failures)
        all_rms.append((entry['id'], stats['rms']))
        print(
            'CHECK %-12s %.3fs peak %.2f rms %.4f dc %+.4f'
            % (entry['id'], len(samples) / rate, stats['peak'], stats['rms'], stats['dc'])
        )

    # One effect far louder than the rest is the complaint nobody files, they
    # just turn the sound off.
    if len(all_rms) > 1:
        loudest = max(all_rms, key=lambda pair: pair[1])
        quietest = min(all_rms, key=lambda pair: pair[1])
        if quietest[1] > 0 and loudest[1] / quietest[1] > MAX_RMS_SPREAD:
            failures.append(
                'spread: %s is %.1fx louder than %s, over %.0fx'
                % (loudest[0], loudest[1] / quietest[1], quietest[0], MAX_RMS_SPREAD)
            )

    failures.extend(check_music(manifest))

    kb = total_bytes // 1024
    if kb > DOWNLOAD_BUDGET_KB:
        failures.append('download: %dKB over the %dKB budget' % (kb, DOWNLOAD_BUDGET_KB))

    print('AUDIO_TOTAL %dKB of %dKB budget' % (kb, DOWNLOAD_BUDGET_KB))
    if failures:
        for failure in failures:
            print('FAIL ' + failure)
        return 1
    print('PASS %d effects' % len(manifest.get('effects', [])))
    return 0


def self_test():
    """
    Prove each gate fires. A checker nobody has watched fail is not a checker.
    """
    rate = EXPECTED_RATE
    good = [math.sin(2 * math.pi * 440 * (i / rate)) * 0.4 * math.exp(-6 * (i / rate))
            for i in range(int(0.3 * rate))]
    entry = {'id': 'probe'}

    cases = [
        ('silence', [0.0] * len(good), 'silent'),
        ('clipped', [1.0 if i % 2 else -1.0 for i in range(len(good))], 'headroom'),
        ('dc offset', [value + 0.2 for value in good], 'dc offset'),
        ('clicky start', [0.9] + good, 'starts at'),
        ('clicky end', good + [0.9], 'ends at'),
        ('too short', good[:100], 'outside'),
        ('too long', good * 40, 'outside'),
    ]

    failed_to_fire = []
    for label, samples, expected in cases:
        failures, _ = check_clip(entry, samples, EXPECTED_CHANNELS, rate)
        if not any(expected in failure for failure in failures):
            failed_to_fire.append('%s did not trip on %r' % (label, expected))
        else:
            print('SELFTEST %-14s tripped' % label)

    clean, _ = check_clip(entry, good, EXPECTED_CHANNELS, rate)
    if clean:
        failed_to_fire.append('a clean clip was rejected: ' + '; '.join(clean))
    else:
        print('SELFTEST clean          passed')

    stereo, _ = check_clip(entry, good, 2, rate)
    if not any('mono' in failure for failure in stereo):
        failed_to_fire.append('stereo did not trip')
    else:
        print('SELFTEST stereo         tripped')

    music_bad = {'music': [{'id': 'x', 'file': 'audio/x.mp3', 'title': 'X'}]}
    if len(check_music(music_bad)) < 2:
        failed_to_fire.append('an unlicensed track did not trip')
    else:
        print('SELFTEST unlicensed     tripped')

    if failed_to_fire:
        for message in failed_to_fire:
            print('FAIL selftest: ' + message)
        return 1
    print('PASS self-test: every gate fires')
    return 0


if __name__ == '__main__':
    if '--self-test' in sys.argv:
        raise SystemExit(self_test())
    raise SystemExit(run())
