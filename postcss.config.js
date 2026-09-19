/**
 * Tailwind v4 runs through @tailwindcss/vite (see vite.config.ts), so no PostCSS
 * plugins are needed here. This file exists only to stop PostCSS walking up past
 * the project root and inheriting an unrelated config from a parent directory.
 */
export default { plugins: {} }
