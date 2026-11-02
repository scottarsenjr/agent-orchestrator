# Memory design verification

Memory follows the repository's `DESIGN.md` and the scoped `frontend/DESIGN.md` contract. `PRODUCT.md` records the product brief. Preserve the existing AO components, themes and accessibility behavior when changing this surface.

For a project-local Codex installation of the official Impeccable skill, run from the repository root:

```sh
npx --yes impeccable@4.8.0 install --providers=codex --scope=project --yes
```

The installer places the skill under `.agents/skills/impeccable` and may install a project hook manifest. Honor the harness's hook trust requirements; do not assume the hook runs or bypass a trust prompt. The generated skill, hook state and binary are local tooling, not source artifacts. Read the installed `SKILL.md` and its applicable references before design work. The official installation and detector documentation is at <https://impeccable.style/docs/>.

If automatic hooks are unavailable or untrusted, run the pinned detector explicitly from the repository root:

```sh
npx --yes impeccable@4.8.0 detect frontend/src/renderer/components/MemoryView.tsx frontend/src/renderer/components/ShellTopbar.tsx
```

Review findings against the existing AO design contract. Detector output does not replace keyboard, theme, responsive, native-app and real-data visibility checks.
