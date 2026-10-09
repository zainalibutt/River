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


def chip_bet(rand):
    """A call or a bet set down: a short stack cut onto the felt.

    One chip_place was all a bet ever made, and a single click under a whole
    street of chips going in read as nothing happening. Four chips clack in
    fast, the stack settles with a low thud, and the top chips rattle once on it
    - heavier than a click, lighter than a shove.
    """
    out = silence(0.34)
    for index in range(4):
        offset = 0.018 * index + rand() * 0.008
        clack = envelope(highpass(noise(0.018, rand), 2600), 0.0004, 0.005)
        tone = envelope(ping(0.05, 1900 + rand() * 500, 90.0), 0.0005, 0.012)
        body = envelope(ping(0.07, 300 + rand() * 80, 55.0), 0.001, 0.02)
        chip = mix(clack, [value * 0.35 for value in tone], [value * 0.8 for value in body])
        out = at(out, [value * (0.6 + rand() * 0.4) for value in chip], offset)
    thud = envelope(lowpass(ping(0.12, 140, 30.0), 900), 0.002, 0.035)
    out = at(out, [value * 0.7 for value in thud], 0.07)
    for index in range(2):
        rattle = envelope(highpass(noise(0.012, rand), 3000), 0.0004, 0.004)
        out = at(out, [value * 0.35 for value in rattle], 0.13 + 0.03 * index + rand() * 0.01)
    return normalise(out, 0.78)


def check_tap(rand):
    """A check: two knuckle taps on the rail. Wood rather than felt, so a dull
    knock with a short body, and the second lighter than the first."""

    def knock(weight):
        thump = envelope(ping(0.07, 190 + rand() * 20, 70.0), 0.0008, 0.018)
        wood = envelope(ping(0.04, 620 + rand() * 60, 120.0), 0.0005, 0.008)
        edge = envelope(lowpass(highpass(noise(0.015, rand), 700), 3200), 0.0004, 0.004)
        return [value * weight for value in mix(thump, [v * 0.45 for v in wood], [v * 0.5 for v in edge])]

    out = silence(0.26)
    out = at(out, knock(1.0), 0.0)
    out = at(out, knock(0.75), 0.105 + rand() * 0.01)
    return normalise(out, 0.7)


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


def ui_hover(rand):
    """Passing over a control. A tenth of a click: a sweep across the three
    buttons of the action menu should read as a flurry, not as three clicks."""
    return normalise(envelope(ping(0.03, 1500, 150.0), 0.0005, 0.008), 0.3)


def wheel_tick(rand):
    """One notch of the raise wheel. A detent rather than a click: drier and
    lower than a button, so holding the wheel over is a run of small knocks."""
    body = envelope(ping(0.022, 520, 200.0), 0.0004, 0.005)
    edge = envelope(lowpass(noise(0.012, rand), 3600), 0.0004, 0.004)
    return normalise(mix(body, [value * 0.5 for value in edge] + silence(0.01)), 0.32)


def card_peek(rand):
    """Your own cards lifted at the corner and put back. Softer and shorter than
    a card crossing the felt, because it never leaves the hand."""
    lift = envelope(highpass(lowpass(noise(0.09, rand), 5200), 900), 0.004, 0.05)
    return normalise(lift, 0.3)


def turn_alert(rand):
    """Your turn. Two soft notes, deliberately not a buzzer."""
    first = envelope(ping(0.22, 587.33, 12.0), 0.006, 0.06)
    second = envelope(ping(0.26, 880.0, 11.0), 0.006, 0.075)
    return normalise(at(mix(first), second, 0.11), 0.5)



def showdown_hush(rand):
    """The breath before the hand that decides it. A low swell with air in it, felt
    more than heard, and gone before the cards turn."""
    body = envelope(ping(0.95, 98.0, 1.2), 0.32, 0.22)
    upper = envelope(ping(0.95, 147.0, 1.6), 0.36, 0.2)
    air = envelope(lowpass(noise(0.95, rand), 900), 0.4, 0.2)
    return normalise(mix(body, [value * 0.5 for value in upper], [value * 0.25 for value in air]), 0.32)


def win_chime(rand):
    """The pot going to its winner. Three warm notes rising, close together, under the
    chips: a confirmation, not a jackpot."""
    out = silence(0.95)
    for index, frequency in enumerate((523.25, 659.25, 783.99)):
        note = envelope(ping(0.8, frequency, 4.5), 0.004, 0.32)
        overtone = envelope(ping(0.5, frequency * 2.0, 9.0), 0.003, 0.12)
        out = at(out, mix(note, [value * 0.25 for value in overtone] + silence(0.3)), 0.06 * index)
    return normalise(out, 0.42)

EFFECTS = {
    'chip_place': (chip_place, 'A single chip onto the felt'),
    'chip_push': (chip_push, 'A bet going in'),
    'chip_stack': (chip_stack, 'Idle riffling'),
    'chip_bet': (chip_bet, 'A call or a bet set down'),
    'check_tap': (check_tap, 'Two taps on the rail for a check'),
    'card_slide': (card_slide, 'One card across the felt'),
    'card_flip': (card_flip, 'A card turned face up'),
    'card_deal': (card_deal, 'Two cards dealt to a seat'),
    'pot_push': (pot_push, 'The pot pushed to a winner'),
    'ui_click': (ui_click, 'A control being pressed'),
    'ui_hover': (ui_hover, 'The pointer passing over a control'),
    'wheel_tick': (wheel_tick, 'One notch of the raise wheel'),
    'card_peek': (card_peek, 'A look at your own cards'),
    'turn_alert': (turn_alert, 'Your turn to act'),
    'showdown_hush': (showdown_hush, 'The breath before the deciding hand'),
    'win_chime': (win_chime, 'The pot going to its winner'),
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



# Each effect's noise comes from a seed of its own. Seeds used to follow the effect's
# place in the sorted list, so adding an effect quietly re-rolled every effect after it.
# The first fourteen keep the seeds they were published with; later ones are seeded by name.
_PUBLISHED_ORDER = [
    'card_deal', 'card_flip', 'card_peek', 'card_slide', 'check_tap', 'chip_bet', 'chip_place',
    'chip_push', 'chip_stack', 'pot_push', 'turn_alert', 'ui_click', 'ui_hover', 'wheel_tick',
]


def seed_for(name):
    if name in _PUBLISHED_ORDER:
        return 0x51E7 + _PUBLISHED_ORDER.index(name) * 7919
    return 0x51E7 + sum(ord(character) * (index + 1) for index, character in enumerate(name)) * 104729

def build():
    manifest = {'rate': RATE, 'effects': [], 'music': MUSIC, 'voice': []}
    for name, (make, description) in sorted(EFFECTS.items()):
        rand = _lcg(seed_for(name))
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
