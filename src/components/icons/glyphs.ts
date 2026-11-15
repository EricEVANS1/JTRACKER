// Path data for the JTracker icon system (JTracker Icon System v1), on a
// 24 px grid with 2 px padding. Each glyph may have one "destination" dot.

// Rounded rectangle and circle paths on the 24 px grid.
const R = (x: number, y: number, w: number, h: number, r: number) =>
  `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}Z`;
const C = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

export interface Glyph {
  d: string;
  dot?: [cx: number, cy: number, r: number];
}

export const GLYPHS = {
  // Core set.
  Dashboard: { d: R(3, 3, 8, 8, 2.5) + R(13, 3, 8, 8, 2.5) + R(3, 13, 8, 8, 2.5), dot: [17, 17, 2.5] },
  Applications: { d: R(3, 7, 18, 13, 3) + 'M8.5 7V5.5A2.5 2.5 0 0 1 11 3h2a2.5 2.5 0 0 1 2.5 2.5V7M3 12.5h6.5M14.5 12.5H21', dot: [12, 12.5, 2.2] },
  Board: { d: R(3, 4, 5, 16, 2) + R(10, 4, 5, 10, 2), dot: [19, 6, 2.2] },
  Search: { d: C(10.5, 10.5, 6.5) + 'M15.5 15.5 20.5 20.5', dot: [10.5, 10.5, 2.2] },
  Analytics: { d: 'M3 20h18M4 15.5l4.5-4.5 3.5 3 5.5-6.5', dot: [19.5, 6, 2.2] },
  Interviews: { d: R(3, 5, 18, 16, 3) + 'M8 3v4M16 3v4M3 10h18', dot: [15.5, 15.5, 2.2] },
  Offers: { d: 'M5 9V6a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v3' + R(3, 9, 18, 12, 3), dot: [12, 15, 2.2] },
  Inbox: { d: 'M4.5 5h15L22 15v3a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3L4.5 5ZM2 15h6l1.5 2.5h5L16 15h6', dot: [12, 10, 2.2] },
  Resume: { d: 'M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM14 3v5h5M9 17h6', dot: [10, 12.5, 2.2] },
  Notifications: { d: 'M6 10a6 6 0 0 1 12 0v3.5l2 3.5H4l2-3.5V10ZM10 20.5h4', dot: [18.5, 5, 2.5] },
  Assistant: { d: 'M11 4l1.8 5.2L18 11l-5.2 1.8L11 18l-1.8-5.2L4 11l5.2-1.8L11 4Z', dot: [19, 18.5, 2.2] },
  Settings: { d: 'M4 7h8M18 7h2M4 17h2M12 17h8' + C(15, 7, 2.5), dot: [9, 17, 2.5] },
  Hired: { d: 'M7 5h9v8.5a5 5 0 0 1-9 3', dot: [16, 5, 2.5] },
  Pending: { d: C(12, 12, 9) + 'M12 6.5v2.5', dot: [12, 12, 2.2] },
  Success: { d: C(12, 12, 9) + 'M8 12l3 3 5-6' },
  Rejected: { d: C(12, 12, 9) + 'M9 9l6 6M15 9l-6 6' },
  Import: { d: 'M12 3v11M7.5 9.5 12 14l4.5-4.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2' },
  Export: { d: 'M12 14V3M7.5 7.5 12 3l4.5 4.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2' },
  Email: { d: R(3, 5, 18, 14, 3) + 'M4 8l8 5.5L20 8' },
  Profile: { d: C(12, 8, 4) + 'M4 21a8 8 0 0 1 16 0' },
  // Line versions of the signature glyphs: the follow-up loop, the page whose
  // last line is the JTracker j, the person with your history trailing from them.
  FollowUps: { d: 'M5 12a7 7 0 1 0 7-7H8M10.5 2.5 8 5l2.5 2.5', dot: [12, 12, 2.5] },
  CvTracking: { d: R(5, 3, 14, 18, 3) + 'M9 7.5h4M9.5 12H15v2.5a2.5 2.5 0 0 1-2.5 2.5H11', dot: [15, 12, 2] },
  Recruiters: { d: C(10, 8, 4) + 'M3 20a7 7 0 0 1 14 0M16.5 9.5h2a2 2 0 0 1 2 2v3', dot: [20.5, 17.5, 2] },
  // Drawn to the same rules for pages the set doesn't cover. Companies: the
  // door is the destination. Share: one route branching, landing at the dot.
  Companies: { d: 'M4 21V6a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v15M16 10h1a3 3 0 0 1 3 3v8M2.5 21h19M8 8h4', dot: [10, 15.5, 2] },
  Share: { d: C(6, 12, 2.5) + C(18, 18, 2.5) + 'M8.3 10.8l7.4-4M8.3 13.2l7.4 4', dot: [18, 6, 2.5] },
  // Utility glyphs: no dot, so the dot keeps its meaning.
  Archive: { d: R(3, 4, 18, 5, 2) + 'M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4' },
  Sun: { d: C(12, 12, 4) + 'M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4' },
  Moon: { d: 'M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z' },
  SystemTheme: { d: R(3, 4, 18, 13, 3) + 'M8 21h8M12 17v4' },
} satisfies Record<string, Glyph>;

export type GlyphName = keyof typeof GLYPHS;
