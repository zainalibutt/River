# River menu direction board

This folder is a design-adjacency board for River's menu layer. It is not a proposal to replace the game's table, camera, or venue work. The direction keeps the strongest structure in `../menus/` and changes the presentation from distressed casino collage to a composed, high-society espionage casino.

The shorthand is: private club, after dark, under quiet pressure.

The images are direction references, not production-ready screens. Their characters, venue detail, spacing, and invented controls are illustrative. Implementation should take the composition, hierarchy, materials, contrast, and pacing rather than copy every pictured object.

## Direction in one page

- Keep the venue visible. River's table, character, and room are the stage; menus are a layer over that stage.
- Give each screen one dominant decision. Secondary information should be quieter and physically separated.
- Replace torn paper, splatter, loud yellow, and oversized icon rings with smoked glass, thin brass rules, warm ivory type, and controlled negative space.
- Use midnight green-black and charcoal for the foundation. Brass marks selection, not decoration. Oxblood is reserved for danger or destructive actions.
- Let the interface feel tailored rather than expensive for its own sake. Dark walnut, leather, fine paper grain, and glass are useful; roulette and giant-chip imagery are not.
- Borrow the tension, precision, and confidence of classic espionage cinema without using franchise branding, character likenesses, weapons, or literal title treatments.

## Generated direction references

| Image | Existing structure retained | New adjacency | Why this pick matters |
| --- | --- | --- | --- |
| [01-main-menu.png](./01-main-menu.png) | `main_menu.png` and `main .png`: a compact vertical menu sharing the frame with a character and venue | A discreet private-club entrance, editorial serif display type, one brass focus line, event and bankroll capsules treated as quiet dossiers | This is the front door. It proves the atmosphere can change substantially without inventing a new information architecture. |
| [02-private-table.png](./02-private-table.png) | `game_selector.png` and the turned-rooftop references: settings beside a contextual table view | A narrow invitation/configuration folio over a live room, with one explicit create action | This is where the new tone has to remain usable. It shows that setup can feel ceremonial while still being quick to scan. |
| [03-wardrobe.png](./03-wardrobe.png) | `outfit_shop.png` and `customise_character.png`: catalogue grid, full-character preview, item detail | A tailor's dossier in an adjoining dressing room rather than a conventional storefront | Cosmetics are part of identity, so the character remains larger and more important than the inventory chrome. |
| [04-hand-complete.png](./04-hand-complete.png) | `winner_screen.png`: a hand result treated as an event while the table remains present | A held cinematic beat with restrained typography and no celebratory visual explosion | This is the clearest bridge to future music. The visual provides a pause where a sting, release, and next-hand cue can later live. |

## What every existing reference contributes

| Existing reference | Keep | Reinterpret |
| --- | --- | --- |
| `basic_rooftop.png` | The table and venue as the persistent visual anchor | Reduce empty brightness and let interface contrast come from local panels, not a full-screen wash. |
| `betting_ui_raise.png` | Immediate access to the current wager and action | Keep the action close to the player; use calm radial geometry and a thin urgency signal rather than a loud arcade treatment. |
| `check_raise_fold.png` | Three poker decisions read at a glance | Preserve semantic separation; reserve oxblood for fold or genuinely risky confirmation, not general decoration. |
| `corner_loading_icon.png` | Status that does not interrupt play | Turn it into a small, precise activity mark with enough contrast for couch distance. No theatrical loading screen. |
| `customise_character.png` | Full-body character comparison | Treat the space as a fitting room and keep categories subordinate to the person. |
| `game_selector.png` | Venue context beside table rules | Keep the concise selector, remove distressed framing, and end on one obvious primary action. |
| `looking_at_cards.png` | Physicality and private card-peek tension | Keep it in-world and private. This moment should be supported by restrained sound later, not extra interface. |
| `main .png` | Menu and world occupying one composition | Use it as evidence that River does not need a separate abstract dashboard. |
| `main_menu.png` | The strongest top-level information architecture in the set | Replace texture noise with spacing, type scale, and a single selection rule. |
| `outfit_shop.png` | Browse, preview, inspect | Lower tile density and make the selected garment plus the player the focal pair. |
| `pressing_tab.png` | A temporary layer over a game that continues underneath | Make secondary overlays feel like a quick folio: fast in, fast out, never a new room. |
| `rooftop_turned_1.png` | The venue can provide alternate compositions | Use shallow parallax and restrained camera drift for menu depth; do not disconnect menu cameras from the measured venue. |
| `rooftop_turned_2.png` | The room has enough visual identity to carry setup screens | Frame known architecture and table lighting instead of adding unrelated decorative scenery. |
| `table_item_shop.png` | Slot/category browsing for table expression | Use fewer, larger objects and show the chosen object in the room whenever practical. |
| `winner_screen.png` | The result deserves a distinct beat | Remove cut-out collage energy; keep the live table, a strong hand label, the result, and one way forward. |
| The 75-second gameplay capture (untracked) | Timing evidence: menus are a sequence, not a set of isolated posters | Build transitions as musical phrases even before audio exists: enter, settle, confirm, release. |

