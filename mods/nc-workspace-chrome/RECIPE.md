# nc-workspace-chrome

Herdr's shipped `workspace-chrome` bar (0.1.16) at the top of the sidebar, without the
Herdr logo and name, and without the room for the macOS window buttons once the layout
moves them out of the window. No preview.png.

## What you see

- The 46px row above the sidebar cards in `chrome`: empty on the left (on macOS 76px are
  kept for the window buttons only while the layout's `traffic_lights` x is 0 or more), then on the right the search button and the sidebar toggle,
  26px each with `muted` icons that turn `foreground` on hover.
- On the narrow rail it looks like the shipped one (only the toggle, none on macOS).

## How it behaves

- Search: `mod.open {name: "picker"}`. Sidebar toggle: `layout.resize` of `sidebar` to the
  rail (44px, 76px on macOS) and back to the width in shared `sidebar.width`.
- The block has `window_drag`, so the empty part moves the window; the buttons stop the
  press so they don't.
- With `{ "footer": true }` it draws the shipped footer (Settings, Add machine). The nc
  layout keeps Herdr's own `workspace-chrome` for the footer and uses this copy only for
  the bar.

## Built from

- Clone of Herdr's shipped `workspace-chrome` mod 0.1.16 (Apache-2.0; `scripts/fetch-upstream 0.1.16`
  puts it in `local/upstream/herdr-app-0.1.16/mods/workspace-chrome`), `mod.json`
  `{ "place": "none", "title": "Brand bar", "cloned_from": { "name": "workspace-chrome", "version": "0.1.16" } }`.
- Layout: the `brand` block in `layouts/nc.json`.
- Reads: `theme()`, `props()`, `window()`, `layout()`, `shared("sidebar.width")`, `updates()`.
  Writes `setShared("sidebar.width")`, `setShared("sidebar.collapsed")`.
- Runs nothing outside Herdr; calls `mod.open`, `layout.resize`, `app.settings`.
- Art: the shipped `mods/workspace-chrome/*.svg` icons (search, sidebar, settings, plus).

## Watch out

- Diff against upstream, nothing else besides the licence header in line 1 (marked `// nc:`):
  1. The logo-and-name child of the bar is replaced by an empty `flex_1` div, and `image`
     leaves the import.
  2. The macOS `pl(76)` also needs `layout().traffic_lights[0] >= 0`.
- `layouts/nc.json` sets `"traffic_lights": [-200, -200]` to push the macOS window buttons
  out of the window. Herdr documents that they always stay on macOS; the negative position
  is not documented. Without them: quit with cmd-q, minimize with cmd-m. If Herdr rejects
  or clamps it, set it back to `[12, 16]`.
- A clone gets no Herdr fixes. Merge new versions with `git merge-file` (see README).

## Done when

- `herdr-app check mods/nc-workspace-chrome` prints "check passed".
- In the app the top left of the sidebar shows no logo and no "Herdr"; search and the
  sidebar toggle still work, and dragging the empty part moves the window.
