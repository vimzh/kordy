# Project Instructions

## Frontend Components

- Always prefer an existing shadcn/ui component. Check the shadcn registry before creating a new primitive, and add the registry component when an equivalent exists.
- Create a custom component only when shadcn/ui has no suitable equivalent or when composing product-specific UI from existing primitives.
- Keep reusable or named UI components rendered by a page in their own files under `apps/web/src/components/`. Do not define component functions inside `page.tsx` or nest component definitions inside another component.
- Keep Next.js route files as pages under `apps/web/src/app/`; do not move or recreate page components in the components folder. Ordinary one-off page markup may remain directly in `page.tsx`.
