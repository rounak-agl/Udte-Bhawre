import { Home } from "../home/Home";
import { bridge } from "../lib/bridge";
import { useMirrorSync } from "./sync";

export default function HomeView() {
  useMirrorSync();
  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Home
        onOpenCrew={(id) => {
          bridge?.post({ type: "action", name: "summon", id });
          bridge?.openDesk(id);
        }}
      />
    </div>
  );
}
