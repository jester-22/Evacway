# EvacWay: Evacuation Centers Module, Design Spec

Every prompt refers to this by section number (e.g. "§4.2"). Do not change it unless the user asks.

## §0. Purpose and users

EvacWay helps the municipality of Sogod, Southern Leyte manage evacuation centers during hazards (floods, landslides). The Evacuation Centers admin module answers four questions fast, under stress:

Which centers can take more people right now? (capacity)
Who is assigned to each center and who has actually arrived? (households)
Is the center ready to be used? (mapped, rooms, entrance, contact, accessibility)
What changed recently and who changed it? (activity)

Users: admin (full control) and LGU staff (/lgu, follow the existing role gating; never expose admin-only actions such as Deactivate, Edit, Add building to non-admins). Primary device: laptop 1366×768. Must also work on tablet and phone.

Design personality: calm, clear, trustworthy. Low visual noise, strong hierarchy, plain language. Nothing decorative.

## §1. Information architecture
Sidebar: Evacuation Centers
 └─ List page  (/admin?tab=centers)
      └─ Center detail page (same route, selected center id)
           ├─ Header + actions
           ├─ Readiness banner (only if not mapped)
           ├─ KPI strip (4 cards)
           └─ Tabs: Overview · Structure · Households · Activity

Rules: same 4 tabs for every center (single venue or multi-building). Default tab = Overview. Page-level actions live in the header; tab-level actions live inside the tab's own toolbar. The tab row contains only tabs.

## §2. Glossary (use these exact words everywhere)
| Term | Meaning | Never say |
|------|---------|-----------|
| Capacity | total people the center can shelter | "shelter limit", "max" |
| Assigned | people in households assigned to this center | "here" |
| Checked in | assigned people who physically arrived | "present", "here" |
| Space left | Capacity − Assigned, in people | "rooms available" |
| Household | one family unit (family_id) | "family" in UI labels |
| Member | one person in a household | |
| Not in a room yet | household assigned to a center but not a room | "Unassigned" |
| Needs mapping | center has no location on the map | "Not mapped" badge on every row |

## §3. Status logic (single source of truth, one constants file)
occupancy = assigned / capacity
Available: occupancy < 0.85 (green)
Near full: 0.85 ≤ occupancy < 1.00 (amber)
Full: occupancy ≥ 1.00 (red)
Closed: center deactivated (gray)
If capacity is 0 or missing → show "—" and no bar; never divide by zero.
Every status has an icon and text, never color alone.
## §4. Features by screen

### §4.1 List page
Header (compact, one row): title, one-line subtitle, refresh icon button, primary Add Center (admin only).
Quick-filter chips with counts: All · Available · Near full · Full · Needs mapping. One active at a time.
Toolbar: search (name or barangay), Barangay filter, "Clear filters" (visible only when filters are active), result count. View toggle only if a Cards view really exists.
Table columns: Center (name, up to 2 barangay chips + "+n", small pin-off icon with tooltip if not mapped) · Structure ("Single venue" / "5 buildings · 67 rooms" / "12 rooms") · Occupancy (bar + "5 of 120 assigned", muted "0 checked in") · Households (count from loaded data, else "—") · Status · Actions (kebab: Edit, View on map, Add rooms, Deactivate).
Whole row opens the detail page. Kebab does not.
States: loading skeleton rows, empty ("No centers match your filters" + Clear filters), error with Retry.

### §4.2 Detail header and banner
Breadcrumb Evacuation Centers / <name> (clickable).
Title (name), status badge, barangay chips, contact number (tap-to-call link).
Actions right: Assign Household (primary), View on map (secondary), Edit center (secondary, admin), kebab overlay (Add rooms, Add building, Print manifest, Export CSV, divider, Deactivate in danger style with confirm).
Banner (slim, dismissible, only when not mapped): "This center isn't on the map yet" + Place on map. Remember dismissal per center in localStorage (wrap in try/catch).

### §4.3 KPI strip
Four equal cards: Capacity, Assigned (with % bar), Space left, Checked in (with bar vs assigned). Each has a one-line helper: "Total people it can shelter", "x of y assigned", "People it can still take", "x of y assigned have arrived". Numbers use the mono font.

### §4.4 Overview tab
Two columns (2/3 + 1/3), stack on narrow screens.

Center Information card: 2-column grid (label above value): Type of place, Building material, Accessibility, Contact, Barangays served, Address. "Edit" button top-right of the card (admin).
Capacity by Barangay card: table with Barangay, Rooms, Assigned, Checked in and a mini bar. Empty: "No barangay data yet".
Readiness checklist card: rows with ✓ / ! icon, plain label, and an action button when to-do: Placed on the map → "Place on map"; Rooms added (optional if the existing assign flow works without rooms) → "Add room"; Entrance point set → "Set entrance"; Contact number → "Edit"; Accessibility info → "Edit". A "3 of 5 ready" progress line on top.
Vulnerable households card: counts of pregnant, PWD, elderly, children, needs assistance, from existing household data. Hidden if data is unavailable.

