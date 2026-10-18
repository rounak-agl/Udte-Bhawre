import { useEffect, useState, type ReactNode } from "react";
import { Database, Eye, EyeOff, KeyRound, Lock, Mic, RefreshCw, ShieldCheck } from "lucide-react";
import { Button, IconButton, Status } from "../components/ui";
import { bridge, type AppInfo, type ArmorTest, type KeyProvider, type SecurityOverview } from "../lib/bridge";

type Msg = { ok: boolean; text: string } | null;

/** A hidden secret with show/hide and Save. `save` returns the message to show under it. */
function SecretRow({ label, hint, placeholder, load, save }: { label: string; hint?: ReactNode; placeholder?: string; load: () => Promise<string>; save: (v: string) => Promise<Msg> }) {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => {
    load()
      .then((v) => {
        setValue(v || "");
        setSaved(v || "");
      })
      .catch(() => {});
  }, []);
  const dirty = value.trim() !== saved;
  const submit = async () => {
    if (busy || !dirty) return;
    setBusy(true);
    setMsg(null);
    try {
      const v = value.trim();
      setMsg(await save(v));
      setSaved(v);
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Could not save." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="secret">
      <div className="secret__head">
        <b>{label}</b>
        {saved ? <Status tone="done">Set</Status> : <span className="eyebrow">Not set</span>}
      </div>
      <div className="secret__row">
        <input
          type={shown ? "text" : "password"}
          value={value}
          placeholder={placeholder}
          aria-label={label}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
        />
        <IconButton label={shown ? "Hide" : "Show"} onClick={() => setShown((s) => !s)}>
          {shown ? <EyeOff /> : <Eye />}
        </IconButton>
        <Button variant="ink" size="sm" label={busy ? "Saving" : "Save"} disabled={busy || !dirty} onClick={() => void submit()} />
      </div>
      {hint && <p className="field__hint">{hint}</p>}
      {msg && <p className={`cloudkey__msg ${msg.ok ? "is-ok" : "is-bad"}`}>{msg.text}</p>}
    </div>
  );
}

const PROVIDER_KEYS: { provider: KeyProvider; label: string; placeholder: string; hint: string }[] = [
  { provider: "gemini", label: "Gemini", placeholder: "AIza… or AQ.…", hint: "Used by crew members on Gemini. Free key from aistudio.google.com/apikey." },
  { provider: "claude", label: "Claude (Anthropic)", placeholder: "sk-ant-…", hint: "Optional. Leave empty to use your claude login." },
  { provider: "codex", label: "Codex (OpenAI)", placeholder: "sk-…", hint: "Optional. Leave empty to use your codex login." },
  { provider: "copilot", label: "Copilot (GitHub)", placeholder: "github_pat_… / ghp_…", hint: "Optional. Leave empty to use your GitHub CLI login." },
];

const refreshCrew = () => bridge?.post({ type: "action", name: "refresh", id: "bo" });

/** Brain keys, voice and database: everything the classic Settings → General page had. */
export function KeysPanel() {
  const s = bridge?.settings;
  const [storage, setStorage] = useState<string>("");
  // One fetch shared by the four key rows
  const [keys] = useState(() => s?.providerKeys() ?? Promise.resolve({} as Partial<Record<KeyProvider, string>>));
  useEffect(() => {
    s?.secretStorage()
      .then((st) => {
        if (!st) return;
        const name = { gnome_libsecret: "GNOME Keyring", kwallet: "KWallet", kwallet5: "KWallet", kwallet6: "KWallet" }[st.backend ?? ""] ?? { darwin: "macOS Keychain", win32: "Windows Data Protection" }[st.platform ?? ""] ?? "your system keychain";
        setStorage(st.encrypted ? `Keys, tokens and the database address are encrypted on this computer with ${name}.` : "No system keychain found, so keys are stored unencrypted (only your user can read the file).");
      })
      .catch(() => {});
  }, []);
  if (!s) return <p className="field__hint">Keys can be set in the desktop app.</p>;
  return (
    <div className="secrets">
      {storage && (
        <p className="field__hint secrets__note">
          <Lock /> {storage}
        </p>
      )}
      <div className="secrets__group">
        <span className="secrets__h">
          <KeyRound /> Brain keys
        </span>
        {PROVIDER_KEYS.map((k) => (
          <SecretRow
            key={k.provider}
            label={k.label}
            placeholder={k.placeholder}
            hint={k.hint}
            load={() => keys.then((all) => all[k.provider] ?? "")}
            save={async (v) => {
              s.setProviderKey(k.provider, v);
              refreshCrew();
              return { ok: true, text: v ? `${k.label} key saved. Crew members using it start fresh with the new key.` : `${k.label} key removed.` };
            }}
          />
        ))}
      </div>
      <div className="secrets__group">
        <span className="secrets__h">
          <Mic /> Voice
        </span>
        <SecretRow
          label="ElevenLabs"
          hint="Speech to text for talking to your crew instead of typing."
          load={() => s.elevenLabsKey()}
          save={async (v) => {
            s.setElevenLabsKey(v);
            return { ok: true, text: v ? "ElevenLabs key saved." : "ElevenLabs key removed." };
          }}
        />
      </div>
      <div className="secrets__group">
        <span className="secrets__h">
          <Database /> Database
        </span>
        <SecretRow
          label="MongoDB address"
          placeholder="mongodb://localhost:27017/assistant"
          hint="Keeps sub-agent tasks and team memory. Saving connects right away."
          load={() => s.mongodbUri()}
          save={async (v) => {
            const r = await s.setMongodbUri(v);
            if (r.connected) return { ok: true, text: "Connected." };
            const why = r.error ? ` (${r.error})` : "";
            return { ok: false, text: r.keptPrevious ? `Saved, but it did not answer${why}. Still using the previous database.` : `Saved, but it did not answer${why}.` };
          }}
        />
      </div>
    </div>
  );
}

