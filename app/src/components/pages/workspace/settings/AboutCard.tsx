import type { ReactNode } from "react";
import { SiFacebook, SiGithub, SiTiktok } from "react-icons/si";
import { openLink } from "@/service/links";
import logo from "@/assets/zenar.png";

// Each URL must also be allowed in src-tauri/capabilities/default.json, or it won't open.
const AUTHOR_LINKS: { label: string; url: string; icon: ReactNode }[] = [
  { label: "GitHub", url: "https://github.com/tungg-it", icon: <SiGithub /> },
  { label: "TikTok", url: "https://www.tiktok.com/@.tung_it", icon: <SiTiktok /> },
  { label: "Facebook", url: "https://www.facebook.com/tungtt.dev", icon: <SiFacebook /> },
];

/** Settings → General → About: the app, its author and where to follow them. */
export function AboutCard({ version }: { version: string }) {
  return (
    <div className="mt-2.5 overflow-hidden rounded-lg border border-z-border bg-z-elevated">
      <div className="flex items-center gap-4 p-4">
        <img src={logo} alt="" className="size-14 flex-none rounded-xl" draggable={false} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-semibold text-z-text">Zenar</span>
            {version && <span className="rounded bg-z-hover px-1.5 py-0.5 font-mono text-xs text-z-muted">v{version}</span>}
          </div>
          <div className="mt-1 text-sm text-z-muted">
            Made by <span className="font-medium text-z-text">Tung IT</span> · tung.webdeveloper@gmail.com
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 px-4 pb-4">
        {AUTHOR_LINKS.map(({ label, url, icon }) => (
          <button
            key={url}
            type="button"
            title={url}
            onClick={() => openLink(url).catch(() => {})}
            className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-z-border bg-z-bg px-3 text-sm text-z-text transition-colors duration-150 hover:border-z-border-strong hover:bg-z-hover"
          >
            <span aria-hidden className="flex text-md">
              {icon}
            </span>
            {label}
          </button>
        ))}
      </div>
      <div className="border-t border-z-border px-4 py-2 text-xs text-z-muted">© {new Date().getFullYear()} Zenar. All rights reserved.</div>
    </div>
  );
}