## Visual grammar for implementation

### Layout

- Main navigation should occupy roughly 20 to 25 percent of a 16:9 frame. The venue owns the rest.
- Use one large display title, one active selection, and a maximum of two compact status capsules on the primary screen.
- Keep information near the thing it controls. Table setup lives beside the table; wardrobe details live beside the character.
- Check every screen at 1920x1080 and from couch distance. Fine decoration may disappear; hierarchy must not.

### Colour and material

- Foundation: near-black green and charcoal.
- Primary text: warm ivory rather than pure white.
- Focus and progress: restrained brushed brass.
- Danger: a small oxblood accent.
- Surface treatment: translucent smoked glass, soft vignette, subtle grain, hairline rules. Grain should be felt before it is seen.
- Avoid making every panel translucent. One material hierarchy is more convincing than many competing glass cards.

### Type and iconography

- Use a high-contrast serif for large scene titles and a clean sans serif for navigation, values, and status.
- Use tracking and whitespace to create ceremony; do not compensate with excessive size.
- Prefer abstract suit geometry, invitation marks, and monograms. Do not use spy props, weapons, or parody iconography.

### Motion

- Focus change: approximately 180 to 250 ms, with a clean glide rather than a bounce.
- Screen transition: approximately 500 to 700 ms, preserving the venue while panels exchange.
- Environmental motion: slow and low-amplitude, such as city bokeh, curtains, smoke, reflections, or restrained camera parallax.
- Result beat: reveal, hold, then offer the next action. Do not animate every value at once.

## Audio is deferred, not forgotten

Music is part of the intended identity even though it is outside the current implementation scope. The menu system should reserve timing for it now: a low pulse on entry, brushed percussion or a restrained metallic tick on focus movement, a short harmonic confirmation on selection, silence before an important reveal, and a concise sting at hand completion.

No audio needs to be built with this board. The implementation implication is to centralise transition states and avoid instantaneous screen swaps, so a later score and UI sound layer can attach to known beats without redesigning the menus.

## How to gather better inspiration for River

Do not collect a general mood board. Collect evidence for one design question at a time.

1. Create three boards: **structure**, **material**, and **rhythm**. Structure answers where information lives. Material answers how the layer feels. Rhythm covers motion and, later, music.
2. Search by component plus emotion, not by a game or film title. Useful searches include `private club game menu`, `luxury hotel concierge interface`, `espionage dossier typography`, `mid-century title sequence spacing`, `casino lounge lighting`, and `tailor lookbook interface`.
3. Keep five strong references per component: main menu, private table, invite/waiting, wardrobe, collection, pause/quick overlay, and hand result. More than five usually hides the decision.
4. Tag every capture with one sentence beginning `Use this for...`. If that sentence cannot be written, the image is atmosphere rather than actionable inspiration.
5. Translate each useful capture into a measurable rule: panel width, number of actions, type hierarchy, colour role, transition duration, or retained venue area.
6. Put the candidate beside a current River screenshot and run a five-second test: what is the screen, what can I do, and what is selected? If any answer is unclear, the mood is costing usability.
7. Maintain an explicit rejection board. For this direction it should include distressed collage, torn edges, visual noise, indiscriminate gold, neon casino clichés, and interfaces that hide the room.

## Prompt set used for this board

All four images were generated as original 16:9 desktop game UI mockups using the local River references only for layout and continuity.

1. **Main menu:** compact vertical navigation sharing the frame with an original player character and a nocturnal rooftop; private-club dossier styling; midnight green, ivory, brass, and minimal oxblood.
2. **Private table:** the live table remains the hero while a narrow invitation and settings folio holds buy-in, seats, timer, and one create action.
3. **Wardrobe:** six-card catalogue plus full-height character preview in a discreet tailor's room; interface subordinate to identity and clothing.
4. **Hand complete:** the live table remains visible beneath a restrained result band; winning hand, amount, history, and continue action staged as the held beat after a musical sting.

Every prompt explicitly excluded franchise marks, copied characters, distressed collage, torn paper, loud yellow, neon overload, casino clichés, weapons, and watermarks.
