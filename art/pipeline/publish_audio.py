"""Copy generated audio into the web app.

Separate from the builder for the same reason the venues are: the app serves
what is in public/, and a build that never gets published is a build nobody
hears. The venues drifted for two days that way.
"""

import json
import os
import shutil

SRC = os.path.join(os.path.dirname(__file__), '..', 'out', 'audio')
DEST = os.path.join(os.path.dirname(__file__), '..', '..', 'apps', 'web', 'public', 'audio')


def publish():
    manifest_path = os.path.join(SRC, 'manifest.json')
    if not os.path.exists(manifest_path):
        raise SystemExit('FAIL: build the audio first, no manifest at ' + manifest_path)
    os.makedirs(DEST, exist_ok=True)
    with open(manifest_path, encoding='utf-8') as handle:
        manifest = json.load(handle)

    total = 0
    for entry in manifest.get('effects', []):
        name = os.path.basename(entry['file'])
        source = os.path.join(SRC, name)
        shutil.copyfile(source, os.path.join(DEST, name))
        total += os.path.getsize(source)
        print('PUBLISHED %s %dKB' % (name, os.path.getsize(source) // 1024))

    # Line endings are normalised for the manifest only. Doing it to a wav
    # would corrupt every sample that happens to be 0x0D0A.
    with open(manifest_path, 'rb') as handle:
        body = handle.read().replace(b'\r\n', b'\n')
    with open(os.path.join(DEST, 'manifest.json'), 'wb') as handle:
        handle.write(body)
    print('PUBLISHED manifest.json')
    print('AUDIO_PUBLISHED %dKB' % (total // 1024))


if __name__ == '__main__':
    publish()
