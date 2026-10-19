import { useEffect, useRef, useState, type ReactNode } from "react";
import { Database, Eye, EyeOff, KeyRound, Lock, Mic, RefreshCw, ShieldCheck } from "lucide-react";
import { Button, IconButton, Status } from "../components/ui";
import { bridge, type AppInfo, type ArmorTest, type KeyProvider, type SecurityOverview } from "../lib/bridge";
import { Failed, Pending, failText, refreshCrew, useAlive, type Load } from "./settings-ui";

type Msg = { ok: boolean; text: string };

/** Enough of a saved secret to recognise it, never the whole thing. */
function mask(v: string) {
  const uri = /^([a-z][\w+.-]*:\/\/)(?:([^@/?#]*)@)?([^?#]*)/i.exec(v);
  if (uri) return `${uri[1]}${uri[2] ? "•••@" : ""}${uri[3]}${uri[0].length < v.length ? "?…" : ""}`;
  return v.length > 12 ? `${v.slice(0, 4)}…${v.slice(-4)}` : "••••••••";
}

/**
 * A saved secret shown masked, with a field to replace it and Remove.
 * `save` resolves with the message to show (stored) or throws (not stored).
 */
function SecretRow({ label, hint, placeholder, maxLength, load, save }: { label: string; hint?: ReactNode; placeholder?: string; maxLength?: number; load: () => Promise<string>; save: (v: string) => Promise<Msg> }) {
  const alive = useAlive();
  const [saved, setSaved] = useState<Load<string>>({ state: "loading" });
  const [value, setValue] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const pending = useRef(false);

  const fetchSaved = () => {
    setSaved({ state: "loading" });
    load().then(
      (v) => alive.current && setSaved({ state: "ready", data: v ? mask(v) : "" }),
      (err) => alive.current && setSaved({ state: "error", text: failText(err, `Could not read the saved ${label} value.`) }),
    );
  };
  useEffect(() => fetchSaved(), []);

  const submit = async (v: string) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMsg(null);
    try {
      const m = await save(v);
      if (!alive.current) return;
      setMsg(m);
      setSaved({ state: "ready", data: v ? mask(v) : "" });
      setValue("");
      setShown(false);
    } catch (err) {
      if (alive.current) setMsg({ ok: false, text: failText(err, "Could not save.") });
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const next = value.trim();
  const isSet = saved.state === "ready" && !!saved.data;
  const remove = () => {
    if (window.confirm(`Remove the saved ${label} value?`)) void submit("");
  };

  return (
    <div className="secret">
      <div className="secret__head">
        <b>{label}</b>
        {saved.state === "loading" ? <span className="eyebrow">Checking</span> : saved.state === "error" ? <span className="eyebrow">Unknown</span> : isSet ? <Status tone="done">Set</Status> : <span className="eyebrow">Not set</span>}
      </div>
      {saved.state === "error" && <Failed text={saved.text} onRetry={fetchSaved} />}
      {saved.state === "ready" && saved.data && (
        <div className="secret__saved">
          <code className="secret__mask" title="Saved value, masked">
            {saved.data}
          </code>
          <Button variant="ghost" size="sm" label="Remove" disabled={busy} onClick={remove} />
        </div>
      )}
      <div className="secret__row">
        <input
          type={shown ? "text" : "password"}
          value={value}
          placeholder={isSet ? "Paste a new value to replace it" : placeholder}
          aria-label={label}
          autoComplete="off"
          spellCheck={false}
          maxLength={maxLength}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && next && void submit(next)}
        />
        <IconButton label={shown ? "Hide" : "Show"} onClick={() => setShown((s) => !s)}>
          {shown ? <EyeOff /> : <Eye />}
        </IconButton>
        <Button variant="ink" size="sm" label={busy ? "Saving" : isSet ? "Replace" : "Save"} disabled={busy || !next} onClick={() => next && void submit(next)} />
      </div>
      {hint && <p className="field__hint">{hint}</p>}
      {msg && (
        <p className={`cloudkey__msg ${msg.ok ? "is-ok" : "is-bad"}`} role={msg.ok ? "status" : "alert"}>
          {msg.text}
        </p>
      )}
    </div>
  );
}

const PROVIDER_KEYS: { provider: KeyProvider; label: string; placeholder: string; hint: string }[] = [
  { provider: "gemini", label: "Gemini", placeholder: "AIza… or AQ.…", hint: "Used by crew members on Gemini. Free key from aistudio.google.com/apikey." },
  { provider: "claude", label: "Claude (Anthropic)", placeholder: "sk-ant-…", hint: "Optional. Leave empty to use your claude login." },
  { provider: "codex", label: "Codex (OpenAI)", placeholder: "sk-…", hint: "Optional. Leave empty to use your codex login." },
  { provider: "copilot", label: "Copilot (GitHub)", placeholder: "github_pat_… / ghp_…", hint: "Optional. Leave empty to use your GitHub CLI login." },
];

const KEYCHAIN_BY_BACKEND: Record<string, string> = { gnome_libsecret: "GNOME Keyring", kwallet: "KWallet", kwallet5: "KWallet", kwallet6: "KWallet" };
const KEYCHAIN_BY_PLATFORM: Record<string, string> = { darwin: "macOS Keychain", win32: "Windows Data Protection" };

function storageNote(st: { encrypted: boolean; backend?: string; platform?: string }) {
  if (!st.encrypted) return "No system keychain found, so keys are stored unencrypted (only your user can read the file).";
  const name = KEYCHAIN_BY_BACKEND[st.backend ?? ""] ?? KEYCHAIN_BY_PLATFORM[st.platform ?? ""] ?? "your system keychain";
  return `Keys, tokens and the database address are encrypted on this computer with ${name}.`;
}

/** Brain keys, voice and database: everything the classic Settings → General page had. */
export function KeysPanel() {
  const s = bridge?.settings;
  const alive = useAlive();
  const [storage, setStorage] = useState("");
  const keys = useRef<Promise<Partial<Record<KeyProvider, string>>> | null>(null);
  useEffect(() => {
    s?.secretStorage().then(
      (st) => alive.current && setStorage(st ? storageNote(st) : ""),
      (err) => alive.current && setStorage(failText(err, "Could not check how keys are stored on this computer.")),
    );
  }, []);
  if (!s) return <p className="field__hint">Keys can be set in the desktop app.</p>;

  // One fetch shared by the four key rows; a failed one is dropped so Try again refetches
  const providerKey = (provider: KeyProvider) => {
    keys.current ??= s.providerKeys().catch((err: unknown) => {
      keys.current = null;
      throw err;
    });
    return keys.current.then((all) => all[provider] ?? "");
  };

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
            maxLength={1000}
            load={() => providerKey(k.provider)}
            save={async (v) => {
              s.setProviderKey(k.provider, v);
              keys.current = null;
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
          maxLength={2000}
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

const TEST_LABEL: Record<ArmorTest["state"], string> = { ok: "Connected", off: "Off", invalid: "Key rejected", unreachable: "Can't reach ArmorIQ", error: "Problem" };

/** The ArmorIQ guard: key, connection test and what the policy blocks (classic Security page). */
export function ArmorPanel() {
  const s = bridge?.settings;
  const alive = useAlive();
  const [sec, setSec] = useState<Load<SecurityOverview>>({ state: "loading" });
  const [test, setTest] = useState<ArmorTest | "busy" | null>(null);
  const testing = useRef(false);

  const loadSec = async () => {
    if (!s) return;
    setSec((cur) => (cur.state === "ready" ? cur : { state: "loading" }));
    try {
      const data = await s.security();
      if (alive.current) setSec(data ? { state: "ready", data } : { state: "error", text: "Security details are not available in this window." });
    } catch (err) {
      if (alive.current) setSec({ state: "error", text: failText(err, "Could not load the security details.") });
    }
  };
  useEffect(() => {
    void loadSec();
  }, []);

  const runTest = async () => {
    if (!s || testing.current) return;
    testing.current = true;
    setTest("busy");
    let r: ArmorTest;
    try {
      r = (await s.testArmorIQ()) ?? { state: "error", message: "The test is not available in this window." };
    } catch (err) {
      r = { state: navigator.onLine ? "error" : "unreachable", message: failText(err, "The test did not finish.") };
    }
    testing.current = false;
    if (alive.current) setTest(r);
  };

  if (!s) return <p className="field__hint">ArmorIQ can be set up in the desktop app.</p>;
  const guard = sec.state === "ready" ? sec.data.guard : null;
  return (
    <div className="armor">
      <div className="armor__head">
        <ShieldCheck />
        <span>
          <b>ArmorIQ guard</b>
          <span className="eyebrow">{!guard ? (sec.state === "loading" ? "Checking" : "Status unknown") : guard.active ? `On · key from ${guard.keySource ?? "an unknown source"}` : "Off · add a key to turn it on"}</span>
        </span>
        {guard && (guard.active ? <Status tone="live">On</Status> : <Status tone="waiting">Off</Status>)}
      </div>
      {sec.state === "error" && <Failed text={sec.text} onRetry={() => void loadSec()} />}
      <p className="field__hint">
        Before a crew member uses a tool, ArmorIQ seals the actions it may take for that message and blocks anything else, such as <code>sudo</code> or <code>rm -rf</code>. If ArmorIQ cannot be reached,
        each action asks for your OK instead.
      </p>
      <SecretRow
        label="ArmorIQ API key"
        placeholder="ak_live_…"
        hint={guard?.envOverride ? "The ARMORIQ_API_KEY environment variable is set and wins over this field." : "From your ArmorIQ dashboard. Stored encrypted."}
        maxLength={500}
        load={() => s.armorIQKey()}
        save={async (v) => {
          if (!(await s.setArmorIQKey(v))) throw new Error("The key was not accepted. It can be at most 500 characters.");
          await loadSec();
          if (v) void runTest();
          else setTest(null);
          return { ok: true, text: v ? "ArmorIQ key saved." : "ArmorIQ key removed. The guard is off." };
        }}
      />
      <div className="armor__test">
        <Button size="sm" label={test === "busy" ? "Testing" : "Test connection"} icon={<RefreshCw />} disabled={test === "busy"} onClick={() => void runTest()} />
        {test && test !== "busy" && (
          <span className={`cloudkey__msg ${test.state === "ok" ? "is-ok" : "is-bad"}`} role="status">
            {TEST_LABEL[test.state]}: {test.message}
          </span>
        )}
      </div>
      {sec.state === "ready" && (
        <dl className="armor__facts">
          <dt>Always blocked</dt>
          <dd>{sec.data.policy.deny.length ? sec.data.policy.deny.map((t) => <code key={t}>{t}</code>) : "Nothing"}</dd>
          <dt>Allowed tools</dt>
          <dd>{sec.data.policy.allow.length ? sec.data.policy.allow.map((t) => <code key={t}>{t}</code>) : "All tools (no allow list)"}</dd>
          <dt>Asks first</dt>
          <dd>{sec.data.approvalTools.length ? sec.data.approvalTools.map((t) => <code key={t}>{t}</code>) : "Nothing"}</dd>
          <dt>Files</dt>
          <dd>{sec.data.fileAccess}</dd>
          <dt>Policy file</dt>
          <dd>
            <code>{sec.data.policy.path}</code>
          </dd>
        </dl>
      )}
    </div>
  );
}

export function AboutPanel() {
  const alive = useAlive();
  const [info, setInfo] = useState<Load<AppInfo>>({ state: "loading" });
  const load = () => {
    if (!bridge) return;
    setInfo({ state: "loading" });
    bridge.settings.appInfo().then(
      (data) => alive.current && setInfo({ state: "ready", data }),
      (err) => alive.current && setInfo({ state: "error", text: failText(err, "Could not read the app details.") }),
    );
  };
  useEffect(() => load(), []);
  if (!bridge) return null;
  if (info.state === "loading") return <Pending text="Reading app details." />;
  if (info.state === "error") return <Failed text={info.text} onRetry={load} />;
  const d = info.data;
  const rows: [string, string][] = [
    ["App", `${d.name} ${d.version}`],
    ["Electron", `${d.electron} (Chromium ${d.chrome}, Node ${d.node})`],
    ["Platform", d.platform],
    ["Database", d.database],
    ["Settings file", d.settingsFile],
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
