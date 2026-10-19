import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowUpRight, Eye, EyeOff, Plug, Search, X } from "lucide-react";
import { Button, Chip, IconButton, Segmented, Status } from "../components/ui";
import { CrewFace } from "../crew/CrewFace";
import { crewById, type CrewId } from "../crew/roster";
import { bridge, type Catalog, type SearchResult, type ServerConfig, type ServerEntry, type TestResult } from "../lib/bridge";
import type { World } from "../sim/store";
import { Failed, Pending, failText, refreshCrew, useAlive, type Load } from "./settings-ui";

type Tab = "installed" | "browse" | "custom";
const SEARCH_DELAY_MS = 400;
const SOURCE: Record<string, string> = { catalog: "Featured", registry: "Registry", custom: "Your own" };
const NO_CREW: CrewId[] = [];
const NO_SERVERS: Record<string, ServerConfig> = {};
const ID_PATTERN = /^[\w.-]{1,64}$/;

function summary(c: ServerConfig) {
  return c.type === "http" ? c.url ?? "" : [c.command, ...(c.args ?? [])].join(" ");
}

/** What will run or be contacted (shown before installing an unreviewed server). */
function describeInstall(entry: ServerEntry) {
  const i = entry.install;
  if (!i) return "";
  if (i.type === "http") return `Connects to ${i.url}`;
  const args = (i.args ?? []).flatMap((a) => (Array.isArray(a) ? a : [a]));
  return `Runs on this computer: ${[i.command, ...args].join(" ").replace(/\{[A-Za-z0-9_]+\}/g, "<value>")}`;
}

/** Recover the values entered last time from a saved config (for Edit). */
function prefill(entry: ServerEntry, config: ServerConfig | null) {
  const values: Record<string, string> = {};
  if (!config || !entry.install) return values;
  const pairs =
    entry.install.type === "http"
      ? Object.entries(entry.install.headers ?? {}).map(([k, t]) => [t, config.headers?.[k]] as const)
      : Object.entries(entry.install.env ?? {}).map(([k, t]) => [t, config.env?.[k]] as const);
  for (const [template, saved] of pairs) {
    const m = /^(.*)\{([A-Za-z0-9_]+)\}(.*)$/.exec(template || "");
    if (!m || typeof saved !== "string") continue;
    const [, before, key, after] = m;
    if (saved.startsWith(before) && saved.endsWith(after)) values[key] = saved.slice(before.length, saved.length - after.length);
  }
  return values;
}

