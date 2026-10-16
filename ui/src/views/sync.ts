import { useEffect } from "react";
import { bridge, type BusMsg } from "../lib/bridge";
import { sim, type World } from "../sim/store";

export function useStageSync() {
  useEffect(() => {
    if (!bridge) return;
    let queued = false;
    const push = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        bridge!.post({ type: "world", world: sim.snapshot() });
      });
    };
    const off = sim.subscribe(push);
    const offBus = bridge.on((m: BusMsg) => {
      if (m.type === "hello") push();
      if (m.type !== "action") return;
      if (m.name === "send") sim.send(m.id, m.text, m.files);
      else if (m.name === "decide") sim.decide(m.id, m.planId, m.ok);
      else if (m.name === "summon") sim.summon(m.id);
      else if (m.name === "retry") sim.send(m.id);
      else if (m.name === "wake") sim.dismissPeek(m.id);
    });
    return () => {
      off();
      offBus();
    };
  }, []);
}

export function useMirrorSync() {
  useEffect(() => {
    if (!bridge) return;
    const off = bridge.on((m: BusMsg) => {
      if (m.type === "world") sim.hydrate(m.world as World);
    });
    bridge.post({ type: "hello" });
    return off;
  }, []);
}
