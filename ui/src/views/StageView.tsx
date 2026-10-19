import { useEffect, useMemo, useRef, useState } from "react";
import { crewById, type CrewId } from "../crew/roster";
import { isMini, parentOf, useMinis } from "../crew/minis";
import { ToyStage, type StageToy } from "../crew/ToyStage";
import { bridge } from "../lib/bridge";
import { cue, useCrewSounds } from "../lib/sound";
import { readAttachment } from "../desk/Desk";
import { sim, useWorld } from "../sim/store";
import { Portal } from "../stage/Portal";
import { ToyOverlay } from "../stage/ToyOverlay";
import { useStageSync } from "./sync";

const SIZE = 42;

export default function StageView() {
  useStageSync();
  const world = useWorld();
  useCrewSounds(world);
  const [area, setArea] = useState({ w: innerWidth, h: innerHeight });
  const [opening, setOpening] = useState<CrewId | null>(null);
  const hover = useRef<string | null>(null);
  const domHit = useRef(false);
  const last = useRef<boolean | null>(null);

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    const r = () => setArea({ w: innerWidth, h: innerHeight });
    addEventListener("resize", r);
    const sync = () => {
      const on = !!hover.current || domHit.current;
      if (on !== last.current) {
        last.current = on;
        bridge?.setInteractive(on);
      }
    };
    const move = (e: MouseEvent) => {
      const t = e.target as Element | null;
      domHit.current = !!t?.closest(".portal, .peek, .badge-need, .fan");
      sync();
    };
    addEventListener("mousemove", move);
    (window as Window & { __crewSync?: () => void }).__crewSync = sync;
    return () => {
      removeEventListener("resize", r);
      removeEventListener("mousemove", move);
    };
  }, []);

  const portal = { x: area.w - 18 - 28, y: area.h - 14 - 28 };
  const slotX = (i: number) => area.w - 104 - i * 70;
  const toys: StageToy[] = useMemo(
    () => world.summoned.map((id, i) => ({ key: id, id, hex: crewById(id).hex, x: slotX(i), y: area.h - 8, state: world.crew[id].state, size: SIZE, spawn: portal })),
    [world, area.w, area.h],
  );
  const minis = useMinis(world, (_id, i) => ({ x: slotX(i), y: area.h - 8 }), portal);
  const anchorOf = (id: CrewId) => ({ x: slotX(Math.max(0, world.summoned.indexOf(id))), y: area.h - SIZE * 1.6 });
  const open = (id: CrewId) => {
    cue("open", id);
    sim.dismissPeek(id);
    if (world.crew[id].state === "sleeping") sim.setState(id, "idle");
    bridge?.openDesk(id, anchorOf(id));
  };

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <ToyStage
        toys={[...toys, ...minis]}
        float
        band={160}
        maxPixelRatio={1.5}
        onHoverChange={(k) => {
          hover.current = k;
          (window as Window & { __crewSync?: () => void }).__crewSync?.();
        }}
        onToyClick={(k) => open(parentOf(k))}
        onToyDrop={(k, dt) => {
          const list = [...dt.files];
          const text = dt.getData("text/plain") || undefined;
          const id = parentOf(k);
          void Promise.all(list.slice(0, 4).map(readAttachment)).then((files) => sim.send(id, text, files.length ? files : undefined));
          open(id);
        }}
        overlay={(t) => {
          if (isMini(t.key)) return null;
          const id = t.key as CrewId;
          const live = world.crew[id];
          return <ToyOverlay crew={crewById(id)} state={live.state} peek={live.peek} small onOpen={() => open(id)} onDismissPeek={() => sim.dismissPeek(id)} />;
        }}
      />
      <div style={{ position: "absolute", right: 18, bottom: 14, width: 56, height: 56 }}>
        <Portal
          summoned={world.summoned}
          opening={opening}
          lonely={world.needsSetup && world.summoned.length === 0}
          hint={world.needsSetup && world.summoned.length === 0 ? "Something's in here." : null}
          onSummon={(id) => {
            setOpening(id);
            setTimeout(() => setOpening(null), 1200);
            sim.summon(id);
            if (world.needsSetup) setTimeout(() => bridge?.openDesk(id, anchorOf(id)), 1100);
          }}
          onDismiss={(id) => sim.dismiss(id)}
        />
      </div>
    </div>
  );
}
