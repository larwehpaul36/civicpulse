// The pages in the phone's ☰ menu: [address, key in strings.footer, icon]. Every address must be a real page (tests/menu.test.mjs).
// An icon is plain data: an optional circle [cx, cy, r] and a line path `d`. MenuButton draws it.
export const MENU_ITEMS = [
  ['/about', 'about', { circle: [12, 12, 9], d: 'M12 11v5M12 8h.01' }],
  ['/accessibility', 'accessibility', { circle: [12, 4.5, 1.8], d: 'M5 8.5l7 1.5 7-1.5M12 10v5M8.5 21l3.5-6 3.5 6' }],
  ['/privacy', 'privacy', { d: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z' }],
  ['/data', 'data', { d: 'M12 4v11M7.5 11l4.5 4.5 4.5-4.5M5 20h14' }],
];
