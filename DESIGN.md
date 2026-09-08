# Goshen Terminal design notes

Goshen Terminal should feel like a small piece of personal hardware: warm glass, deliberate controls, a bank of indicator lamps, and a rabbit keeping watch. The page remains useful beneath the atmosphere.

## Visual language

- Brand: **GOSHEN TERMINAL**, model **GT—01**.
- Warm amber `#efb866`, near-black olive `#111310`, cream text, ochre borders, and orange `#ee7545` accents.
- Alternate green and ice phosphor palettes use the same hierarchy.
- Local monospace fonts: Consolas, Cascadia Code, Courier New, then monospace. No remote font dependency.
- Thin panel borders, restrained glow, scanlines, small uppercase labels, and hardware-inspired spacing.
- HOPPER uses bounded text-cell art. Its reactions should be readable at small sizes without moving surrounding controls.

## Preserve the work underneath

ChatGPT gets a dedicated frame and instrument rail using its existing conversation, composer, and sidebar. Do not create a replacement chat interface, move native nodes, submit messages, or claim access to hidden model state.

Universal mode preserves native layout. The terminal treatment can alter text, surfaces, and accents; the frame treatment offers a lighter alternative for pages with complex visual design. Avoid blanket hiding, global position changes, inverted images, or overriding every button icon. Protected, unknown, and unsupported surfaces should remain usable.

## Motion and companion behavior

Small lamps may blink, light panels can sequence, and HOPPER can blink, twitch, hop, listen, and react. Avoid continuous full-screen flashes or large moving elements. Motion and quips are independently controllable. **Follow system reduced motion** lets the user apply their system setting, while **Ambient animation** remains a master switch for decorative motion.

Quips are short, local, prewritten, and infrequent. On generic pages they follow interface events without inspecting typed content. In ChatGPT only, a small set of keyword categories can select a fitting preset. Never present a quip as an answer from ChatGPT or display invented connection telemetry.

## Responsive and accessible behavior

The ChatGPT rail folds away when space is limited; focus mode gives conversation content more room. Universal treatment must not force a desktop-width layout onto a narrow page. Native forms, menus, focus behavior, selection, and scroll containers should remain accessible.

Use visible focus states and real labels for extension controls. Decorative art is hidden from assistive technology. Keep stable readable status text when animations are off, and retain the meaning and accessibility of any native loading control receiving a light-panel treatment.

## Verification

The local preview is a design fixture with simulated conversations, not evidence that a website integration works. Review the installed extension on real pages, including long content, native menus, text selection, forms, narrow windows, and removal of the skin. Document the exact version and what was checked.
