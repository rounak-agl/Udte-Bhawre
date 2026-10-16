import { useEffect, useMemo, useRef, useState } from "react";
import { DialRoot, useDialKit } from "dialkit";
import "dialkit/styles.css";
import { House, Monitor, Sparkles } from "lucide-react";
import { Segmented } from "../components/ui";
import { CREW, crewById, type CrewId } from "../crew/roster";
import { ToyStage, type StageToy } from "../crew/ToyStage";
import { Desk, type DeskMode } from "../desk/Desk";
import { Home } from "../home/Home";
import { Onboarding } from "../home/Onboarding";
import { sim, useWorld } from "../sim/store";
import { Portal } from "../stage/Portal";
import { ToyOverlay } from "../stage/ToyOverlay";
import { Frame } from "./Frame";
import "./playground.css";

type Scene = "desktop" | "first-run" | "home";

function useArea(ref: React.RefObject<HTMLDivElement | null>) {
  const [a, setA] = useState({ w: 1280, h: 720 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setA({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return a;
}

export default function Playground() {
  const world = useWorld();
  const [scene, setScene] = useState<Scene>("desktop");
  const [open, setOpen] = useState<CrewId | null>(null);
  const [mode, setMode] = useState<DeskMode>("popover");
  const [pinned, setPinned] = useState(false);
  const [opening, setOpening] = useState<CrewId | null>(null);
  const [onboard, setOnboard] = useState<"portal" | "hello" | "done">("portal");
  const areaRef = useRef<HTMLDivElement>(null);
  const area = useArea(areaRef);
  const pos = useRef(new Map<string, { x: number; y: number }>());

  const d = useDialKit(
    "Director",
    {
      Stage: {
        wallpaper: { type: "select", options: ["paper", "ground", "ink"], default: "paper" },
        dark: false,
        reduced: false,
        size: [48, 32, 96, 2],
        breathing: [1, 0, 2, 0.05],
        speed: [1, 0.25, 3, 0.25],
      },
      Run: {
        bo: { type: "action", label: "Bo: inbox triage" },
        pim: { type: "action", label: "Pim: rewrite" },
        tuck: { type: "action", label: "Tuck: tidy Downloads" },
        zip: { type: "action", label: "Zip: launch posts" },
        penny: { type: "action", label: "Penny: expenses" },
        oops: { type: "action", label: "Bo: Gmail fails" },
        sleep: { type: "action", label: "Everyone asleep" },
        reset: { type: "action", label: "Reset" },
      },
    },
    {
      onAction: (a) => {
        const k = a.split(".").pop() as string;
        if (k === "reset") {
          sim.reset();
          setOpen(null);
          return;
        }
        if (k === "sleep") {
          world.summoned.forEach((id) => sim.setState(id, "sleeping"));
          return;
        }
        if (k === "oops") {
          sim.summon("bo");
          sim.oops("bo");
          return;
        }
        const id = k as CrewId;
        sim.summon(id);
        sim.send(id);
      },
    },
  );

  useEffect(() => {
    document.documentElement.dataset.theme = d.Stage.dark ? "dark" : "light";
  }, [d.Stage.dark]);
  useEffect(() => sim.setSpeed(d.Stage.speed), [d.Stage.speed]);
  useEffect(() => {
    if (scene === "first-run") {
      sim.reset();
      sim.setSummoned([]);
      setOnboard("portal");
      setOpen(null);
    } else if (scene === "desktop" && world.summoned.length === 0) sim.setSummoned(["bo", "pim", "penny"]);
  }, [scene]);

  const portal = { x: area.w - 18 - 28, y: area.h - 14 - 28 };
  const slotX = (i: number) => area.w - 110 - i * 78;
  const toys: StageToy[] = useMemo(
    () =>
      world.summoned.map((id, i) => {
        const c = crewById(id);
        return { key: id, id, hex: c.hex, x: slotX(i), y: area.h - 12, state: world.crew[id].state, size: d.Stage.size, spawn: portal };
      }),
    [world, area.w, area.h, d.Stage.size],
  );

  const summon = (id: CrewId) => {
    setOpening(id);
    setTimeout(() => setOpening(null), 1200);
    sim.summon(id);
  };

  const openCrew = (id: CrewId) => {
    setOpen(id);
    sim.dismissPeek(id);
    if (world.crew[id].state === "sleeping") sim.setState(id, "idle");
  };

  const anchor = open ? (pos.current.get(open) ?? { x: slotX(Math.max(0, world.summoned.indexOf(open))), y: area.h - 12 - d.Stage.size * 1.5 }) : { x: 0, y: 0 };

  return (
    <div className={`pg ${d.Stage.wallpaper === "ink" ? "is-night" : ""}`}>
      <div className={`wall wall--${d.Stage.wallpaper}`} />
      <div className="scene-tabs">
        <Segmented<Scene>
          label="Scene"
          value={scene}
          onChange={setScene}
          options={[
            { value: "desktop", label: "Desktop", icon: <Monitor /> },
            { value: "first-run", label: "First run", icon: <Sparkles /> },
            { value: "home", label: "Home base", icon: <House /> },
          ]}
        />
      </div>

      <div className="desk-area" ref={areaRef}>
        {scene !== "home" && (
          <>
            <ToyStage
              toys={toys}
              float
              intensity={d.Stage.breathing}
              reduced={d.Stage.reduced}
              onToyClick={(k) => openCrew(k as CrewId)}
              onToyMove={(k, x, y) => pos.current.set(k, { x, y: y - d.Stage.size * 1.5 })}
              onToyDrop={(k, dt) => {
                const files = [...dt.files].map((f) => ({ name: f.name, size: `${Math.max(1, Math.round(f.size / 1000))} KB` }));
                const id = k as CrewId;
                sim.send(id, dt.getData("text/plain") || undefined, files.length ? files : undefined);
                openCrew(id);
              }}
              overlay={(t) => {
                const id = t.key as CrewId;
                const live = world.crew[id];
                return <ToyOverlay crew={crewById(id)} state={live.state} peek={open === id ? null : live.peek} onOpen={() => openCrew(id)} onDismissPeek={() => sim.dismissPeek(id)} />;
              }}
            />
            <div className="portal-slot">
              <Portal
                summoned={world.summoned}
                opening={opening}
                lonely={scene === "first-run" && onboard === "portal"}
                hint={scene === "first-run" && onboard === "portal" ? "Something's in here." : null}
                onSummon={(id) => {
                  summon(id);
                  if (scene === "first-run") {
                    setOnboard("hello");
                    setTimeout(() => setOpen(id), 900);
                  }
                }}
                onDismiss={(id) => {
                  sim.dismiss(id);
                  if (open === id) setOpen(null);
                }}
              />
            </div>
            {open && (
              <Frame key={open} mode={mode} anchor={anchor} area={area} onMode={setMode}>
                {(startDrag) =>
                  scene === "first-run" && onboard === "hello" ? (
                    <Onboarding
                      crewId={open}
                      onDone={() => {
                        setOnboard("done");
                        CREW.filter((c) => c.id !== open)
                          .slice(0, 2)
                          .forEach((c, i) => setTimeout(() => summon(c.id), 500 + i * 700));
                      }}
                      onClose={() => setOpen(null)}
                      onDragStart={startDrag}
                    />
                  ) : (
                    <Desk
                      crewId={open}
                      live={world.crew[open]}
                      mode={mode}
                      pinned={pinned}
                      onPin={() => setPinned((p) => !p)}
                      onMode={setMode}
                      onClose={() => {
                        setOpen(null);
                        setMode("popover");
                      }}
                      onSend={(t, f) => sim.send(open, t, f)}
                      onDecide={(pid, ok) => sim.decide(open, pid, ok)}
                      onPickCrew={(id) => {
                        sim.summon(id);
                        setOpen(id);
                      }}
                      onRetry={() => sim.send(open)}
                      onDragStart={startDrag}
                    />
                  )
                }
              </Frame>
            )}
          </>
        )}
        {scene === "home" && (
          <div style={{ position: "absolute", inset: "64px 40px 20px" }}>
            <div className="frame" style={{ position: "relative", width: "100%", height: "100%" }}>
              <Home
                onOpenCrew={(id) => {
                  setScene("desktop");
                  sim.summon(id);
                  setTimeout(() => openCrew(id), 300);
                }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="taskbar">
        <span className="taskbar__start">
          <i />
          <i />
          <i />
          <i />
        </span>
        {["#f2c94c", "#2f6bff", "#21a366", "#e8eaed", "#7b61ff"].map((c) => (
          <span key={c} className="taskbar__app">
            <i style={{ "--a": c } as React.CSSProperties} />
          </span>
        ))}
        <span className="taskbar__tray">
          <span>ENG</span>
          <span>16:42</span>
        </span>
      </div>
      <DialRoot position="bottom-left" />
    </div>
  );
}
