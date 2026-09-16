import hashlib
import json
from pathlib import Path

import bpy


HERE = Path(__file__).parent
ROOT = HERE.parents[3]
SOURCE = HERE / "a51-animation-master.blend"
OUT = ROOT / "art" / "out" / "proofs" / "native-silver" / "a51-animation-baseline"
RIG = "river_native_silver_body.rig"
CHAIR_ACTIONS = {
    "A21 chair back": "A49 A21 chair back retreat",
    "A21 chair pan": "A49 A21 chair pan retreat",
}
COLLECTIONS = {
    "bet": "A47 CHIP proof chips - hide for PEEK",
    "peek": "A47 PEEK proof cards - show for PEEK",
    "allin": "A49 ALLIN proof chips - hide for other clips",
}
REVIEWS = {
    "a51-idle-review.blend": ("IDLE_thinking_readable", 120, None),
    "a51-check-review.blend": ("CHECK_tap", 36, None),
    "a51-peek-review.blend": ("PEEK_card", 48, "peek"),
    "a51-bet-review.blend": ("CHIP_toss", 30, "bet"),
    "a51-allin-review.blend": ("ALLIN_standup", 90, "allin"),
}


def curves(action):
    return [
        curve
        for layer in action.layers
        for strip in layer.strips
        for bag in strip.channelbags
        for curve in bag.fcurves
    ]


def action_signature(action):
    payload = [
        (
            curve.data_path,
            curve.array_index,
            [
                (
                    list(key.co),
                    list(key.handle_left),
                    list(key.handle_right),
                    key.interpolation,
                    key.handle_left_type,
                    key.handle_right_type,
                )
                for key in curve.keyframe_points
            ],
        )
        for curve in curves(action)
    ]
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def signatures():
    return {action.name: action_signature(action) for action in bpy.data.actions}


def find_layer_collection(layer_collection, name):
    if layer_collection.collection.name == name:
        return layer_collection
    for child in layer_collection.children:
        found = find_layer_collection(child, name)
        if found is not None:
            return found
    return None


def set_collection_visibility(visible):
    root = bpy.context.view_layer.layer_collection
    for key, name in COLLECTIONS.items():
        layer_collection = find_layer_collection(root, name)
        assert layer_collection is not None, name
        layer_collection.exclude = key != visible


def assign_action(obj, action):
    obj.animation_data_create()
    obj.animation_data.action = action
    if action.slots:
        obj.animation_data.action_slot = action.slots[0]


def activate(action_name, end_frame, visible):
    scene = bpy.context.scene
    scene.frame_start = 0
    scene.frame_end = end_frame
    scene.frame_set(0)
    rig = bpy.data.objects[RIG]
    assign_action(rig, bpy.data.actions[action_name])
    set_collection_visibility(visible)
    for object_name, chair_action in CHAIR_ACTIONS.items():
        chair = bpy.data.objects[object_name]
        if action_name == "ALLIN_standup":
            assign_action(chair, bpy.data.actions[chair_action])
        elif chair.animation_data:
            chair.animation_data.action = None
    scene.frame_set(0)
    bpy.context.view_layer.update()


OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
baseline = signatures()
assert len(baseline) == 27

results = {}
for filename, (action_name, end_frame, visible) in REVIEWS.items():
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    assert signatures() == baseline
    for action in bpy.data.actions:
        action.use_fake_user = True
    activate(action_name, end_frame, visible)
    bpy.context.preferences.filepaths.save_version = 0
    output = OUT / filename
    bpy.ops.wm.save_as_mainfile(filepath=str(output), check_existing=False)
    results[filename] = {"action": action_name, "range": [0, end_frame], "proof": visible}

for filename, expected in results.items():
    bpy.ops.wm.open_mainfile(filepath=str(OUT / filename))
    rig = bpy.data.objects[RIG]
    assert rig.animation_data.action.name == expected["action"]
    assert [bpy.context.scene.frame_start, bpy.context.scene.frame_end] == expected["range"]
    assert signatures() == baseline
    assert all(action.use_fake_user for action in bpy.data.actions)

print("A51_REVIEWS_COMPLETE=" + json.dumps(results, sort_keys=True))
