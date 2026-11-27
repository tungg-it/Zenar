/** Join class names, skipping false / null / undefined (for conditional Tailwind classes). */
export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");
