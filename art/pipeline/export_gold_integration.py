"""Export an A71-derived Gold seat candidate with the Silver clip contract.

The shared exporter supplies the proven seated-mesh conversion and structural
verification. Gold-specific names, mesh count and clip timing are set here.
"""

import importlib.util
from pathlib import Path


spec = importlib.util.spec_from_file_location(
    'export_silver_integration', Path(__file__).with_name('export_silver_integration.py'))
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


exporter.RIG = 'river_native_gold_body.rig'
exporter.EXPORT_RIG = 'river_native_gold_rig'
exporter.BODY_SOURCE = 'river_native_gold_body'
exporter.BODY_DATA = 'char_native_gold_body'
exporter.EXPORT_PREFIX = 'gold'
exporter.RELOAD_EXPORT_SCENE = True
exporter.MESH_COUNT = 7
exporter.MASKED_PARTS = ('hair', 'eyebrow', 'eyelash', 'eyes')
# Her dress's seat corrective is right seated and wrong standing, so it ships as a morph that
# every clip drives from her pelvis rather than baked in at half strength.
exporter.POSE_SHAPES = {'river_native_gold_dress': 'A55 seat underside contact'}
exporter.SHIPPING = {
    'IDLE_thinking_readable': 120,
    'CHECK_tap': 36,
    'PEEK_card': 48,
    'CHIP_toss': 30,
    'ALLIN_standup': 90,
    'SIT_enter': 108,
    'LEAVE_getup': 132,
    'FOLD_muck': 35,
}


if __name__ == '__main__':
    exporter.main()
