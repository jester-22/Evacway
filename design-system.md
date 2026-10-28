# EvacWay Design System (v2, short)

## Use existing styles
Use the project's existing CSS/Tailwind setup and icon set. Do not create a parallel class system (no new prefixed classes), do not add libraries, fonts or icon sets. Put tokens where the project already defines them.

## Principles
1. One question per screen, answered first. Everything else is hidden behind a tap.
2. Show names, not codes: "Sogod Central School · South Wing · Room 12".
3. Fewer boxes, more whitespace. No cards inside cards. Group with spacing and a divider line.
4. Badges only for exceptions (Full, Inactive, Not mapped). Never repeat the same badge on every row.
5. Status = color + text (an icon only where it adds meaning). Never color alone.
6. One primary button per screen. Other actions are secondary or in a "..." menu.
7. No horizontal scroll. One vertical scroll area per panel. Tables become stacked cards under 768px.

## Colors (no additions)
Brand blue #2563eb (hover #1d4ed8). Status: green #16a34a, amber #d97706, red #dc2626. Text #0f172a / #475569 / #64748b. Border #e2e8f0. Surfaces #ffffff and #f8fafc. Map occupancy colors keep one meaning only: never reuse them for other things.

## Type, spacing, shape
Font: the existing font. Sizes 12 / 13 / 14 / 16 / 18 / 24 (page title). Weights 400 / 500 / 600. Line height 1.4-1.5. Body at least 14px on admin, 16px for resident text and inputs.
Spacing 4 / 8 / 12 / 16 / 24 / 32. Radii 8 (buttons, inputs), 12 (cards), 16 (panels, sheets). One shadow: 0 1px 2px rgba(15,23,42,0.06); floating panels 0 8px 24px rgba(15,23,42,0.12). No gradients.

## Components
- Buttons: 44px tall on mobile and resident screens, 40px on admin desktop. 8px minimum gap. Visible focus ring 2px blue, 2px offset. Transitions 150ms on color only.
- Cards: 1px border, white, no heavy shadow. No colored left borders.
- Modals: centered, max width 480px, max height 80vh. Bottom sheet on mobile, max 85%. Close with X, Escape, backdrop.
- Map overlays: white, 1px border, small. Never cover map controls or the search results.
- States: skeleton rows for loading; empty state with one line and one action; error with plain wording and Retry. No raw errors shown to users.

## Numbers
Always "0 of 35 here · 35 assigned". Occupied (checked in) drives colors and bars. Assigned is text.

## Accessibility
Contrast at least 4.5:1 for text (brand blue buttons use white text). Labels on every input. Everything keyboard reachable. Respect reduced motion.

## Anti-patterns
Gradients, neon colors, cards in cards, repeated badges, decorative icons, color-only status, placeholder-only inputs, nested scrollbars, tiny tap targets.
