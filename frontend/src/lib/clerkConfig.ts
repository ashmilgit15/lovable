export const CLERK_PUBLISHABLE_KEY = (
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined
)?.trim() || "";

export const CLERK_ENABLED = Boolean(CLERK_PUBLISHABLE_KEY);