### §4.5 Structure tab
Toolbar: Add building (secondary), Add room (primary), search rooms, "Group by" segmented control (Building / None).
Single-venue centers: one rooms table, plus a one-line note "Single venue. Rooms are listed without buildings."
Multi-building: accordion per building (name, mapped icon, room count, mini occupancy bar); expand to show a rooms table (Room, Capacity, Assigned, Checked in, actions). Rooms without a building go in a normal group "Not linked to a building" with a Link to building action.
Compact stats line: "2 buildings · 12 rooms · 65 assigned · 0 checked in". No decorative progress bar.
Empty state: "No rooms yet", one line of help, Add room button, all visible without scrolling at 1366×768.

### §4.6 Households tab
Toolbar: search (name, phone), segmented filters with counts (All · Not yet arrived · Checked in · Vulnerable), "Group by" (Room / Barangay), Assign Household (primary).
Summary line: "1 household · 5 members · 0 vulnerable".
Group header: room name (or "Not in a room yet"), "n households · m members", capacity bar when the room has capacity.
Row (one shared CSS grid with the header): avatar initials + head-of-household name (never wrapped into a narrow column) with barangay below · members + phone · status chip (Not yet arrived / Checked in) · needs chips (Pregnant, PWD, Elderly, Needs assistance) · actions: Check in (only if an existing endpoint supports it), Move, Unassign (ghost danger, confirm dialog). On narrow screens actions collapse into a kebab.
Long lists: simple pagination (25 per page) or virtualization. Row height 64px.
Empty: "No households assigned yet" + Assign Household.

### §4.7 Activity tab
Timeline or list, newest first. Each item: icon by action type (added, edited, assigned, moved, unassigned, deactivated), a human sentence, who (user name, else "Admin"), friendly time ("Oct 27, 3:03 PM", plus relative "2 h ago" on hover).
Never show internal ids or slugs. Never show "User #1".
Optional filter chips by action type. Empty: "No activity yet".

### §4.8 Modals and drawers
One consistent shell: header (title + subtitle with the center name + close), body, footer (Cancel left, primary right). Escape closes. Focus is trapped and returns to the trigger. Body scroll locked; modal body scrolls internally if tall.

Add Room: room name/number (required), capacity (required, number ≥ 1), building (optional select). Small info note (not a big yellow box) if the center isn't on the map.
Add Building: name (required), optional notes.
Assign Household: search a household, pick a room (optional), show remaining space, warn (don't block) if it would exceed capacity.
Move Household: choose target center and room, show target space left.
Edit Center: existing fields. Name fields must not accept digits.
Confirm dialog: for Unassign and Deactivate, states what will happen in plain words.

## §5. Design tokens (add to index.css only if missing; reuse existing names where they exist)
Spacing: 4, 8, 12, 16, 24, 32. Page padding 24 (16 on mobile). Gap between header / banner / KPI / tabs = 16. Card padding 20–24.
Type: page title 28px Oswald; card/section title 16px semibold Inter; body 14px Inter; caption/label 12px; KPI value 28px JetBrains Mono. Numbers and ids always mono.
Radius: 12 for cards, 8 for controls, 999 for chips.
Elevation: one card level: 1px border + subtle shadow. Overlays (menus, modals) get one stronger shadow.
Color roles: primary (blue, actions only), success (green), warning (amber), danger (red), neutral (grays), info (light blue banner). Text on colored backgrounds must reach 4.5:1.
Control height: 36px default, 40px primary actions, 44px tap targets on touch layouts.
Motion: 150–200ms, ease-out, honor prefers-reduced-motion.

## §6. Layout and scrolling (non-negotiable)
App shell: display:grid; grid-template-columns: <sidebar> 1fr; height:100dvh; overflow:hidden.
Sidebar scrolls itself. The main content column has min-width:0; min-height:0; overflow-y:auto and is the only vertical scroller.
Pages use natural height. No fixed heights, no nested vertical scrollers. Wide tables get an overflow-x:auto wrapper only.
32px bottom padding inside the scroll area.
Dropdown menus are overlays (absolute or portal), never in normal flow.
Breakpoints: ≥1280 two-column layouts; 768–1279 single column, KPI 2×2; <768 tables become stacked cards, tabs scroll horizontally.

## §7. Data and performance
Frontend only. Use existing endpoints through services/api and the shared TanStack Query hooks (useEvacuationQueries.js). No new per-row requests. Reuse query keys so list, detail and dashboard share one cache.
Tab switches never refetch cached data.
After every mutation (assign, move, unassign, add room/building, edit, deactivate, check in) invalidate related query keys so numbers refresh at once.
If a figure can't be derived from existing data, show "—" or hide the element. Never show a wrong number.
Thresholds and status helpers live in one file (e.g. evacuationStatus.js).

## §8. Accessibility and quality bar
Real <button> / <a>; labelled inputs; role="tablist"/tab/tabpanel; visible focus ring; aria-expanded on menus; table headers with scope.
Keyboard: Tab order follows visual order; Escape closes overlays; Enter/Space activate rows and buttons.
No console errors or warnings. npm run build and lint pass.
Verified visually at 1366×768, 1024×768 and 390×844, scrolled to the bottom of every tab.

## §9. Copy rules
Plain, short, friendly, active voice. Sentence case. No jargon, no raw ids. Errors say what happened and what to do ("Couldn't load centers. Check your connection and try again." + Retry). Empty states: title + one line + one button.
