import { useEffect, useState } from "react";
import { Alert, App as AntApp, Button, Input, Switch } from "antd";
import { LuTrash2 } from "react-icons/lu";
import { discardOnClose, setDiscardOnClose } from "@/libs/prefs";
import { pickFolder } from "@/service/files";
import { getVersion } from "@tauri-apps/api/app";
import { clearCaptured, getCaptured, getRunOptions, setRunOptions } from "@/service/runner";
import type { RunOptions } from "@/bindings/RunOptions";
import { EllipsisText, KvRow, KvTable } from "@/components/ui";
import { cx } from "@/libs/cx";
import { AboutCard } from "./AboutCard";
import { settingDesc, settingLabel, settingRow, SettingRow, SettingSection } from "./SettingRow";

const lead = cx(settingDesc, "my-2.5 text-base");

const PROXY_SCHEMES = ["http:", "https:", "socks5:", "socks5h:"];

/** Why `proxy` can't be used, or null when it is empty or a valid proxy URL. */
function proxyError(proxy: string): string | null {
  if (!proxy) return null;
  try {
    const u = new URL(proxy);
    return PROXY_SCHEMES.includes(u.protocol) && u.hostname ? null : "Use http://, https:// or socks5:// with a host, e.g. http://proxy:8080";
  } catch {
    return "Not a URL, e.g. http://proxy:8080";
  }
}

// Per-machine state, never saved to the repo.

/** Settings → General: connection options, tabs, the Collection folder, Captured Variables and About for this machine. */
export function GeneralSettings({
  root,
  refreshKey,
  path,
  onPathChange,
  onOpen,
}: {
  root: string;
  refreshKey: number;
  /** Collection folder typed or picked, opened with `onOpen`. */
  path: string;
  onPathChange: (p: string) => void;
  onOpen: () => void;
}) {
  const { modal } = AntApp.useApp();
  const [captured, setCaptured] = useState<Record<string, string>>({});
  const [options, setOptions] = useState<RunOptions>({ insecure_tls: false });
  // Proxy as typed; saved on blur / Enter once it is valid, so a half-typed URL never reaches Requests.
  const [proxy, setProxy] = useState("");
  const [proxyInvalid, setProxyInvalid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [discard, setDiscard] = useState(discardOnClose);
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);
  useEffect(() => {
    getRunOptions()
      .then((o) => {
        setOptions(o);
        setProxy(o.proxy ?? "");
      })
      .catch((e) => setError(String(e)));
  }, []);
  useEffect(() => {
    if (!root) return;
    getCaptured(root).then(setCaptured).catch((e) => setError(String(e)));
  }, [root, refreshKey]);

  const saveOptions = (o: RunOptions) => {
    setOptions(o);
    setRunOptions(o).catch((e) => setError(String(e)));
  };

  function commitProxy() {
    const value = proxy.trim();
    const invalid = proxyError(value);
    setProxyInvalid(invalid);
    if (!invalid && value !== (options.proxy ?? "")) saveOptions({ ...options, proxy: value || undefined });
  }

  const capturedEntries = Object.entries(captured);

  function confirmClearCaptured() {
    modal.confirm({
      title: `Clear ${capturedEntries.length} Captured Variable${capturedEntries.length === 1 ? "" : "s"}?`,
      content: "They are removed from this machine only. Sending the Requests that capture them sets them again.",
      okText: "Clear",
      okButtonProps: { danger: true },
      onOk: () =>
        clearCaptured(root)
          .then(() => setCaptured({}))
          .catch((e) => setError(String(e))),
    });
  }

  return (
    <>
      {error && <Alert type="error" title={error} className="mb-3" closable onClose={() => setError(null)} />}
      <SettingSection title="Request">
        <SettingRow label="SSL certificate verification" description="Turn off to accept self-signed or otherwise untrusted TLS certificates.">
          <Switch size="small" checked={!options.insecure_tls} onChange={(on) => saveOptions({ ...options, insecure_tls: !on })} aria-label="SSL certificate verification" />
        </SettingRow>
        <SettingRow
          label="Proxy URL"
          htmlFor="proxy"
          description={
            proxyInvalid ? (
              <span id="proxy-error" role="alert" className="text-z-delete">
                {proxyInvalid}
              </span>
            ) : (
              "Send every Request through this proxy. Leave empty for a direct connection."
            )
          }
        >
          <Input
            id="proxy"
            className="w-64 font-mono text-code"
            placeholder="http://proxy:8080"
            allowClear
            status={proxyInvalid ? "error" : undefined}
            aria-invalid={!!proxyInvalid}
            aria-describedby={proxyInvalid ? "proxy-error" : undefined}
            value={proxy}
            onChange={(e) => {
              setProxy(e.target.value);
              if (proxyInvalid) setProxyInvalid(proxyError(e.target.value.trim()));
            }}
            onBlur={commitProxy}
            onPressEnter={commitProxy}
          />
        </SettingRow>
      </SettingSection>

      <SettingSection title="Tabs">
        <SettingRow label="Always discard unsaved changes" description="Close tabs with unsaved changes without asking.">
          <Switch
            size="small"
            checked={discard}
            aria-label="Always discard unsaved changes"
            onChange={(on) => {
              setDiscard(on);
              setDiscardOnClose(on);
            }}
          />
        </SettingRow>
      </SettingSection>

      <SettingSection title="Collection folder">
        <p className={lead}>Open a Collection that is already cloned on this machine, by its folder.</p>
        <div className={settingRow(true)}>
          <label className={settingLabel} htmlFor="collection-path">
            Location
          </label>
          <div className="flex gap-2">
            <Input id="collection-path" className="font-mono text-code" placeholder="/path/to/collection" value={path} onChange={(e) => onPathChange(e.target.value)} onPressEnter={onOpen} />
            <Button onClick={() => pickFolder("Choose a Collection folder").then((p) => p && onPathChange(p))}>Choose</Button>
            <Button type="primary" disabled={!path.trim()} onClick={onOpen}>
              Open
            </Button>
          </div>
        </div>
      </SettingSection>

      <SettingSection title={capturedEntries.length ? `Captured Variables (${capturedEntries.length})` : "Captured Variables"}>
        {!root ? (
          <p className={lead}>Open a Collection to see its Captured Variables.</p>
        ) : capturedEntries.length === 0 ? (
          <p className={lead}>None yet. Add capture rules to a Request and send it.</p>
        ) : (
          <>
            <KvTable className="mt-2.5">
              {capturedEntries.map(([k, v]) => (
                <KvRow columns="readonly" key={k}>
                  <EllipsisText text={`{{${k}}}`} className="block min-w-0 truncate font-mono text-code font-medium" />
                  <EllipsisText text={v} className="block min-w-0 truncate font-mono text-code" />
                </KvRow>
              ))}
            </KvTable>
            <Button icon={<LuTrash2 />} className="mt-2" danger onClick={confirmClearCaptured}>
              Clear captured
            </Button>
          </>
        )}
      </SettingSection>

      <SettingSection title="About">
        <AboutCard version={version} />
      </SettingSection>
    </>
  );
}
