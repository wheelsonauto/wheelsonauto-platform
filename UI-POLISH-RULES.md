# WheelsonAuto UI Polish Rules

These rules are part of the release gate. A feature is not done merely because it renders.

- No duplicate workspaces: one tab must represent one clear job and only its selected workspace may render.
- No nested cards: a card cannot be used as a page section or placed inside another card.
- No unnecessary cards: repeated summaries, actions, customer lists, and status panels must be combined or removed.
- No action walls: keep the immediate primary action visible and place occasional or destructive actions behind a contextual More control.
- No unnecessary tabs: a single-item group opens directly, and related tasks share internal tabs instead of expanding navigation.
- No session controls in operational headers: password reset and logout belong in Settings > Account.
- No unreachable controls: modal and message actions must remain visible above mobile navigation and safe areas.
- No horizontal page scrolling, clipped text, blurred hover states, or white surfaces inside the dark staff theme.
- Desktop, tablet, and phone layouts must all be checked before publishing.
- When testing reveals a polish problem, fix it in the same pass and add a regression check when the pattern could recur.
