# The build board

`index.html` in this directory is the **source of the published build board**.

**Live:** https://claude.ai/code/artifact/e4975483-97be-4646-9094-5fa1018aae45

It is private to Zain's account until shared. It shows where River actually
stands — the three lanes and what each has shipped, the work as a tree, narrow
and broad scope scored separately, what is next in order, and the open defects.

## Why it lives here

It was previously only an artifact, which meant it could not be found from the
project folder and could not be diffed. It is now versioned beside the code it
describes, and the published page is a deploy of this file rather than the only
copy of it.

## Updating it

Edit `index.html`, then redeploy **to the same URL**:

- Publish with `file_path: docs/board/index.html` and `url:` set to the live URL
  above. Passing the URL updates in place; omitting it creates a second board.
- Keep the `<title>` and the favicon stable. Readers find the tab by its icon.

The file is published as page content — it carries no `<!doctype>`, `<html>`,
`<head>` or `<body>` tags of its own, because those are added at publish time.
Do not add them.

## What to update, and when

Update it in the same session as the work, not in a sweep afterwards:

- **The three lane lists** — one entry per accepted packet, newest first, saying
  what was actually wrong rather than what was built.
- **The header line and the footer meta** — HEAD, test count, gate state.
- **"What is next, in order"** — this is the section that goes stale fastest and
  the one most worth trusting.
- **The flag section** — open defects. Per `docs/handoff/record-conventions.md`
  §5, defects are recorded beside the wins, with enough specificity to act on.

Scores are judgement, not output from a script. Move them when the judgement
changes and be able to say why.
