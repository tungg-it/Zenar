import type { ReactNode } from "react";
import { App, ConfigProvider } from "antd";
import { StyleProvider } from "@ant-design/cssinjs";
import { antdThemeFor } from "@/libs/theme";
import { useTheme } from "./ThemeProvider";

/** Ant Design theme for the current light/dark mode, plus `App` so `App.useApp()` (modal, message) works.
 *  Ant's styles go in `@layer antd` (ordered in globals.css) so Tailwind utilities on Ant components win. */
export function AntdProvider({ children }: { children: ReactNode }) {
  const { resolved } = useTheme();
  return (
    <StyleProvider layer>
      <ConfigProvider theme={antdThemeFor(resolved)}>
        <App className="h-full">{children}</App>
      </ConfigProvider>
    </StyleProvider>
  );
}