function matches(e: ServerEntry, q: string) {
  if (!q) return true;
  const hay = `${e.name} ${e.publisher ?? ""} ${e.description ?? ""} ${e.category ?? ""}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((w) => hay.includes(w));
}

function urlProblem(raw: string) {
  const v = raw.trim();
  if (!v) return "";
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return "That is not a full URL. Start it with https://";
  }
  if (u.protocol === "https:") return "";
  if (u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) return "";
  return "Use https (plain http only works for localhost).";
}

function TestOut({ r }: { r: TestResult | "busy" | null }) {
  if (!r) return null;
  if (r === "busy") return <Pending text="Starting the server. The first start downloads it and can take a minute." />;
  if (!r.ok) return <Failed text={r.error || "The server did not start."} />;
  const tools = r.tools ?? [];
  return (
    <div className="testout">
      <span className="cloudkey__msg is-ok" role="status">
        Works · {tools.length} {tools.length === 1 ? "tool" : "tools"}
      </span>
      {tools.length > 0 && (
        <div className="testout__list">
          {tools.slice(0, 40).map((t) => (
            <code key={t}>{t}</code>
          ))}
          {tools.length > 40 && <span className="eyebrow">+{tools.length - 40} more</span>}
        </div>
      )}
    </div>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="sheet" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet__box" role="dialog" aria-modal="true" aria-label={title}>
        <header className="sheet__head">
          <h2>{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X />
          </IconButton>
        </header>
        <div className="sheet__body">{children}</div>
      </div>
    </div>
  );
}

function Input({ label, value, onChange, secret, placeholder, required, hint, error }: { label: string; value: string; onChange: (v: string) => void; secret?: boolean; placeholder?: string; required?: boolean; hint?: ReactNode; error?: string }) {
  const [shown, setShown] = useState(false);
  return (
    <label className="inp">
      <span className="inp__label">
        {label}
        {required && <span aria-hidden> *</span>}
      </span>
      <span className="secret__row">
        <input type={secret && !shown ? "password" : "text"} value={value} placeholder={placeholder} autoComplete="off" spellCheck={false} aria-invalid={!!error || undefined} onChange={(e) => onChange(e.target.value)} />
        {secret && (
          <IconButton label={shown ? "Hide" : "Show"} onClick={() => setShown((s) => !s)}>
            {shown ? <EyeOff /> : <Eye />}
          </IconButton>
        )}
      </span>
      {error ? <span className="cloudkey__msg is-bad">{error}</span> : hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

/** Install (or update) a catalog or registry server: its fields, then a test start. */
function InstallSheet({ entry, catalog, installed, onClose, onDone }: { entry: ServerEntry; catalog: Catalog | null; installed: ServerConfig | null; onClose: () => void; onDone: () => void }) {
  const alive = useAlive();
  const [values, setValues] = useState<Record<string, string>>(() => {
    const prev = prefill(entry, installed);
    return Object.fromEntries((entry.fields ?? []).map((f) => [f.key, prev[f.key] ?? f.default ?? ""]));
  });
  const [trusted, setTrusted] = useState(!!entry.verified);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult | "busy" | null>(null);
  const [canForce, setCanForce] = useState(false);
  const [done, setDone] = useState<"" | "tested" | "saved">("");
  const pending = useRef(false);
  const need = entry.install && entry.install.type !== "http" ? entry.install.runtime : undefined;
  const runtime = need && catalog?.runtimes[need] === false ? catalog.runtimeInfo[need] : null;
  const filled = (entry.fields ?? []).every((f) => !f.required || values[f.key]?.trim());
  const ready = trusted && !runtime && filled && entry.installable !== false && !busy && !done;

  const install = async (force = false) => {
    if (!bridge || pending.current || (!ready && !(force && canForce))) return;
    pending.current = true;
    setBusy(true);
    setCanForce(false);
    setResult(force ? null : "busy");
    const request = entry.verified ? { catalogId: entry.id, values, force } : { registryName: entry.registryName, version: entry.version, values, force };
    const r = await bridge.connectors.install(request).catch((err: unknown) => ({ ok: false, error: failText(err, ""), canForce: false, tools: undefined }));
    pending.current = false;
    if (r.ok) {
      refreshCrew();
      onDone();
    }
    if (!alive.current) return;
    setBusy(false);
    if (r.ok) {
      setDone(force ? "saved" : "tested");
      setResult(force ? null : { ok: true, tools: r.tools ?? [] });
    } else {
      setResult({ ok: false, error: failText(r.error, "Could not install this server.") });
      setCanForce(!!r.canForce);
    }
  };

  // Nothing to fill in or confirm: one click
  const auto = useRef(false);
  useEffect(() => {
    if (auto.current || installed || !entry.verified || runtime || (entry.fields ?? []).length) return;
    auto.current = true;
    void install();
  }, []);

  return (
    <Sheet title={`${installed ? "Update" : "Install"} ${entry.name}`} onClose={onClose}>
      <p className="sheet__by">
        {entry.publisher ? `by ${entry.publisher} · ` : ""}
        {entry.verified ? <Status tone="done">Reviewed</Status> : <Status tone="attention">Not reviewed</Status>}
      </p>
      {entry.description && <p className="lede">{entry.description}</p>}
      {entry.homepage && /^https?:\/\//i.test(entry.homepage) && (
        <a className="link-btn" href={entry.homepage} target="_blank" rel="noopener noreferrer">
          Documentation <ArrowUpRight />
        </a>
      )}
      {!entry.verified && (
        <div className="warnbox">
          <b>From the public MCP Registry. Nobody has reviewed it.</b>
          <code>{describeInstall(entry)}</code>
          <label className="warnbox__check">
            <input type="checkbox" checked={trusted} disabled={busy || !!done} onChange={(e) => setTrusted(e.target.checked)} /> I trust this publisher
          </label>
        </div>
      )}
      {runtime && (
        <div className="warnbox">
          This server needs {runtime.label} (<code>{runtime.binary}</code>), which is not installed.{" "}
          {runtime.installUrl && (
            <a href={runtime.installUrl} target="_blank" rel="noopener noreferrer">
              Install {runtime.label}
            </a>
          )}{" "}
          Then restart the app.
        </div>
      )}
      {(entry.fields ?? []).map((f) => (
        <Input
          key={f.key}
          label={f.label}
          required={f.required}
          secret={f.secret}
          placeholder={f.placeholder || (f.required ? "" : "Optional")}
          value={values[f.key] ?? ""}
          onChange={(v) => setValues((x) => ({ ...x, [f.key]: v }))}
          hint={
            (f.description || f.helpUrl) && (
              <>
                {f.description}{" "}
                {f.helpUrl && /^https:\/\//i.test(f.helpUrl) && (
                  <a href={f.helpUrl} target="_blank" rel="noopener noreferrer">
                    {f.secret ? "Get a key" : "Learn more"}
                  </a>
                )}
              </>
            )
          }
        />
      ))}
      {entry.fields?.some((f) => f.secret) && <p className="field__hint">Keys are encrypted on this computer and only sent to this server.</p>}
      <TestOut r={result} />
      {done === "tested" && <p className="field__hint">Your crew can use it now. Every tool call still goes through ArmorIQ.</p>}
      {done === "saved" && <p className="field__hint">Saved without a test start. Use Test on the Installed tab once it can start.</p>}
      <footer className="sheet__foot">
        <Button variant="ghost" label={done ? "Done" : "Cancel"} onClick={onClose} />
        {canForce && <Button label="Save anyway" disabled={busy} onClick={() => void install(true)} />}
        {!done && <Button variant="ink" label={busy ? "Installing" : installed ? "Update" : "Install"} disabled={!ready} onClick={() => void install()} />}
      </footer>
    </Sheet>
  );
}

// ── Your own server: paste a JSON config (Claude Desktop, Cursor, VS Code…) or fill the form ──

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const looksLikeServer = (v: unknown) => isObj(v) && (typeof v.command === "string" || typeof (v.url ?? v.serverUrl ?? v.httpUrl) === "string");

function lenientJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  // README snippets often have trailing commas or comments, or were copied without the outer braces
  const tidy = text.replace(/^\s*\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1");
  let first = "";
  for (const candidate of [text, tidy, `{${tidy}}`]) {
    try {
      return { ok: true, value: JSON.parse(candidate) };
    } catch (err) {
      first ||= err instanceof Error ? err.message : String(err);
    }
  }
  return { ok: false, error: first };
}

function strMap(o: unknown) {
  const out: Record<string, string> = {};
  if (isObj(o)) for (const [k, v] of Object.entries(o)) if (["string", "number", "boolean"].includes(typeof v)) out[k] = String(v);
  return out;
}

function parsePasted(text: string): { ok: true; id: string; config: ServerConfig } | { ok: false; error: string } {
  const parsed = lenientJson(text.trim());
  if (!parsed.ok) return { ok: false, error: `That isn't valid JSON. ${parsed.error}` };
  const data = parsed.value;
  if (!isObj(data)) return { ok: false, error: "Expected a JSON object, like the mcpServers block from a README." };
  let id = "";
  let cfg: Record<string, unknown> | null = null;
  if (looksLikeServer(data)) cfg = data;
  else {
    const map = isObj(data.mcpServers) ? data.mcpServers : isObj(data.servers) ? data.servers : isObj(data.mcp) && isObj(data.mcp.servers) ? data.mcp.servers : data;
    for (const [k, v] of Object.entries(map)) {
      if (looksLikeServer(v) && isObj(v)) {
        [id, cfg] = [k, v];
        break;
      }
    }
  }
  if (!cfg) return { ok: false, error: 'No MCP server found. Expected a "command" or a "url".' };
  const url = cfg.url ?? cfg.serverUrl ?? cfg.httpUrl;
  const config: ServerConfig =
    typeof url === "string" && typeof cfg.command !== "string"
      ? { type: "http", url: url.trim(), headers: strMap(cfg.headers) }
      : { command: String(cfg.command).trim(), args: Array.isArray(cfg.args) ? cfg.args.filter((a) => ["string", "number", "boolean"].includes(typeof a)).map(String) : [], env: strMap(cfg.env) };
  return { ok: true, id: id.replace(/[^\w.-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 64), config };
}

const toLines = (m?: Record<string, string>, sep = "=") =>
  Object.entries(m ?? {})
    .map(([k, v]) => `${k}${sep}${v}`)
    .join("\n");

function fromLines(text: string, sep: RegExp) {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = sep.exec(line.trim());
    if (m) out[m[1].trim()] = m[2].trim();
  }
  return out;
}

