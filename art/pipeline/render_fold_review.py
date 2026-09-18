"""Contact sheets of the fold from four sides, for looking at it rather than trusting the gates.

The gates say the fold is the accepted push until it is authored, starts and ends on the
idle, and puts no fingertip lower than the push does. None of that says it reads as a fold.
This renders the clip at its key frames from the front, from his left three-quarter, from
his left side and from where the gameplay camera sits across the table, one sheet per
camera, with the proof cards riding the push and flying off at the release the way the
browser sends them.

Read-only on the candidate: nothing is saved.

Run:
  node art/pipeline/run_blender.mjs art/pipeline/render_fold_review.py -- \\
      --candidate <silver-integration-candidate.blend> --out <folder>
"""
import argparse
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fold_clip import FOLD_CLIP, FOLD_RELEASE_FRAME  # noqa: E402

RIG = 'river_native_silver_body.rig'
FRAMES = (0, 9, 14, 17, 22, 30)
CARDS = ('A44d proof card 0', 'A44d proof card 1')
PUSH_STACK = 'A47 proof stack 0'
TILE = (560, 420)
CAMERAS = {
    'front': ((0.12, -1.75, 1.18), (0.05, -0.36, 0.9)),
    'three-quarter-left': ((1.15, -1.3, 1.22), (0.08, -0.4, 0.88)),
    'side-left': ((1.35, -0.38, 1.02), (0.05, -0.38, 0.88)),
    'gameplay': ((0.0, -3.3, 1.55), (0.0, -0.5, 0.82)),
}


def arguments():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--candidate', required=True)
    parser.add_argument('--out', required=True)
    return parser.parse_args(argv)


def curves(action):
    return [c for layer in action.layers for strip in layer.strips for bag in strip.channelbags for c in bag.fcurves]


def location_at(action, frame):
    place = [0.0, 0.0, 0.0]
    for curve in curves(action):
        if curve.data_path == 'location':
            place[curve.array_index] = curve.evaluate(frame)
    return Vector(place)


def show_everything_needed():
    """The proof props live in collections the saved view layer excludes."""
    def walk(layer_collection):
        yield layer_collection
        for child in layer_collection.children:
            yield from walk(child)
    for layer_collection in walk(bpy.context.view_layer.layer_collection):
        names = {obj.name for obj in layer_collection.collection.all_objects}
        if names & (set(CARDS) | {'A21 chair back', 'A21 chair pan', 'A21 felt', 'A21 rail'}):
            layer_collection.exclude = False
            layer_collection.hide_viewport = False
            layer_collection.collection.hide_render = False
    for name in CARDS:
        bpy.data.objects[name].hide_render = False
        bpy.data.objects[name].hide_viewport = False
    # The proof chip stacks play their own push and shove, and a fold moves no chips: left in,
    # they read as a doubled stack sliding under the folding hand.
    for obj in bpy.data.objects:
        if obj.name.startswith(('A47 proof chip', 'A49 proof chip')):
            obj.hide_render = True


def main():
    args = arguments()
    bpy.ops.wm.open_mainfile(filepath=os.path.abspath(args.candidate))
    scene = bpy.context.scene
    rig = bpy.data.objects[RIG]
    fold = bpy.data.actions.get(FOLD_CLIP)
    if fold is None:
        raise SystemExit('FAIL: the candidate has no %s' % FOLD_CLIP)
    if rig.animation_data is None:
        rig.animation_data_create()
    rig.animation_data.action = fold
    if fold.slots:
        rig.animation_data.action_slot = fold.slots[0]
    show_everything_needed()

    # The cards ride the authored push, then fly on towards the middle and are gone - what
    # the browser does, so the sheet shows the fold the player will see.
    push = bpy.data.actions[PUSH_STACK]
    push_start = location_at(push, 0)
    cards = [bpy.data.objects[name] for name in CARDS]
    rests = []
    for card in cards:
        card.animation_data_clear()
        rests.append(card.location.copy())

    def place_cards(frame):
        carried = location_at(push, min(frame, FOLD_RELEASE_FRAME)) - push_start
        flying = max(0, frame - FOLD_RELEASE_FRAME)
        for card, rest in zip(cards, rests):
            card.location = rest + carried + Vector((0.0, -0.045 * flying, 0.0))
            card.hide_render = flying > 6

    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = TILE
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)

    camera_data = bpy.data.cameras.new('fold review')
    camera_data.lens = 40
    camera = bpy.data.objects.new('fold review', camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera

    written = []
    for label, (eye, target) in CAMERAS.items():
        camera.location = eye
        direction = Vector(target) - Vector(eye)
        camera.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
        tiles = []
        for frame in FRAMES:
            scene.frame_set(frame)
            place_cards(frame)
            bpy.context.view_layer.update()
            path = os.path.join(out, 'fold-%s-f%02d.png' % (label, frame))
            scene.render.filepath = path
            bpy.ops.render.render(write_still=True)
            tiles.append(path)
        sheet = os.path.join(out, 'fold-%s-sheet.png' % label)
        tile_sheet(tiles, sheet, columns=3)
        written.append(sheet)
        print('SHEET %s' % sheet)
    print('FOLD REVIEW %d sheets, frames %s' % (len(written), ', '.join(map(str, FRAMES))))


def tile_sheet(paths, target, columns):
    """Tile rendered frames into one sheet, labelled by frame, without a second library."""
    images = [bpy.data.images.load(path, check_existing=False) for path in paths]
    width, height = images[0].size
    rows = (len(images) + columns - 1) // columns
    sheet = bpy.data.images.new('sheet', width * columns, height * rows, alpha=False)
    pixels = [0.0] * (width * columns * height * rows * 4)
    for index, image in enumerate(images):
        source = list(image.pixels)
        column = index % columns
        # Blender images start at the bottom row; the first frame belongs top left.
        row = rows - 1 - index // columns
        for y in range(height):
            start = ((row * height + y) * width * columns + column * width) * 4
            pixels[start:start + width * 4] = source[y * width * 4:(y + 1) * width * 4]
    sheet.pixels = pixels
    sheet.filepath_raw = target
    sheet.file_format = 'PNG'
    sheet.save()
    for image in images:
        bpy.data.images.remove(image)


if __name__ == '__main__':
    main()
