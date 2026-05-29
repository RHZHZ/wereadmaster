import type { PersonaVisual } from "../lib/persona-visuals";

type PersonaIllustrationProps = {
  className?: string;
  visual: PersonaVisual;
};

export function PersonaIllustration({ className, visual }: PersonaIllustrationProps) {
  return (
    <span
      className={["persona-illustration", `is-${visual.baseKey.toLowerCase()}`, visual.code ? `is-${visual.code.toLowerCase()}` : "", className]
        .filter(Boolean)
        .join(" ")}
    >
      <img className="persona-illustration-base" src={visual.assetSrc} alt="" draggable={false} />
      {visual.propAssetSrc ? (
        <img
          className="persona-illustration-prop"
          src={visual.propAssetSrc}
          alt=""
          draggable={false}
        />
      ) : null}
    </span>
  );
}
