import { useState, type CSSProperties } from "react";
import { ArrowRight, X } from "lucide-react";
import { Button, IconButton } from "../components/ui";
import { BrainSetup } from "./BrainSetup";
import { crewById, type CrewId } from "../crew/roster";
import { CrewFace } from "../crew/CrewFace";
import "../desk/desk.css";
import "./home.css";

type Props = { crewId: CrewId; onDone: () => void; onClose: () => void; onDragStart?: (e: React.PointerEvent) => void; native?: boolean };

export function Onboarding({ crewId, onDone, onClose, onDragStart, native }: Props) {
  const c = crewById(crewId);
  const [step, setStep] = useState<"hello" | "brain" | "ready">("hello");
  return (
    <div className="desk" style={{ "--c": c.color, "--tint": c.tint } as CSSProperties}>
      <div className="desk__main">
        <header className={`desk__head ${native ? "is-native" : ""}`} onPointerDown={native ? undefined : onDragStart}>
          <span className="desk__id">
            <CrewFace id={c.id} color={c.color} size={30} mood="happy" />
            <span className="desk__names">
              <span className="desk__name">{c.name}</span>
              <span className="eyebrow">Just hatched</span>
            </span>
          </span>
          <span className="desk__tools" onPointerDown={(e) => e.stopPropagation()}>
            <IconButton label="Close" tipPos="bottom" onClick={onClose}>
              <X />
            </IconButton>
          </span>
        </header>
        <div className="desk__scroll">
          <div className="ob" key={step}>
            <ol className="ob__steps" aria-label="Setup">
              {["hello", "brain", "ready"].map((s, i) => (
                <li key={s} className={s === step ? "is-on" : ["hello", "brain", "ready"].indexOf(step) > i ? "is-done" : ""} />
              ))}
            </ol>
            {step === "hello" && (
              <>
                <h2 className="display ob__title">
                  Oh, hello.
                  <br />
                  I'm {c.name}.
                </h2>
                <p className="lede">I help with {c.domain.toLowerCase()}. I live right here on your desktop, and I always ask before I send, pay, delete or post anything.</p>
                <Button variant="ink" label="Nice to meet you" trailing={<ArrowRight />} onClick={() => setStep("brain")} />
              </>
            )}
            {step === "brain" && (
              <>
                <h2 className="display ob__title">Where should I think?</h2>
                <p className="lede">Pick one. Running on this computer is free and private. Gemini is faster on older laptops.</p>
                <BrainSetup />
                <Button variant="ink" label="Continue" trailing={<ArrowRight />} onClick={() => setStep("ready")} />
              </>
            )}
            {step === "ready" && (
              <>
                <h2 className="display ob__title">Let's try it.</h2>
                <p className="lede">Drag any text or file onto me, or onto the portal. I'll show you what I'd do before I do it.</p>
                <div className="ob__try">
                  <span className="ob__file" draggable>
                    meeting-notes.txt
                  </span>
                  <ArrowRight />
                  <CrewFace id={c.id} color={c.color} size={40} mood="happy" />
                </div>
                <Button variant="ink" label="Meet the rest of the crew" onClick={onDone} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
