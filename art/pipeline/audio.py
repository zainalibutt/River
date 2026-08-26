"""Generate River's sound effects, and write the audio manifest.

Every effect is synthesised here rather than sourced. Tracking licences for a
hundred short files to save an afternoon is a bad trade, and a generated effect
rebuilds from the repository the same way a venue does.

Music is the exception and is licensed rather than generated. The manifest
carries a licence and an attribution per track so an original composition can
replace a public-domain recording without touching any code.

Pure standard library on purpose: adding numpy or ffmpeg would make the sound
pipeline the only part of this project that cannot rebuild on a clean checkout.
"""

import json
import math
import os
import struct
import wave

RATE = 22050
OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'out', 'audio')

# Short mono one-shots at 22 kHz. A chip click carries nothing above 10 kHz, so
# a higher rate would only make the download bigger.
CHANNELS = 1
SAMPLE_WIDTH = 2


def _lcg(seed):
    """The same deterministic generator geo.py uses, so runs are repeatable."""
    state = seed & 0xFFFFFFFF

    def rand():
        nonlocal state
        state = (1103515245 * state + 12345) & 0x7FFFFFFF
        return state / 0x7FFFFFFF

    return rand


def silence(seconds):
    return [0.0] * int(seconds * RATE)


def noise(seconds, rand):
    return [rand() * 2.0 - 1.0 for _ in range(int(seconds * RATE))]


def ping(seconds, frequency, decay):
    """A decaying sine. This is the body of anything that sounds like an object."""
    count = int(seconds * RATE)
    return [
        math.sin(2.0 * math.pi * frequency * (i / RATE)) * math.exp(-decay * (i / RATE))
        for i in range(count)
    ]


def envelope(samples, attack, decay):
    """Attack and exponential decay, in seconds. Nothing here needs sustain."""
    count = len(samples)
    attack_samples = max(1, int(attack * RATE))
    out = []
    for i, value in enumerate(samples):
        if i < attack_samples:
            gain = i / attack_samples
        else:
            gain = math.exp(-(i - attack_samples) / max(1.0, decay * RATE))
        out.append(value * gain)
    return out


def lowpass(samples, cutoff):
    """One pole. Enough to take the fizz off noise and make it read as a surface."""
    alpha = 1.0 - math.exp(-2.0 * math.pi * cutoff / RATE)
    out = []
    previous = 0.0
    for value in samples:
        previous += alpha * (value - previous)
        out.append(previous)
    return out


def highpass(samples, cutoff):
    low = lowpass(samples, cutoff)
    return [value - filtered for value, filtered in zip(samples, low)]


def mix(*layers):
    length = max(len(layer) for layer in layers)
    out = [0.0] * length
    for layer in layers:
        for i, value in enumerate(layer):
            out[i] += value
    return out


def at(base, layer, offset_seconds):
    """Place a layer into a base buffer at an offset, extending if it overruns."""
    start = int(offset_seconds * RATE)
    needed = start + len(layer)
    if needed > len(base):
        base = base + [0.0] * (needed - len(base))
    for i, value in enumerate(layer):
        base[start + i] += value
    return base


def fade_edges(samples, seconds=0.002):
    """
    Bring the first and last samples to zero.

    A buffer that begins partway up a waveform clicks on every single playback,
    and at two milliseconds the fade is inaudible on anything here. The checker
    caught three effects doing this; the fix belongs in the generator rather
    than in a looser gate.
    """
    count = min(int(seconds * RATE), len(samples) // 2)
    if count < 1:
        return samples
    out = list(samples)
    for i in range(count):
        gain = i / count
        out[i] *= gain
        out[-1 - i] *= gain
    return out


def normalise(samples, peak=0.7):
    """
    Leave headroom rather than filling the scale.

    Several of these fire at once - a chip push is six clicks - and a file
    normalised to 1.0 clips the moment it is layered with anything.
    """
    loudest = max((abs(value) for value in samples), default=0.0)
    if loudest <= 1e-9:
        return samples
    gain = peak / loudest
    return [value * gain for value in samples]


def write_wav(name, samples):
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, name + '.wav')
    frames = bytearray()
    for value in samples:
        clamped = max(-1.0, min(1.0, value))
        frames += struct.pack('<h', int(clamped * 32767))
    with wave.open(path, 'wb') as handle:
        handle.setnchannels(CHANNELS)
        handle.setsampwidth(SAMPLE_WIDTH)
        handle.setframerate(RATE)
        handle.writeframes(bytes(frames))
    return path


# --- the effects themselves ------------------------------------------------


