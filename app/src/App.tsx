import { AntdProvider, ThemeProvider } from "@/components/providers";
import { WorkspacePage } from "@/components/pages";

/** Composition root: providers around the single workspace screen. */
export function App() {
  return (
    <ThemeProvider>
      <AntdProvider>
        <WorkspacePage />
      </AntdProvider>
    </ThemeProvider>
  );
}
