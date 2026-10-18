import { useEffect, useState } from "react";
import { Check, Cloud, HardDrive, RefreshCw } from "lucide-react";
import { Button, IconButton, Status } from "../components/ui";
import { bridge, type LocalStatus } from "../lib/bridge";

const DEMO: LocalStatus = {
  running: true,
  models: [
    { name: "qwen3:14b", size: 9.0e9 },
    { name: "llama4:8b", size: 4.9e9 },
    { name: "gemma3:4b", size: 3.3e9 },
  ],
  added: [{ id: "demo", model: "qwen3:14b", name: "qwen3:14b" }],
};

const gb = (n: number) => `${(n / 1e9).toFixed(1)} GB`;

/** `cloud={false}` hides the Gemini key box (Settings has every key under Keys). */
export function BrainSetup({ onReady, cloud = true }: { onReady?: () => void; cloud?: boolean }) {
  const [local, setLocal] = useState<LocalStatus | null>(bridge ? null : DEMO);
  const [hasKey, setHasKey] = useState(false);
  const [key, setKey] = useState("");
  const [keyMsg, setKeyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async () => {
    if (!bridge) return;
    setLocal(null);
    const [l, o] = await Promise.all([bridge.localDetect(), bridge.overview()]);
    setLocal(l);
    setHasKey(o.hasGeminiKey);
  };
  useEffect(() => {
    void refresh();
  }, []);

  const notify = () => {
    bridge?.post({ type: "action", name: "refresh", id: "bo" });
    onReady?.();
  };

  const add = async (model: string) => {
    if (!bridge) return;
    setBusy(model);
    const r = await bridge.localAdd(model);
    setBusy(null);
    if (r.ok) {
      await refresh();
      notify();
    }
  };

  const save = async () => {
    if (!bridge) {
      setKeyMsg({ ok: true, text: "Saved (preview only)" });
      return;
    }
    const r = await bridge.setKey(key);
    setKeyMsg(r.ok ? { ok: true, text: "Saved. Your crew can use Gemini now." } : { ok: false, text: r.error ?? "Could not save the key." });
    if (r.ok) {
      setKey("");
      setHasKey(true);
      notify();
    }
  };

  return (
    <div className="brains">
      <section className="local">
        <div className="local__head">
          <HardDrive />
          <span>
            <b>On this computer</b>
            <span className="eyebrow">{local === null ? "Looking for Ollama" : local.running ? `Ollama · ${local.models.length} models · nothing leaves your machine` : "Ollama is not running"}</span>
          </span>
          {local === null ? <Status tone="waiting">Checking</Status> : local.running ? <Status tone="live">Ready</Status> : <Status tone="waiting">Off</Status>}
          <IconButton label="Check again" onClick={() => void refresh()}>
            <RefreshCw />
          </IconButton>
        </div>
        {local && !local.running && (
          <p className="local__empty">
            Install Ollama from <b>ollama.com</b>, open it, then pull a model such as <code>qwen3:8b</code>. Come back and press check again.
          </p>
        )}
        {local && local.running && local.models.length === 0 && <p className="local__empty">Ollama is running but has no models yet. Pull one, for example <code>ollama pull qwen3:8b</code>.</p>}
        {local && local.models.length > 0 && (
          <ul className="models">
            {local.models.map((m) => {
              const added = local.added.some((a) => a.model === m.name);
              return (
                <li key={m.name}>
                  <span className="models__name">{m.name}</span>
                  <span className="eyebrow num">{gb(m.size)}</span>
                  <span className="models__who">
                    {added ? (
                      <span className="eyebrow models__added">
                        <Check />
                        Added
                      </span>
                    ) : (
                      <Button size="sm" label={busy === m.name ? "Adding" : "Use"} disabled={busy !== null} onClick={() => void add(m.name)} />
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {cloud && (
      <section className="cloudkey">
        <div className="cloudkey__head">
          <Cloud />
          <span>
            <b>Gemini, in the cloud</b>
            <span className="eyebrow">{hasKey ? "Key added" : "Free key from aistudio.google.com"}</span>
          </span>
          {hasKey && <Status tone="done">Added</Status>}
        </div>
        <div className="cloudkey__row">
          <input type="password" value={key} placeholder={hasKey ? "Replace your key" : "Paste your Gemini key"} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} />
          <Button variant="ink" size="sm" label="Save" disabled={!key.trim()} onClick={() => void save()} />
        </div>
        {keyMsg && <p className={`cloudkey__msg ${keyMsg.ok ? "is-ok" : "is-bad"}`}>{keyMsg.text}</p>}
      </section>
      )}
    </div>
  );
}
