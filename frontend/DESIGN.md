# Memory design contract

This scoped contract supplements the repository's root `DESIGN.md`; it does not replace it. Source: AO commit d43a84a29d6226154bdcc30df727453a60af6168. Memory is an operational desktop surface; preserve AO's compact, dark-first visual language and use its approved reference boundary.

## Tokens and themes

- `src/styles/tokens.css` is the renderer token source; `src/renderer/styles.css` exposes semantic styling. Use background, foreground, card, muted, border, input, ring and existing semantic status roles instead of new colors. Dark `:root` and `data-theme="light"` define both modes; named palettes derive through `src/renderer/lib/theme-palettes.ts` and `theme-tokens.ts`.
- Default UI type is Geist Variable and mono is Geist Mono Variable; macOS uses its system alternatives. Existing type sizes include 12px secondary, 13px controls, 14px body and 17px empty headings. Do not introduce fonts.
- Spacing follows the existing 4px base and 4/6/8/10/12/14/16/18px dense rhythm. `--radius` is 0.625rem, with xs/sm/md/lg aliases and panel/full reserved for their existing roles. Use hairline dividers and tonal surfaces; avoid decorative outlines and card nesting.
- Respect focus, reduced motion and both light and dark token pairs. Use lucide-react icons with accessible names and existing sizes.

## Components and navigation

- `src/renderer/components/Sidebar.tsx` owns the 32px `SidebarTopNavRow` and `NavRowHighlight`, including collapsed tooltips. Automations and Artifacts navigate to `/automations` and `/artifacts`; their route files are `src/renderer/routes/_shell.automations.tsx` and `_shell.artifacts.tsx`. Place Memory beside these using the same row and route conventions.
- Reuse `components/ui/button.tsx`, `input.tsx`, `select.tsx`, `tooltip.tsx`, `TopbarButton.tsx`, and existing `workspace-topbar-container` styling where applicable. `AutomationsView.tsx` demonstrates the topbar and controls; root DESIGN.md limits visual authority to its approved references.
- Prefer one composed surface and shared lists with dividers. Keep labels concise and sentence case; show operational states explicitly without decorative status meaning.

## Memory usage

- Identify project and project/worktree/session scope visibly. Search, type and status controls must be keyboard usable, and scope/filter changes clear selected details immediately.
- Graph nodes represent only producer-returned source, proposition and entity records; edges represent only stored incidence or wiki-equivalent links. Do not visually imply support, contradiction, or inferred truth. Display truncation and provenance, and distinguish loading, empty, no-match, error and unavailable states.
- Provide keyboard-accessible selection and graph controls alongside pan, zoom and fit. Avoid encoding node type or state only by color. Apply existing tokens in all themes and preserve legibility at narrow center widths.
