# A56 Gold baseline

Gold's accepted seated pose and her first clip, preserved as the source for everything
that follows: the look pass, the rest of the clip set and the integration build.

The seated pose is Zain's: A55 built a seated anchor against the Rooftop's own table and
chair, and Zain amended it by hand in Blender on 18 September 2026 until it held. A56
consolidated that pose into a fully keyed master - every one of the 137 bones keyed on
every frame - with two clips:

- `IDLE_thinking_readable`, frames 0-120: the accepted pose, held. It does not move yet;
  a breathing, shifting idle is still to be authored.
- `CHECK_tap`, frames 0-36: provisional. Zain turned the left upper arm by 7.8 degrees to
  keep it clear of the body, and accepted it for now, but it reads as a dismissive wave
  rather than a poker check and is not the standard later clips are held to.

`a56-gold-master.blend` is that file exactly, with two changes. Its six textures, which
it named by paths relative to where it was saved and which live in the local MakeHuman
asset install, are packed into it; all of them are MakeHuman assets released CC0. And the
absolute path its last review render was written to is cleared, because this repository
is public and its hygiene gate cannot read a .blend. `build_baseline.py` makes the master
from the file as Zain saved it and refuses to write it unless every action, the rest rig
and every mesh, weight, UV and shape key compare identical from a fresh open of both, and
no string in it names a local path.
