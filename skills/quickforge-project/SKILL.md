# QuickForge Project Skill

Use this skill when modifying this QuickForge application.

## Project Rules

- Make surgical changes only; avoid broad refactors.
- Keep server API changes small and local to `server/routes` or dedicated modules.
- Keep frontend state changes explicit and close to the component/hook that owns them.
- Preserve local-only safety assumptions for workspace access.
- For project-scoped features, persist configuration in the project config where possible.
- Verify with `npm run build` or a targeted command before finishing.

## Notes

QuickForge has a React/Vite frontend and a local Node.js backend. Project chats can use workspace tools when YOLO mode is enabled.