function CustomForm({ id: startId, config: start, onSaved, onCancel }: { id?: string; config?: ServerConfig; onSaved: () => void; onCancel?: () => void }) {
  const alive = useAlive();
  const [paste, setPaste] = useState("");
  const [pasteMsg, setPasteMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [id, setId] = useState(startId ?? "");
  const [kind, setKind] = useState<"local" | "hosted">(start?.type === "http" ? "hosted" : "local");
  const [command, setCommand] = useState(start?.command ?? "");
  const [args, setArgs] = useState((start?.args ?? []).join("\n"));
  const [env, setEnv] = useState(toLines(start?.env));
  const [url, setUrl] = useState(start?.url ?? "");
  const [headers, setHeaders] = useState(toLines(start?.headers, ": "));
  const [result, setResult] = useState<TestResult | "busy" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const testing = useRef(false);
  const saving = useRef(false);

  const config = (): ServerConfig =>
    kind === "hosted"
      ? { type: "http", url: url.trim(), headers: fromLines(headers, /^([^:]+):(.*)$/) }
      : {
          command: command.trim(),
          args: args.split("\n").filter((a) => a.trim() !== ""),
          env: fromLines(env, /^([^=]+)=(.*)$/),
        };
  const idError = id.trim() && !ID_PATTERN.test(id.trim()) ? "Use only letters, numbers, dots, dashes and underscores (64 at most)." : "";
  const urlError = kind === "hosted" ? urlProblem(url) : "";
  const valid = !!id.trim() && !idError && (kind === "hosted" ? !!url.trim() && !urlError : !!command.trim());

  const usePaste = () => {
    const r = parsePasted(paste);
    if (!r.ok) {
      setPasteMsg({ ok: false, text: r.error });
      return;
    }
    setPasteMsg({ ok: true, text: "Filled in below. Check it, then Test or Save." });
    if (r.id && !id) setId(r.id);
    if (r.config.type === "http") {
      setKind("hosted");
      setUrl(r.config.url ?? "");
      setHeaders(toLines(r.config.headers, ": "));
    } else {
      setKind("local");
      setCommand(r.config.command ?? "");
      setArgs((r.config.args ?? []).join("\n"));
      setEnv(toLines(r.config.env));
    }
  };
  const test = async () => {
    if (!bridge || !valid || testing.current) return;
    testing.current = true;
    setResult("busy");
    const r = await bridge.connectors.test({ source: "custom", ...config() }).catch((err: unknown): TestResult => ({ ok: false, error: failText(err, "The test did not finish.") }));
    testing.current = false;
    if (alive.current) setResult(r);
  };
  const save = async () => {
    if (!bridge || !valid || saving.current) return;
    saving.current = true;
    setBusy(true);
    setMsg(null);
    const r = await bridge.connectors.save({ id: id.trim(), config: config(), previousId: startId }).catch((err: unknown) => ({ ok: false, id: undefined, error: failText(err, "") }));
    saving.current = false;
    if (r.ok) refreshCrew();
    if (alive.current) {
      setBusy(false);
      setMsg(r.ok ? { ok: true, text: `Saved as ${r.id}. Your crew can use it now.` } : { ok: false, text: failText(r.error, "Could not save.") });
    }
    if (r.ok) onSaved();
  };

  return (
    <div className="custom">
      {!startId && (
        <div className="custom__paste">
          <label className="inp">
            <span className="inp__label">Paste a config</span>
            <textarea
              rows={5}
              value={paste}
              spellCheck={false}
              aria-invalid={pasteMsg?.ok === false || undefined}
              placeholder={'{ "mcpServers": { "name": { "command": "npx", "args": ["-y", "…"] } } }'}
              onChange={(e) => {
                setPaste(e.target.value);
                setPasteMsg(null);
              }}
            />
            <span className="field__hint">From a README, Claude Desktop, Cursor or VS Code. Only the first server is used.</span>
          </label>
          <Button size="sm" label="Fill in" disabled={!paste.trim()} onClick={() => paste.trim() && usePaste()} />
          {pasteMsg && (
            <p className={`cloudkey__msg ${pasteMsg.ok ? "is-ok" : "is-bad"}`} role={pasteMsg.ok ? "status" : "alert"}>
              {pasteMsg.text}
            </p>
          )}
        </div>
      )}
      <Input label="Name" required value={id} onChange={setId} placeholder="my-server" hint="Letters, numbers, dots, dashes and underscores." error={idError} />
      <Segmented
        label="Kind"
        value={kind}
        onChange={setKind}
        options={[
          { value: "local", label: "Runs on this computer" },
          { value: "hosted", label: "Hosted (URL)" },
        ]}
      />
      {kind === "local" ? (
        <>
          <Input label="Command" required value={command} onChange={setCommand} placeholder="npx" />
          <label className="inp">
            <span className="inp__label">Arguments, one per line</span>
            <textarea rows={3} value={args} spellCheck={false} placeholder={"-y\n@modelcontextprotocol/server-filesystem"} onChange={(e) => setArgs(e.target.value)} />
          </label>
          <label className="inp">
            <span className="inp__label">Environment, NAME=value per line</span>
            <textarea rows={2} value={env} spellCheck={false} placeholder="API_KEY=…" onChange={(e) => setEnv(e.target.value)} />
          </label>
        </>
      ) : (
        <>
          <Input label="URL" required value={url} onChange={setUrl} placeholder="https://…/mcp" hint="Must be https (or http://localhost)." error={urlError} />
          <label className="inp">
            <span className="inp__label">Headers, Name: value per line</span>
            <textarea rows={2} value={headers} spellCheck={false} placeholder="Authorization: Bearer …" onChange={(e) => setHeaders(e.target.value)} />
          </label>
        </>
      )}
      <TestOut r={result} />
      {msg && (
        <p className={`cloudkey__msg ${msg.ok ? "is-ok" : "is-bad"}`} role={msg.ok ? "status" : "alert"}>
          {msg.text}
        </p>
      )}
      <footer className="sheet__foot">
        {onCancel && <Button variant="ghost" label="Cancel" onClick={onCancel} />}
        <Button label={result === "busy" ? "Testing" : "Test"} disabled={!valid || result === "busy"} onClick={() => void test()} />
        <Button variant="ink" label={busy ? "Saving" : "Save"} disabled={!valid || busy} onClick={() => void save()} />
      </footer>
    </div>
  );
}

function Who({ ids }: { ids: CrewId[] }) {
  if (!ids.length) return null;
  return (
    <span className="conn__who">
      {ids.map((w) => {
        const c = crewById(w);
        return <CrewFace key={w} id={c.id} color={c.color} size={18} />;
      })}
    </span>
  );
}

const ServerCard = memo(function ServerCard({ entry, installed, who, onOpen, i }: { entry: ServerEntry; installed: boolean; who: CrewId[]; onOpen: (entry: ServerEntry) => void; i: number }) {
  return (
    <div className={`conn grid-cell rise ${installed ? "is-on" : ""}`} style={{ "--i": Math.min(i, 12) } as CSSProperties}>
      <span className="conn__top">
        <span className="conn__ic conn__emoji" aria-hidden>
          {entry.icon || <Plug />}
        </span>
        {!entry.verified && <span className="eyebrow">Not reviewed</span>}
      </span>
      <span className="conn__name">{entry.name}</span>
      {entry.description && <span className="conn__desc">{entry.description}</span>}
      <Who ids={who} />
      {entry.installable === false ? (
        <span className="eyebrow" title={entry.reason}>
          Can't install here
        </span>
      ) : installed ? (
        <Status tone="done">Installed</Status>
      ) : (
        <Button size="sm" label="Install" onClick={() => onOpen(entry)} />
      )}
    </div>
  );
});

type Reg = { state: "idle" | "loading" | "more" | "error" | "done"; query: string; list: ServerEntry[]; cursor: string | null; error: string };
const REG_IDLE: Reg = { state: "idle", query: "", list: [], cursor: null, error: "" };

export function Connections({ world }: { world: World }) {
  const alive = useAlive();
  const [tab, setTab] = useState<Tab>("installed");
  const [catalog, setCatalog] = useState<Load<Catalog>>({ state: "loading" });
  const [servers, setServers] = useState<Load<Record<string, ServerConfig>>>({ state: "loading" });
  const [sheet, setSheet] = useState<{ entry: ServerEntry; installed: ServerConfig | null } | null>(null);
  const [editing, setEditing] = useState<{ id: string; config: ServerConfig } | null>(null);
  const [tests, setTests] = useState<Record<string, TestResult | "busy">>({});
  const [removing, setRemoving] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [reg, setReg] = useState<Reg>(REG_IDLE);
  const seq = useRef(0);
  const busyRows = useRef(new Set<string>());

  const reload = useCallback(() => {
    bridge?.connectors.installed().then(
      (s) => alive.current && setServers({ state: "ready", data: s ?? {} }),
      (err) => alive.current && setServers({ state: "error", text: failText(err, "Could not read your installed servers.") }),
    );
  }, [alive]);
  const loadCatalog = useCallback(() => {
    if (!bridge) return;
    setCatalog({ state: "loading" });
    bridge.connectors.catalog().then(
      (c) => alive.current && setCatalog(c ? { state: "ready", data: c } : { state: "error", text: "The featured list is not available in this window." }),
      (err) => alive.current && setCatalog({ state: "error", text: failText(err, "Could not load the featured list.") }),
    );
  }, [alive]);
  useEffect(() => {
    reload();
    loadCatalog();
  }, [reload, loadCatalog]);

  const installed = servers.state === "ready" ? servers.data : NO_SERVERS;
  const cat_ = catalog.state === "ready" ? catalog.data : null;
  const query = q.trim();
  const regOpen = tab === "browse" && cat === "All";

  const ids = useMemo(() => Object.keys(installed).sort((a, b) => (installed[a].displayName ?? a).localeCompare(installed[b].displayName ?? b)), [installed]);
  const installedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const [id, c] of Object.entries(installed)) {
      keys.add(`catalog:${c.catalogId ?? id}`);
      if (c.registryName) keys.add(`registry:${c.registryName}`);
    }
    return keys;
  }, [installed]);
  const whoMap = useMemo(() => new Map(world.connectors.map((c) => [c.id, c.who])), [world.connectors]);
  const featured = useMemo(() => (cat_?.entries ?? []).filter((e) => (cat === "All" || e.category === cat) && matches(e, query)), [cat_, cat, query]);
  const openEntry = useCallback((entry: ServerEntry) => setSheet({ entry, installed: null }), []);

  const whoOf = (id?: string) => (id && whoMap.get(id)) || NO_CREW;
  const isInstalled = (e: ServerEntry) => installedKeys.has(e.verified ? `catalog:${e.id}` : `registry:${e.registryName}`);
  const catalogEntry = (id: string, c: ServerConfig) => cat_?.entries.find((e) => e.id === (c.catalogId ?? id)) ?? null;

  const searchRegistry = async (text: string, cursor = "") => {
    if (!bridge) return;
    const n = ++seq.current;
    setReg((r) => (cursor ? { ...r, state: "more", error: "" } : { state: "loading", query: text, list: [], cursor: null, error: "" }));
    const res: SearchResult = await bridge.connectors.search(text, cursor).catch((err: unknown) => ({ ok: false, error: failText(err, "") }));
    if (!alive.current || n !== seq.current) return;
    if (!res.ok) {
      const error = failText(res.error, "The registry is not answering right now.");
      setReg((r) => ({ ...r, state: "error", error }));
      return;
    }
    setReg((r) => ({ state: "done", query: text, list: cursor ? [...r.list, ...(res.servers ?? [])] : res.servers ?? [], cursor: res.nextCursor ?? null, error: "" }));
  };
  useEffect(() => {
    if (!regOpen) return;
    if (!query) {
      seq.current++;
      setReg(REG_IDLE);
      return;
    }
    if (reg.query === query && reg.state !== "error" && reg.state !== "idle") return;
    const t = setTimeout(() => void searchRegistry(query), SEARCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [query, regOpen]);

  if (!bridge) {
    return (
      <div className="page">
        <header className="page__head">
          <h1 className="page__title">Connections</h1>
        </header>
        <p className="empty-note">Connections can be managed in the desktop app.</p>
      </div>
    );
  }

  const test = async (id: string) => {
    if (!bridge || busyRows.current.has(id)) return;
    busyRows.current.add(id);
    setTests((t) => ({ ...t, [id]: "busy" }));
    const r = await bridge.connectors.test(id).catch((err: unknown): TestResult => ({ ok: false, error: failText(err, "The test did not finish.") }));
    busyRows.current.delete(id);
    if (alive.current) setTests((t) => ({ ...t, [id]: r }));
  };
  const remove = async (id: string) => {
    const name = installed[id]?.displayName ?? id;
    if (!bridge || removing || busyRows.current.has(id) || !window.confirm(`Remove ${name}? Your crew stops using its tools right away.`)) return;
    setRemoving(id);
    const r = await bridge.connectors.uninstall(id).then(
      (ok) => (ok ? "" : `Could not remove ${name}. The list has been refreshed.`),
      (err: unknown) => failText(err, `Could not remove ${name}.`),
    );
    if (!r) refreshCrew();
    reload();
    if (!alive.current) return;
    setRemoving(null);
    setTests((t) => {
      const next = { ...t };
      if (r) next[id] = { ok: false, error: r };
      else delete next[id];
      return next;
    });
  };

  const regRetry = () => void searchRegistry(reg.query, reg.list.length ? reg.cursor ?? "" : "");

  return (
    <div className="page">
      <header className="page__head">
        <h1 className="page__title">Connections</h1>
        <p className="lede">The apps and MCP servers your crew may use. Every tool call goes through ArmorIQ, and anything that sends, pays, deletes or posts asks you first.</p>
        <Segmented
          label="Show"
          value={tab}
          onChange={setTab}
          options={[
            { value: "installed", label: servers.state === "ready" ? `Installed · ${ids.length}` : "Installed" },
            { value: "browse", label: "Browse" },
            { value: "custom", label: "Add your own" },
          ]}
        />
      </header>

      {tab === "installed" &&
        (servers.state === "loading" ? (
          <Pending text="Reading your servers." />
        ) : servers.state === "error" ? (
          <Failed
            text={servers.text}
            onRetry={() => {
              setServers({ state: "loading" });
              reload();
            }}
          />
        ) : ids.length === 0 ? (
          <p className="empty-note">
            Nothing installed yet.{" "}
            <button type="button" className="link-btn" onClick={() => setTab("browse")}>
              Browse servers
            </button>
          </p>
        ) : (
          <ul className="rows rows--big servers">
            {ids.map((id, i) => {
              const c = installed[id];
              const entry = catalogEntry(id, c);
              const source = c.source ?? (entry ? "catalog" : "custom");
              const fromCatalog = !!entry && source === "catalog";
              const legacy = !!entry && !c.source;
              const canEdit = !fromCatalog || legacy || (entry?.fields ?? []).length > 0;
              const sum = summary(c);
              return (
                <li key={id} className="server rise" style={{ "--i": Math.min(i, 12) } as CSSProperties}>
                  <div className="server__main">
                    <span className="server__icon" aria-hidden>
                      {entry?.icon || <Plug />}
                    </span>
                    <span className="server__text">
                      <span className="server__name">
                        {c.displayName ?? entry?.name ?? id}
                        <span className="eyebrow">
                          {SOURCE[source] ?? "Your own"} · {c.type === "http" ? "Hosted" : "Local"}
                        </span>
                      </span>
                      <code className="server__sum" title={sum}>
                        {sum}
                      </code>
                      {legacy && <span className="field__hint">Installed with an older setup. Update to switch to the current version.</span>}
                    </span>
                    <Who ids={whoOf(c.catalogId ?? id)} />
                    <span className="server__actions">
                      <Button size="sm" variant="ghost" label={tests[id] === "busy" ? "Testing" : "Test"} disabled={tests[id] === "busy" || removing === id} onClick={() => void test(id)} />
                      {canEdit && (
                        <Button
                          size="sm"
                          variant="ghost"
                          label={legacy ? "Update" : "Edit"}
                          disabled={removing === id}
                          onClick={() => (fromCatalog && entry ? setSheet({ entry, installed: legacy ? null : c }) : setEditing({ id, config: c }))}
                        />
                      )}
                      <Button size="sm" variant="ghost" label={removing === id ? "Removing" : "Remove"} disabled={!!removing || tests[id] === "busy"} onClick={() => void remove(id)} />
                    </span>
                  </div>
                  <TestOut r={tests[id] ?? null} />
                </li>
              );
            })}
          </ul>
        ))}

      {tab === "browse" && (
        <>
          <div className="browse__bar">
            <label className="browse__search">
              <Search />
              <input type="search" value={q} placeholder="Search servers: github, postgres, browser…" aria-label="Search MCP servers" spellCheck={false} maxLength={200} onChange={(e) => setQ(e.target.value)} />
            </label>
            <div className="chips">
              {["All", ...(cat_?.categories ?? [])].map((c) => (
                <Chip key={c} selected={cat === c} onClick={() => setCat(c)}>
                  {c}
                </Chip>
              ))}
            </div>
          </div>
          <h2 className="set__h browse__h">Featured · reviewed</h2>
          {catalog.state === "loading" ? (
            <Pending text="Loading featured servers." />
          ) : catalog.state === "error" ? (
            <Failed text={catalog.text} onRetry={loadCatalog} />
          ) : featured.length === 0 ? (
            <p className="empty-note">{query || cat !== "All" ? `No featured servers match.${cat === "All" ? " Registry results are below." : ""}` : "No featured servers yet."}</p>
          ) : (
            <div className="conns">
              {featured.map((e, i) => (
                <ServerCard key={e.id ?? e.name} i={i} entry={e} installed={isInstalled(e)} who={whoOf(e.id)} onOpen={openEntry} />
              ))}
            </div>
          )}
          {cat === "All" && (
            <>
              <h2 className="set__h browse__h">From the public MCP Registry</h2>
              <p className="field__hint adv__note">Community servers, not reviewed. You see exactly what runs before installing.</p>
              {reg.state === "idle" && !query && (
                <p className="empty-note">
                  Type above to search hundreds more servers, or{" "}
                  <button type="button" className="link-btn" onClick={() => void searchRegistry("")}>
                    browse the newest
                  </button>
                  .
                </p>
              )}
              {reg.state === "loading" && <Pending text="Searching the registry." />}
              {reg.state === "done" && reg.list.length === 0 && <p className="empty-note">{reg.query ? `No registry servers match "${reg.query}".` : "The registry returned no servers."}</p>}
              {reg.list.length > 0 && (
                <div className="conns">
                  {reg.list.map((e, i) => (
                    <ServerCard key={`${e.registryName}@${e.version}`} i={i} entry={e} installed={isInstalled(e)} who={NO_CREW} onOpen={openEntry} />
                  ))}
                </div>
              )}
              {reg.state === "error" && <Failed text={reg.error} onRetry={regRetry} />}
              {reg.state === "more" && <Pending text="Loading more." />}
              {reg.state === "done" && reg.cursor && <Button size="sm" label="Load more" onClick={() => reg.cursor && void searchRegistry(reg.query, reg.cursor)} />}
            </>
          )}
        </>
      )}

      {tab === "custom" && <CustomForm key="new" onSaved={reload} />}

      {sheet && <InstallSheet entry={sheet.entry} catalog={cat_} installed={sheet.installed} onClose={() => setSheet(null)} onDone={reload} />}
      {editing && (
        <Sheet title={`Edit ${editing.config.displayName ?? editing.id}`} onClose={() => setEditing(null)}>
          <CustomForm
            id={editing.id}
            config={editing.config}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              reload();
              setEditing(null);
            }}
          />
        </Sheet>
      )}
    </div>
  );
}
