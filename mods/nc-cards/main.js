// nc-cards: a bar with one button per side column and one per card. A click shows or hides
// that layout node through Herdr's layout commands; Herdr remembers it across restarts.
import { View, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { layout, run, theme, props } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class Cards extends View {
  render() {
    const t = theme(), root = layout();
    const shown = (id) => { const n = find(root, id); return Boolean(n) && !n.hidden; };
    const button = (id, label, tip, on, faint, act) => h_flex().id(`nc-cards-${id}`).h(22).px(8).flex_none().items_center()
      .rounded(5).text_size(11.5).cursor_pointer().bg(on ? t.selected : t.chrome).text_color(on && !faint ? t.foreground : t.dim)
      .hover((s) => s.bg(t.hover)).tooltip(tip).on_click(act).child(label);
    const group = (col) => {
      const open = shown(col.id);
      const cards = (col.cards ?? []).filter(([id]) => find(root, id)).map(([id, label]) => {
        const on = shown(id);
        // A card in a hidden column: show the column, and the card with it.
        return button(id, label, `${on && open ? "Hide" : "Show"} ${label}`, on, !open,
          () => open ? run("layout.toggle", { id }) : (run("layout.show", { id }), run("layout.show", { id: col.id })));
      });
      const icon = svg(`mods/workspace-chrome/panel-${col.side}.svg`).size(14);
      const column = button(col.id, icon, `${open ? "Hide" : "Show"} the ${col.side} column`, open, false, () => run("layout.toggle", { id: col.id }));
      return h_flex().gap(3).items_center().children(col.side === "right" ? [...cards, column] : [column, ...cards]);
    };
    return h_flex().size_full().px(10).gap(3).items_center().justify_between().bg(t.chrome).border_t(1).border_color(t.border)
      .children((props()?.columns ?? []).map(group));
  }
}
