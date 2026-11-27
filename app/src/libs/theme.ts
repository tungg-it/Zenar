// Light / dark palettes. One palette per mode feeds both Ant Design (ConfigProvider tokens) and the
// `--z-*` CSS variables behind the Tailwind `z-*` colours (styles/globals.css), so Tailwind classes and Ant components always agree.
import { theme as antdTheme, type ThemeConfig } from "antd";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const palettes = {
  dark: {
    bg: "#212121",
    bgSidebar: "#1c1c1c",
    bgHeader: "#1a1a1a",
    bgElevated: "#2b2b2b",
    bgCode: "#1a1a1a",
    hover: "#2c2c2c",
    active: "#353535",
    border: "#333333",
    borderStrong: "#454545",
    text: "#e6e6e6",
    textMuted: "#a6a6a6",
    textFaint: "#7c7c7c",
    primary: "#d9491a",
    link: "#6ea8fe",
    dirty: "#ff8a5c",
    get: "#3fd07a",
    post: "#ffc23d",
    put: "#5aa6ff",
    patch: "#c39bff",
    delete: "#ff6b61",
    other: "#a6a6a6",
    graphql: "#e535ab",
    codeKey: "#9cdcfe",
    codeString: "#ce9178",
    codeNumber: "#b5cea8",
    codeBool: "#569cd6",
    codeTag: "#569cd6",
    codeAttr: "#9cdcfe",
    codeComment: "#6a9955",
    searchHit: "#613214",
    closeHover: "#c42b1c",
    onCloseHover: "#ffffff",
  },
  light: {
    bg: "#ffffff",
    bgSidebar: "#f9f9f9",
    bgHeader: "#f2f2f2",
    bgElevated: "#ffffff",
    bgCode: "#f6f6f6",
    hover: "#ededed",
    active: "#e3e3e3",
    border: "#e3e3e3",
    borderStrong: "#cfcfcf",
    text: "#212121",
    textMuted: "#5c5c5c",
    textFaint: "#7a7a7a",
    primary: "#d9491a",
    link: "#0b62d6",
    dirty: "#d9491a",
    get: "#007f31",
    post: "#8a5d00",
    put: "#0053b8",
    patch: "#623497",
    delete: "#b3261e",
    other: "#5c5c5c",
    graphql: "#b0137c",
    codeKey: "#0451a5",
    codeString: "#a31515",
    codeNumber: "#098658",
    codeBool: "#0000ff",
    codeTag: "#800000",
    codeAttr: "#c50000",
    codeComment: "#008000",
    searchHit: "#ffe08a",
    closeHover: "#c42b1c",
    onCloseHover: "#ffffff",
  },
} as const;

const FONT = `-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
const MONO = `ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`;

/** Ant Design theme for a resolved mode, built from the same palette as the CSS variables. */
export function antdThemeFor(resolved: ResolvedTheme): ThemeConfig {
  const p = palettes[resolved];
  return {
    algorithm: resolved === "dark" ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: p.primary,
      colorLink: p.link,
      colorBgLayout: p.bg,
      colorBgContainer: p.bg,
      colorBgElevated: p.bgElevated,
      colorBorder: p.borderStrong,
      colorBorderSecondary: p.border,
      colorText: p.text,
      colorTextSecondary: p.textMuted,
      fontFamily: FONT,
      fontFamilyCode: MONO,
      fontSize: 13,
      borderRadius: 4,
      controlHeight: 30,
      motionDurationMid: "0.15s",
    },
    components: {
      Tabs: { horizontalMargin: "0", horizontalItemPadding: "8px 0" },
    },
  };
}

/** A few colours of `resolved` as `--p-*` variables, to draw a small preview of that mode next to the current one. */
export function previewVars(resolved: ResolvedTheme): Record<string, string> {
  const p = palettes[resolved];
  return { "--p-bg": p.bg, "--p-sidebar": p.bgSidebar, "--p-header": p.bgHeader, "--p-border": p.border, "--p-text": p.textFaint, "--p-primary": p.primary };
}

/** Write the palette of `resolved` to the `--z-*` CSS variables on <html>. */
export function applyCssVars(resolved: ResolvedTheme) {
  const p = palettes[resolved];
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  const vars: Record<string, string> = {
    "--z-bg": p.bg,
    "--z-bg-sidebar": p.bgSidebar,
    "--z-bg-header": p.bgHeader,
    "--z-bg-elevated": p.bgElevated,
    "--z-bg-code": p.bgCode,
    "--z-hover": p.hover,
    "--z-active": p.active,
    "--z-border": p.border,
    "--z-border-strong": p.borderStrong,
    "--z-text": p.text,
    "--z-text-muted": p.textMuted,
    "--z-text-faint": p.textFaint,
    "--z-primary": p.primary,
    "--z-link": p.link,
    "--z-dirty": p.dirty,
    "--z-method-get": p.get,
    "--z-method-post": p.post,
    "--z-method-put": p.put,
    "--z-method-patch": p.patch,
    "--z-method-delete": p.delete,
    "--z-method-other": p.other,
    "--z-graphql": p.graphql,
    "--z-code-key": p.codeKey,
    "--z-code-string": p.codeString,
    "--z-code-number": p.codeNumber,
    "--z-code-bool": p.codeBool,
    "--z-code-tag": p.codeTag,
    "--z-code-attr": p.codeAttr,
    "--z-code-comment": p.codeComment,
    "--z-search-hit": p.searchHit,
    "--z-close-hover": p.closeHover,
    "--z-on-close-hover": p.onCloseHover,
    "--z-font": FONT,
    "--z-mono": MONO,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}