const TEST_ICON: Record<ArmorTest["state"], string> = { ok: "Connected", off: "Off", invalid: "Key rejected", unreachable: "Can't reach ArmorIQ", error: "Problem" };

/** The ArmorIQ guard: key, connection test and what the policy blocks (classic Security page). */
export function ArmorPanel() {
  const s = bridge?.settings;
  const [sec, setSec] = useState<SecurityOverview | null>(null);
  const [test, setTest] = useState<ArmorTest | "busy" | null>(null);
  const load = () => s?.security().then(setSec).catch(() => {});
  useEffect(() => {
    void load();
  }, []);
  const runTest = async () => {
    if (!s || test === "busy") return;
    setTest("busy");
    setTest((await s.testArmorIQ()) ?? null);
  };
  if (!s) return <p className="field__hint">ArmorIQ can be set up in the desktop app.</p>;
  return (
    <div className="armor">
      <div className="armor__head">
        <ShieldCheck />
        <span>
          <b>ArmorIQ guard</b>
          <span className="eyebrow">{sec?.guard.active ? `On · key from ${sec.guard.keySource}` : "Off · add a key to turn it on"}</span>
        </span>
        {sec && (sec.guard.active ? <Status tone="live">On</Status> : <Status tone="waiting">Off</Status>)}
      </div>
      <p className="field__hint">
        Before a crew member uses a tool, ArmorIQ seals the actions it may take for that message and blocks anything else, such as <code>sudo</code> or <code>rm -rf</code>. If ArmorIQ cannot be reached,
        each action asks for your OK instead.
      </p>
      <SecretRow
        label="ArmorIQ API key"
        placeholder="ak_live_…"
        hint={sec?.guard.envOverride ? "The ARMORIQ_API_KEY environment variable is set and wins over this field." : "From your ArmorIQ dashboard. Stored encrypted."}
        load={() => s.armorIQKey()}
        save={async (v) => {
          await s.setArmorIQKey(v);
          await load();
          if (v) void runTest();
          return { ok: true, text: v ? "ArmorIQ key saved." : "ArmorIQ key removed. The guard is off." };
        }}
      />
      <div className="armor__test">
        <Button size="sm" label={test === "busy" ? "Testing" : "Test connection"} icon={<RefreshCw />} disabled={test === "busy"} onClick={() => void runTest()} />
        {test && test !== "busy" && (
          <span className={`cloudkey__msg ${test.state === "ok" ? "is-ok" : "is-bad"}`}>
            {TEST_ICON[test.state]}: {test.message}
          </span>
        )}
      </div>
      {sec && (
        <dl className="armor__facts">
          <dt>Always blocked</dt>
          <dd>{sec.policy.deny.length ? sec.policy.deny.map((t) => <code key={t}>{t}</code>) : "Nothing"}</dd>
          <dt>Allowed tools</dt>
          <dd>{sec.policy.allow.length ? sec.policy.allow.map((t) => <code key={t}>{t}</code>) : "All tools (no allow list)"}</dd>
          <dt>Asks first</dt>
          <dd>{sec.approvalTools.length ? sec.approvalTools.map((t) => <code key={t}>{t}</code>) : "Nothing"}</dd>
          <dt>Files</dt>
          <dd>{sec.fileAccess}</dd>
          <dt>Policy file</dt>
          <dd>
            <code>{sec.policy.path}</code>
          </dd>
        </dl>
      )}
    </div>
  );
}

export function AboutPanel() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    bridge?.settings
      .appInfo()
      .then(setInfo)
      .catch(() => {});
  }, []);
  if (!info) return null;
  const rows: [string, string][] = [
    ["App", `${info.name} ${info.version}`],
    ["Electron", `${info.electron} (Chromium ${info.chrome}, Node ${info.node})`],
    ["Platform", info.platform],
    ["Database", info.database],
    ["Settings file", info.settingsFile],
  ];
  return (
    <dl className="armor__facts">
      {rows.map(([k, v]) => (
        <div key={k} className="armor__fact">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
