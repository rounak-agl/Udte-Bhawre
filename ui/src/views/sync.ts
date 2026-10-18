import { useEffect } from "react";
import { bridge, type BusMsg } from "../lib/bridge";
import { sim, type World } from "../sim/store";
import { keepHistory, loadHistory } from "../sim/history";
import { CREW } from "../crew/roster";

const known = (id: unknown) => CREW.some((c) => c.id === id);

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
    const live = new URLSearchParams(location.search).get("sim") !== "1";
    sim.setLive(live);
    if (live) loadHistory();
    const offHistory = live ? keepHistory() : () => {};
    const refresh = () => bridge!.overview().then((o) => sim.setBrains(o));
    void refresh();
    const offBackend = bridge.onBackend((e) => sim.backend(e));
    const offBus = bridge.on((m: BusMsg) => {
      if (m.type === "hello") push();
      if (m.type !== "action" || !known(m.id)) return;
      if (m.name === "send") sim.send(m.id, m.text, m.files);
      else if (m.name === "decide") sim.decide(m.id, m.planId, m.ok);
      else if (m.name === "summon") sim.summon(m.id);
      else if (m.name === "retry") sim.retry(m.id);
      else if (m.name === "wake") sim.dismissPeek(m.id);
      else if (m.name === "stop") sim.stop(m.id);
      else if (m.name === "refresh") void refresh();
      else if (m.name === "clear") sim.reset();
      else if (m.name === "brain") void bridge!.setProvider(m.id, m.key).then(refresh);
    });
    return () => {
      off();
      offHistory();
      offBus();
      offBackend();
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
