import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowUpRight, Eye, EyeOff, Plug, Search, X } from "lucide-react";
import { Button, Chip, IconButton, Segmented, Status } from "../components/ui";
import { CrewFace } from "../crew/CrewFace";
import { crewById, type CrewId } from "../crew/roster";
import { bridge, type Catalog, type ServerConfig, type ServerEntry, type TestResult } from "../lib/bridge";
import type { World } from "../sim/store";

type Tab = "installed" | "browse" | "custom";
const SEARCH_DELAY_MS = 400;
const SOURCE: Record<string, string> = { catalog: "Featured", registry: "Registry", custom: "Your own" };

/** Re-read the crew overview so the Crew page's "Uses" chips follow installs. */
const refreshCrew = () => bridge?.post({ type: "action", name: "refresh", id: "bo" });

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

function TestOut({ r }: { r: TestResult | "busy" | null }) {
  if (!r) return null;
  if (r === "busy") return <p className="field__hint">Starting the server. The first start downloads it and can take a minute.</p>;
  if (!r.ok) return <p className="cloudkey__msg is-bad pre">{r.error}</p>;
  const tools = r.tools ?? [];
  return (
    <div className="tools">
      <span className="cloudkey__msg is-ok">
        Works · {tools.length} {tools.length === 1 ? "tool" : "tools"}
      </span>
      {tools.length > 0 && (
        <div className="tools__list">
          {tools.slice(0, 40).map((t) => (
            <code key={t}>{t}</code>
          ))}
          {tools.length > 40 && <span className="eyebrow">+{tools.length - 40} more</span>}
        </div>
      )}
    </div>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
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

function Input({ label, value, onChange, secret, placeholder, required, hint }: { label: string; value: string; onChange: (v: string) => void; secret?: boolean; placeholder?: string; required?: boolean; hint?: React.ReactNode }) {
  const [shown, setShown] = useState(false);
  return (
    <label className="inp">
      <span className="inp__label">
        {label}
        {required && <span aria-hidden> *</span>}
      </span>
      <span className="secret__row">
        <input type={secret && !shown ? "password" : "text"} value={value} placeholder={placeholder} autoComplete="off" spellCheck={false} onChange={(e) => onChange(e.target.value)} />
        {secret && (
          <IconButton label={shown ? "Hide" : "Show"} onClick={() => setShown((s) => !s)}>
            {shown ? <EyeOff /> : <Eye />}
          </IconButton>
        )}
      </span>
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

/** Install (or update) a catalog or registry server: its fields, then a test start. */
function InstallSheet({ entry, catalog, installed, onClose, onDone }: { entry: ServerEntry; catalog: Catalog; installed: ServerConfig | null; onClose: () => void; onDone: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const prev = prefill(entry, installed);
    return Object.fromEntries((entry.fields ?? []).map((f) => [f.key, prev[f.key] ?? f.default ?? ""]));
  });
  const [trusted, setTrusted] = useState(!!entry.verified);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult | "busy" | null>(null);
  const [canForce, setCanForce] = useState(false);
  const [done, setDone] = useState(false);
  const runtime = entry.install && entry.install.type !== "http" && entry.install.runtime && catalog.runtimes[entry.install.runtime] === false ? catalog.runtimeInfo[entry.install.runtime] : null;
  const filled = (entry.fields ?? []).every((f) => !f.required || values[f.key]?.trim());
  const ready = trusted && !runtime && filled && entry.installable !== false && !busy && !done;

  const install = async (force = false) => {
    if (!bridge || (!ready && !(force && canForce))) return;
    setBusy(true);
    setCanForce(false);
    setResult(force ? null : "busy");
    const request = entry.verified ? { catalogId: entry.id, values, force } : { registryName: entry.registryName, version: entry.version, values, force };
    let r;
    try {
      r = await bridge.connectors.install(request);
    } catch (err) {
      r = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    setBusy(false);
    if (r.ok) {
      setDone(true);
      setResult(force ? { ok: true, tools: [] } : { ok: true, tools: r.tools ?? [] });
      refreshCrew();
      onDone();
    } else {
      setResult({ ok: false, error: r.error });
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
          <label className="check">
            <input type="checkbox" checked={trusted} onChange={(e) => setTrusted(e.target.checked)} /> I trust this publisher
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
      {done && <p className="field__hint">Your crew can use it now. Every tool call still goes through ArmorIQ.</p>}
      <footer className="sheet__foot">
        <Button variant="ghost" label={done ? "Done" : "Cancel"} onClick={onClose} />
        {canForce && <Button label="Save anyway" onClick={() => void install(true)} />}
        {!done && <Button variant="ink" label={busy ? "Installing" : installed ? "Update" : "Install"} disabled={!ready} onClick={() => void install()} />}
      </footer>
    </Sheet>
  );
}

// ── Your own server: paste a JSON config (Claude Desktop, Cursor, VS Code…) or fill the form ──

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const looksLikeServer = (v: unknown) => isObj(v) && (typeof v.command === "string" || typeof (v.url ?? v.serverUrl ?? v.httpUrl) === "string");

function lenientJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    /* README snippets often have trailing commas or comments */
  }
  const t = text.replace(/^\s*\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1");
  try {
    return JSON.parse(t);
  } catch {
    /* maybe copied without the outer braces */
  }
  try {
    return JSON.parse(`{${t}}`);
  } catch {
    return undefined;
  }
}

function strMap(o: unknown) {
  const out: Record<string, string> = {};
  if (isObj(o)) for (const [k, v] of Object.entries(o)) if (["string", "number", "boolean"].includes(typeof v)) out[k] = String(v);
  return out;
}

function parsePasted(text: string): { ok: true; id: string; config: ServerConfig } | { ok: false; error: string } {
  const data = lenientJson(text.trim());
  if (!isObj(data)) return { ok: false, error: "That isn't valid JSON." };
  let id = "";
  let cfg: Record<string, unknown> | null = null;
  if (looksLikeServer(data)) cfg = data;
  else {
    const map = isObj(data.mcpServers) ? data.mcpServers : isObj(data.servers) ? data.servers : isObj(data.mcp) && isObj(data.mcp.servers) ? data.mcp.servers : data;
    const first = Object.entries(map).find(([, v]) => looksLikeServer(v));
    if (first) [id, cfg] = [first[0], first[1] as Record<string, unknown>];
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
  const [paste, setPaste] = useState("");
  const [pasteMsg, setPasteMsg] = useState("");
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

  const config = (): ServerConfig =>
    kind === "hosted"
      ? { type: "http", url: url.trim(), headers: fromLines(headers, /^([^:]+):(.*)$/) }
      : {
          command: command.trim(),
          args: args.split("\n").filter((a) => a !== ""),
          env: fromLines(env, /^([^=]+)=(.*)$/),
        };
  const valid = id.trim() && (kind === "hosted" ? url.trim() : command.trim());

  const usePaste = () => {
    const r = parsePasted(paste);
    if (!r.ok) {
      setPasteMsg(r.error);
      return;
    }
    setPasteMsg("Filled in below. Check it, then Test or Save.");
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
    if (!bridge || !valid || busy) return;
    setResult("busy");
    setResult(await bridge.connectors.test({ source: "custom", ...config() }));
  };
  const save = async () => {
    if (!bridge || !valid || busy) return;
    setBusy(true);
    const r = await bridge.connectors.save({ id: id.trim(), config: config(), previousId: startId });
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: `Saved as ${r.id}. Your crew can use it now.` } : { ok: false, text: r.error ?? "Could not save." });
    if (r.ok) {
      refreshCrew();
      onSaved();
    }
  };

  return (
    <div className="custom">
      {!startId && (
        <div className="custom__paste">
          <label className="inp">
            <span className="inp__label">Paste a config</span>
            <textarea rows={5} value={paste} spellCheck={false} placeholder={'{ "mcpServers": { "name": { "command": "npx", "args": ["-y", "…"] } } }'} onChange={(e) => setPaste(e.target.value)} />
            <span className="field__hint">From a README, Claude Desktop, Cursor or VS Code. Only the first server is used.</span>
          </label>
          <Button size="sm" label="Fill in" disabled={!paste.trim()} onClick={usePaste} />
          {pasteMsg && <p className="field__hint">{pasteMsg}</p>}
        </div>
      )}
      <Input label="Name" required value={id} onChange={setId} placeholder="my-server" hint="Letters, numbers, dots, dashes and underscores." />
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
          <Input label="URL" required value={url} onChange={setUrl} placeholder="https://…/mcp" hint="Must be https (or http://localhost)." />
          <label className="inp">
            <span className="inp__label">Headers, Name: value per line</span>
            <textarea rows={2} value={headers} spellCheck={false} placeholder="Authorization: Bearer …" onChange={(e) => setHeaders(e.target.value)} />
          </label>
        </>
      )}
      <TestOut r={result} />
      {msg && <p className={`cloudkey__msg ${msg.ok ? "is-ok" : "is-bad"}`}>{msg.text}</p>}
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

function ServerCard({ entry, installed, who, onOpen, i }: { entry: ServerEntry; installed: boolean; who: CrewId[]; onOpen: () => void; i: number }) {
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
        <Button size="sm" label="Install" onClick={onOpen} />
      )}
    </div>
  );
}

