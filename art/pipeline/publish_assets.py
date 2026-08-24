"""Copy built venue GLBs into the web app.

Without this the pipeline builds into art/out, which is gitignored, and the web
app keeps serving whatever was committed months earlier. The Rooftop skyline was
invisible in the browser for exactly this reason: art/out held a 535K build while
apps/web/public/assets held a 206K one from before the skyline existed.
"""

import os
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, '..', 'out')
WEB_DIR = os.path.join(HERE, '..', '..', 'apps', 'web', 'public', 'assets')

VENUES = ('rooftop', 'basement', 'suite')


def main():
    os.makedirs(WEB_DIR, exist_ok=True)
    published = []
    for venue in VENUES:
        name = venue + '_assets.glb'
        source = os.path.join(OUT_DIR, name)
        if not os.path.exists(source):
            raise SystemExit('missing build output: ' + source)
        target = os.path.join(WEB_DIR, name)
        shutil.copyfile(source, target)
        published.append('%s %.0fKB' % (name, os.path.getsize(target) / 1024.0))

    lighting = os.path.join(OUT_DIR, 'lighting.json')
    if os.path.exists(lighting):
        # Normalise on the way in. Biome lints this file once it lands in the web
        # app, and a CRLF copy fails the shared lint gate for every lane.
        with open(lighting, 'rb') as handle:
            body = handle.read()
        body = body.replace(b'\r\n', b'\n')
        with open(os.path.join(WEB_DIR, 'lighting.json'), 'wb') as handle:
            handle.write(body)
        published.append('lighting.json')

    for line in published:
        print('PUBLISHED ' + line)


main()
