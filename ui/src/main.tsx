import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/motion.css";

const view = new URLSearchParams(location.search).get("view") ?? "playground";

const views = {
  playground: lazy(() => import("./playground/Playground")),
} as const;

const View = views[view as keyof typeof views] ?? views.playground;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <View />
    </Suspense>
  </StrictMode>,
);