export function Connections({ world }: { world: World }) {
  const [tab, setTab] = useState<Tab>("installed");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [servers, setServers] = useState<Record<string, ServerConfig>>({});
  const [sheet, setSheet] = useState<{ entry: ServerEntry; installed: ServerConfig | null } | null>(null);
  const [editing, setEditing] = useState<{ id: string; config: ServerConfig } | null>(null);
  const [tests, setTests] = useState<Record<string, TestResult | "busy">>({});
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [reg, setReg] = useState<{ status: string; list: ServerEntry[]; cursor: string | null }>({ status: "", list: [], cursor: null });
  const seq = useRef(0);

  const reload = () => bridge?.connectors.installed().then((s) => setServers(s ?? {}));
  useEffect(() => {
    if (!bridge) return;
    void reload();
    void bridge.connectors.catalog().then(setCatalog);
  }, []);

  const whoOf = (id?: string) => world.connectors.find((c) => c.id === id)?.who ?? [];
  const isInstalled = (e: ServerEntry) => Object.entries(servers).some(([id, c]) => (e.verified ? (c.catalogId ?? id) === e.id : c.registryName === e.registryName));
  const catalogEntry = (id: string, c: ServerConfig) => catalog?.entries.find((e) => e.id === (c.catalogId ?? id)) ?? null;

  const searchRegistry = async (query: string, more = false) => {
    if (!bridge) return;
    const n = ++seq.current;
    setReg((r) => ({ ...r, status: more ? "" : "Searching the registry", list: more ? r.list : [], cursor: more ? r.cursor : null }));
    const res = await bridge.connectors.search(query, more ? reg.cursor ?? "" : "");
    if (n !== seq.current) return;
    if (!res.ok) {
      setReg({ status: `The registry is not answering right now. ${res.error ?? ""}`, list: [], cursor: null });
      return;
    }
    setReg((r) => {
      const list = more ? [...r.list, ...(res.servers ?? [])] : res.servers ?? [];
      return { status: list.length ? "" : `No registry servers match "${query}".`, list, cursor: res.nextCursor ?? null };
    });
  };
  useEffect(() => {
    if (tab !== "browse") return;
    const query = q.trim();
    if (!query) {
      seq.current++;
      setReg({ status: "", list: [], cursor: null });
      return;
    }
    const t = setTimeout(() => void searchRegistry(query), SEARCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [q, tab]);

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

  const ids = Object.keys(servers).sort((a, b) => (servers[a].displayName ?? a).localeCompare(servers[b].displayName ?? b));
  const featured = (catalog?.entries ?? []).filter((e) => (cat === "All" || e.category === cat) && matches(e, q.trim()));

  const test = async (id: string) => {
    if (!bridge || tests[id] === "busy") return;
    setTests((t) => ({ ...t, [id]: "busy" }));
    const r = await bridge.connectors.test(id);
    setTests((t) => ({ ...t, [id]: r }));
  };
  const remove = async (id: string) => {
    const name = servers[id]?.displayName ?? id;
    if (!bridge || !window.confirm(`Remove ${name}? Your crew stops using its tools right away.`)) return;
    if (await bridge.connectors.uninstall(id)) {
      await reload();
      refreshCrew();
    }
  };

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
            { value: "installed", label: `Installed · ${ids.length}` },
            { value: "browse", label: "Browse" },
            { value: "custom", label: "Add your own" },
          ]}
        />
      </header>

      {tab === "installed" &&
        (ids.length === 0 ? (
          <p className="empty-note">
            Nothing installed yet.{" "}
            <button type="button" className="link-btn" onClick={() => setTab("browse")}>
              Browse servers
            </button>
          </p>
        ) : (
          <ul className="rows rows--big servers">
            {ids.map((id, i) => {
              const c = servers[id];
              const entry = catalogEntry(id, c);
              const source = c.source ?? (entry ? "catalog" : "custom");
              const fromCatalog = !!entry && source === "catalog";
              const legacy = !!entry && !c.source;
              const canEdit = !fromCatalog || legacy || (entry?.fields ?? []).length > 0;
              return (
                <li key={id} className="server rise" style={{ "--i": i } as CSSProperties}>
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
                      <code className="server__sum" title={summary(c)}>
                        {summary(c)}
                      </code>
                      {legacy && <span className="field__hint">Installed with an older setup. Update to switch to the current version.</span>}
                    </span>
                    <Who ids={whoOf(c.catalogId ?? id)} />
                    <span className="server__actions">
                      <Button size="sm" variant="ghost" label={tests[id] === "busy" ? "Testing" : "Test"} disabled={tests[id] === "busy"} onClick={() => void test(id)} />
                      {canEdit && (
                        <Button
                          size="sm"
                          variant="ghost"
                          label={legacy ? "Update" : "Edit"}
                          onClick={() => (fromCatalog && entry ? setSheet({ entry, installed: legacy ? null : c }) : setEditing({ id, config: c }))}
                        />
                      )}
                      <Button size="sm" variant="ghost" label="Remove" onClick={() => void remove(id)} />
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
              <input type="search" value={q} placeholder="Search servers: github, postgres, browser…" aria-label="Search MCP servers" spellCheck={false} onChange={(e) => setQ(e.target.value)} />
            </label>
            <div className="chips">
              {["All", ...(catalog?.categories ?? [])].map((c) => (
                <Chip key={c} selected={cat === c} onClick={() => setCat(c)}>
                  {c}
                </Chip>
              ))}
            </div>
          </div>
          <h2 className="set__h browse__h">Featured · reviewed</h2>
          {!catalog ? (
            <p className="empty-note">Loading.</p>
          ) : featured.length === 0 ? (
            <p className="empty-note">No featured servers match. Registry results are below.</p>
          ) : (
            <div className="conns">
              {featured.map((e, i) => (
                <ServerCard key={e.id} i={i} entry={e} installed={isInstalled(e)} who={whoOf(e.id)} onOpen={() => catalog && setSheet({ entry: e, installed: null })} />
              ))}
            </div>
          )}
          {cat === "All" && (
            <>
              <h2 className="set__h browse__h">From the public MCP Registry</h2>
              <p className="field__hint adv__note">Community servers, not reviewed. You see exactly what runs before installing.</p>
              {!q.trim() && reg.list.length === 0 && (
                <p className="empty-note">
                  Type above to search hundreds more servers, or{" "}
                  <button type="button" className="link-btn" onClick={() => void searchRegistry("")}>
                    browse the newest
                  </button>
                  .
                </p>
              )}
              {reg.status && <p className="empty-note">{reg.status}</p>}
              {reg.list.length > 0 && (
                <div className="conns">
                  {reg.list.map((e, i) => (
                    <ServerCard key={`${e.registryName}@${e.version}`} i={i} entry={e} installed={isInstalled(e)} who={[]} onOpen={() => setSheet({ entry: e, installed: null })} />
                  ))}
                </div>
              )}
              {reg.cursor && <Button size="sm" label="Load more" onClick={() => void searchRegistry(q.trim(), true)} />}
            </>
          )}
        </>
      )}

      {tab === "custom" && (
        <CustomForm
          key="new"
          onSaved={() => {
            void reload();
          }}
        />
      )}

      {sheet && catalog && (
        <InstallSheet
          entry={sheet.entry}
          catalog={catalog}
          installed={sheet.installed}
          onClose={() => setSheet(null)}
          onDone={() => {
            void reload();
          }}
        />
      )}
      {editing && (
        <Sheet title={`Edit ${editing.config.displayName ?? editing.id}`} onClose={() => setEditing(null)}>
          <CustomForm
            id={editing.id}
            config={editing.config}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              void reload();
              setEditing(null);
            }}
          />
        </Sheet>
      )}
    </div>
  );
}
