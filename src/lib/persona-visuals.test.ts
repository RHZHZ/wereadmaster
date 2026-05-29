import { describe, expect, it } from "vitest";
import type { ReadingPersona, ReadingPersonaPaletteGroup } from "./types";
import { getPersonaVisual, PERSONA_VISUAL_CODES, type ReadingPersonaVisualCode } from "./persona-visuals";

const expectedBaseByCode: Record<ReadingPersonaVisualCode, ReadingPersonaPaletteGroup> = {
  INTJ: "NT",
  INTP: "NT",
  ENTJ: "NT",
  ENTP: "NT",
  INFJ: "NF",
  INFP: "NF",
  ENFJ: "NF",
  ENFP: "NF",
  ISTJ: "SJ",
  ISFJ: "SJ",
  ESTJ: "SJ",
  ESFJ: "SJ",
  ISTP: "SP",
  ISFP: "SP",
  ESTP: "SP",
  ESFP: "SP"
};

function buildPersona(code?: string, paletteGroup?: ReadingPersonaPaletteGroup): ReadingPersona {
  return {
    status: "complete",
    code,
    paletteGroup,
    basisNotice: "基于本周期阅读记录生成的阅读风格隐喻，不代表真实心理人格。",
    dimensions: [],
    evidence: []
  };
}

describe("persona visual mapping", () => {
  it("maps all 16 reading persona codes to fixed base and prop illustrations", () => {
    expect(PERSONA_VISUAL_CODES).toHaveLength(16);

    PERSONA_VISUAL_CODES.forEach((code) => {
      const visual = getPersonaVisual(buildPersona(code));
      const expectedBase = expectedBaseByCode[code];

      expect(visual.code).toBe(code);
      expect(visual.baseKey).toBe(expectedBase);
      expect(visual.assetSrc).toContain(`persona-base-${expectedBase.toLowerCase()}`);
      expect(visual.propAssetSrc).toContain(`persona-prop-${code.toLowerCase()}`);
      expect(visual.propLabel).not.toHaveLength(0);
      expect(visual.typeLabel).not.toHaveLength(0);
    });
  });

  it("falls back to the palette group when the code is unavailable", () => {
    const visual = getPersonaVisual(buildPersona(undefined, "SP"));

    expect(visual.code).toBeUndefined();
    expect(visual.baseKey).toBe("SP");
    expect(visual.assetSrc).toContain("persona-base-sp");
    expect(visual.propAssetSrc).toBeUndefined();
  });
});