def chip_place(rand):
    """One clay chip onto felt: a click, a short body, no ring."""
    click = envelope(highpass(noise(0.02, rand), 2200), 0.0005, 0.006)
    body = envelope(ping(0.06, 320 + rand() * 90, 60.0), 0.001, 0.02)
    return normalise(mix(click, body), 0.62)


def chip_push(rand):
    """A stack going in. Six chips, jittered, or it reads as one loud chip."""
    out = silence(0.5)
    for index in range(6):
        offset = 0.012 * index + rand() * 0.01
        out = at(out, [value * (0.55 + rand() * 0.45) for value in chip_place(rand)], offset)
    return normalise(out, 0.8)


def chip_stack(rand):
    """Riffling, faster and quieter than a push."""
    out = silence(0.42)
    for index in range(9):
        offset = 0.035 * index + rand() * 0.006
        out = at(out, [value * 0.4 for value in chip_place(rand)], offset)
    return normalise(out, 0.6)


def card_slide(rand):
    """Card across felt: filtered noise, no transient."""
    body = lowpass(noise(0.16, rand), 2600)
    return normalise(envelope(body, 0.02, 0.045), 0.42)


def card_flip(rand):
    """Turning one over: a snap, then the slide."""
    snap = envelope(highpass(noise(0.03, rand), 1500), 0.0008, 0.01)
    slide = [value * 0.5 for value in card_slide(rand)]
    return normalise(at(mix(snap), slide, 0.02), 0.62)


def card_deal(rand):
    """Two cards out, one after the other."""
    out = silence(0.34)
    out = at(out, card_slide(rand), 0.0)
    out = at(out, card_slide(rand), 0.13)
    return normalise(out, 0.6)


def pot_push(rand):
    """The pot coming to you. Longer, heavier, more chips."""
    out = silence(0.85)
    for index in range(14):
        offset = 0.045 * index + rand() * 0.02
        out = at(out, [value * (0.4 + rand() * 0.5) for value in chip_place(rand)], offset)
    return normalise(out, 0.88)


def ui_click(rand):
    """A button. Dry and short, so it never competes with the table."""
    return normalise(envelope(ping(0.04, 880, 90.0), 0.0006, 0.008), 0.34)


def turn_alert(rand):
    """Your turn. Two soft notes, deliberately not a buzzer."""
    first = envelope(ping(0.22, 587.33, 12.0), 0.006, 0.06)
    second = envelope(ping(0.26, 880.0, 11.0), 0.006, 0.075)
    return normalise(at(mix(first), second, 0.11), 0.5)


EFFECTS = {
    'chip_place': (chip_place, 'A single chip onto the felt'),
    'chip_push': (chip_push, 'A bet going in'),
    'chip_stack': (chip_stack, 'Idle riffling'),
    'card_slide': (card_slide, 'One card across the felt'),
    'card_flip': (card_flip, 'A card turned face up'),
    'card_deal': (card_deal, 'Two cards dealt to a seat'),
    'pot_push': (pot_push, 'The pot pushed to a winner'),
    'ui_click': (ui_click, 'A control being pressed'),
    'turn_alert': (turn_alert, 'Your turn to act'),
}

# The music slot. Empty on purpose - v1 fills it with public-domain
# performances, and an original composition replaces one without a code change.
MUSIC = [
    {
        'id': 'lobby_theme',
        'file': None,
        'title': None,
        'performer': None,
        'licence': None,
        'attribution': None,
        'loop': True,
        'bus': 'music',
    },
]


def build():
    manifest = {'rate': RATE, 'effects': [], 'music': MUSIC, 'voice': []}
    for index, (name, (make, description)) in enumerate(sorted(EFFECTS.items())):
        rand = _lcg(0x51E7 + index * 7919)
        samples = fade_edges(make(rand))
        path = write_wav(name, samples)
        manifest['effects'].append({
            'id': name,
            'file': 'audio/' + name + '.wav',
            'description': description,
            'seconds': round(len(samples) / RATE, 4),
            'bytes': os.path.getsize(path),
            'bus': 'effects',
        })
        print('AUDIO %s %.3fs %dKB' % (name, len(samples) / RATE, os.path.getsize(path) // 1024))

    os.makedirs(OUT_DIR, exist_ok=True)
    manifest_path = os.path.join(OUT_DIR, 'manifest.json')
    with open(manifest_path, 'w', encoding='utf-8', newline='\n') as handle:
        json.dump(manifest, handle, indent=2)
        handle.write('\n')
    total = sum(entry['bytes'] for entry in manifest['effects'])
    print('AUDIO_TOTAL %dKB across %d effects' % (total // 1024, len(manifest['effects'])))
    print('OUT ' + manifest_path)
    return manifest


if __name__ == '__main__':
    build()
