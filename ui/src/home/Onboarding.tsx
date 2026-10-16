import { useState, type CSSProperties } from "react";
import { ArrowRight, Cloud, HardDrive, KeyRound, X } from "lucide-react";
import { Button, IconButton, Status } from "../components/ui";
import { crewById, type CrewId } from "../crew/roster";
import { CrewFace } from "../crew/CrewFace";
import "../desk/desk.css";
import "./home.css";

type Props = { crewId: CrewId; onDone: () => void; onClose: () => void; onDragStart?: (e: React.PointerEvent) => void };

export function Onboarding({ crewId, onDone, onClose, onDragStart }: Props) {
  const c = crewById(crewId);
  const [step, setStep] = useState<"hello" | "brain" | "ready">("hello");
  const [brain, setBrain] = useState<"local" | "cloud">("local");
  return (
    <div className="desk" style={{ "--c": c.color, "--tint": c.tint } as CSSProperties}>
      <div className="desk__main">
        <header className="desk__head" onPointerDown={onDragStart}>
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
                <div className="ob__choices">
                  <button type="button" className={`ob__choice ${brain === "local" ? "is-on" : ""}`} onClick={() => setBrain("local")}>
                    <HardDrive />
                    <span className="ob__ct">
                      <b>On this computer</b>
                      <span>Free and private. Nothing leaves your machine.</span>
                    </span>
                    <Status tone="live">Ollama found</Status>
                  </button>
                  <button type="button" className={`ob__choice ${brain === "cloud" ? "is-on" : ""}`} onClick={() => setBrain("cloud")}>
                    <Cloud />
                    <span className="ob__ct">
                      <b>In the cloud</b>
                      <span>Faster on older laptops. Needs a free Gemini key.</span>
                    </span>
                    <KeyRound className="ob__k" />
                  </button>
                </div>
                <Button variant="ink" label="Use this" trailing={<ArrowRight />} onClick={() => setStep("ready")} />
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
