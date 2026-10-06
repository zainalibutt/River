"""Save a .blend that is going into the public repository.

Blender writes more than the scene into a file, and three things in it name the machine it
was saved on without being needed by anything:

- the file browser beside the Shading workspace keeps the folder it last showed, which on
  Windows is the user's Documents folder, and it is saved with the window layout even when a
  script opens the file without its UI;
- a packed image keeps the path it was packed from, which only matters if it is unpacked;
- saving with relative paths remapped rewrites them against the new folder, and across two
  drives that makes them absolute.

So the file browser's folder is cleared - its whole buffer first, since the old path would
otherwise survive past the new string's end - packed images are labelled with their name
alone, and the file is saved without remapping.
"""
import bpy


def save_public(filepath, compress=True):
    for screen in bpy.data.screens:
        for area in screen.areas:
            for space in area.spaces:
                if space.type == 'FILE_BROWSER' and space.params is not None:
                    space.params.directory = b'/' * 4096
                    space.params.directory = b''
                    space.params.filename = ''
    for image in bpy.data.images:
        if image.packed_file is None:
            continue
        name = (image.filepath_raw or image.name).replace('\\', '/').rstrip('/').split('/')[-1]
        image.filepath_raw = '//textures/' + name
        for packed in image.packed_files:
            packed.filepath = '//textures/' + name
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=filepath, compress=compress, relative_remap=False, check_existing=False)
