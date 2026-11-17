# nc-cards

A thin bar above the status line with one button per side column and one per card. A click
shows or hides that part of the layout. Herdr keeps the choice in its layout clicks, so it
survives restarts. No preview.png: a live screenshot would show your own folders and prompts.

## What you see

- 30px bar, `chrome` background, 1px `border` line on top, `px 10`.
- Left group: a `panel-left` icon for the left column, then one button per left card. Right
  group, pushed to the right edge: one button per right card, then a `panel-right` icon.
- Button: 22px high, `px 8`, 5px radius, 11.5px text. Shown: `selected` background,
  `foreground` text. Hidden: `chrome` background, `dim` text. A shown card in a hidden column
  keeps the `selected` background but gets `dim` text. Hover: `hover` background. The tooltip
  says what a click does ("Hide Usage", "Show the right column").

## How it behaves

- Column button: `layout.toggle {id}` on the column.
- Card button, column shown: `layout.toggle {id}` on the card.
- Card button, column hidden: `layout.show` on the card, then on the column. A click on a dim
  button always brings that card into view.
- The ✕ in each card's header (in the card mods, not here) runs `layout.hide` on its own block.
- Redraws when the layout changes; no timers, no polling.
- A card id the layout does not have is left out of the bar.

## Built from

- Own code. Files: `mod.json` `{ "place": "none", "title": "Cards" }`, `main.js`.
- Layout: block `cards` in the `work` column, between `work-body` and `status`, `px 30`:
  `{ "mod": "nc-cards", "props": { "columns": [ { "id": "sidebar", "side": "left", "cards":
  [["spaces", "Spaces"], …] }, { "id": "rail", "side": "right", "cards": [["rail-orchestrator",
  "Orchestrator"], …] } ] } }`. `side` picks the icon and the order. Each card is `[block id, label]`.
- The card mods get `"props": { "card": "<their block id>" }` for their ✕.
- Reads: `layout()` (the `hidden` flags), `theme()`, `props()`.
- Runs the Herdr commands `layout.toggle` and `layout.show`. Nothing else: no exec, no files, no network.
- Icons: Herdr's own `mods/workspace-chrome/panel-left.svg` and `panel-right.svg`.

## Watch out

- If every card in a column is hidden, the column stays as an empty strip. Hide the column itself.
- `ctrl-shift-b` (Herdr's sidebar toggle) and this bar change the same `hidden` flag, so they agree.
- Hidden mods keep running their timers (Herdr does not pause hidden blocks).
- A width narrower than all the buttons squeezes the gap between the groups first. The buttons
  do not wrap.

## Done when

- `herdr-app check mods/nc-cards` says "check passed".
- `herdr-app do layout.hide '{"id":"rail-used"}'`: the Used card disappears and its button goes
  dim; `layout.show` brings both back.
- Hide `rail`: the terminal grows to the right edge, the right card buttons turn dim, the bar stays.
