import { useEffect, useState } from "react";
import type { CrewId } from "../crew/roster";
import { Desk, type DeskMode } from "../desk/Desk";
import { Onboarding } from "../home/Onboarding";
import { bridge } from "../lib/bridge";
import { useWorld } from "../sim/store";
import { useMirrorSync } from "./sync";

export default function DeskView() {
  useMirrorSync();
  const world = useWorld();
  const [crew, setCrew] = useState<CrewId>((new URLSearchParams(location.search).get("crew") as CrewId) || "bo");
  const [mode, setMode] = useState<DeskMode>("popover");
  const [pinned, setPinned] = useState(true);
  const [onboard, setOnboard] = useState<boolean | null>(null);
  useEffect(() => bridge?.onDeskCrew(setCrew), []);
  useEffect(() => {
    if (onboard === null && world.providers.length) setOnboard(world.needsSetup);
  }, [world.providers.length, world.needsSetup, onboard]);
  if (onboard) {
    return (
      <div style={{ position: "fixed", inset: 0 }}>
        <Onboarding crewId={crew} native onClose={() => bridge?.closeDesk()} onDone={() => setOnboard(false)} />
      </div>
    );
  }
  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Desk
        native
        crewId={crew}
        live={world.crew[crew]}
        mode={mode}
        pinned={pinned}
        onPin={() => {
          bridge?.pinDesk(!pinned);
          setPinned(!pinned);
        }}
        onMode={(m) => {
          setMode(m);
          bridge?.deskMode(m);
        }}
        onClose={() => bridge?.closeDesk()}
        onSend={(text, files) => bridge?.post({ type: "action", name: "send", id: crew, text, files })}
        onDecide={(planId, ok) => bridge?.post({ type: "action", name: "decide", id: crew, planId, ok })}
        onPickCrew={(id) => {
          setCrew(id);
          bridge?.post({ type: "action", name: "summon", id });
        }}
        onRetry={() => bridge?.post({ type: "action", name: "retry", id: crew })}
        onStop={() => bridge?.post({ type: "action", name: "stop", id: crew })}
        brain={world.brains[crew] ?? null}
        brains={world.providers}
        onBrain={(key) => bridge?.post({ type: "action", name: "brain", id: crew, key })}
      />
    </div>
  );
}
