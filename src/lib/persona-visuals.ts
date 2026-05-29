import type {
  ReadingPersona,
  ReadingPersonaAccentTone,
  ReadingPersonaPaletteGroup
} from "./types";
import personaBaseNf from "../assets/personas/base/persona-base-nf.png";
import personaBaseNt from "../assets/personas/base/persona-base-nt.png";
import personaBaseSj from "../assets/personas/base/persona-base-sj.png";
import personaBaseSp from "../assets/personas/base/persona-base-sp.png";
import personaPropEnfj from "../assets/personas/props/persona-prop-enfj.png";
import personaPropEnfp from "../assets/personas/props/persona-prop-enfp.png";
import personaPropEntj from "../assets/personas/props/persona-prop-entj.png";
import personaPropEntp from "../assets/personas/props/persona-prop-entp.png";
import personaPropEsfj from "../assets/personas/props/persona-prop-esfj.png";
import personaPropEsfp from "../assets/personas/props/persona-prop-esfp.png";
import personaPropEstj from "../assets/personas/props/persona-prop-estj.png";
import personaPropEstp from "../assets/personas/props/persona-prop-estp.png";
import personaPropInfj from "../assets/personas/props/persona-prop-infj.png";
import personaPropInfp from "../assets/personas/props/persona-prop-infp.png";
import personaPropIntj from "../assets/personas/props/persona-prop-intj.png";
import personaPropIntp from "../assets/personas/props/persona-prop-intp.png";
import personaPropIsfj from "../assets/personas/props/persona-prop-isfj.png";
import personaPropIsfp from "../assets/personas/props/persona-prop-isfp.png";
import personaPropIstj from "../assets/personas/props/persona-prop-istj.png";
import personaPropIstp from "../assets/personas/props/persona-prop-istp.png";

export type ReadingPersonaVisualCode =
  | "INTJ"
  | "INTP"
  | "ENTJ"
  | "ENTP"
  | "INFJ"
  | "INFP"
  | "ENFJ"
  | "ENFP"
  | "ISTJ"
  | "ISFJ"
  | "ESTJ"
  | "ESFJ"
  | "ISTP"
  | "ISFP"
  | "ESTP"
  | "ESFP";

export type PersonaVisual = {
  ariaLabel: string;
  assetSrc: string;
  baseKey: ReadingPersonaPaletteGroup;
  baseLabel: string;
  code?: ReadingPersonaVisualCode;
  propAssetSrc?: string;
  propLabel: string;
  shape: "archive" | "map" | "tool" | "spark";
  tone: ReadingPersonaAccentTone;
  typeLabel: string;
};

export type PersonaVisualPalette = {
  accent: string;
  accentSoft: string;
  accentMid: string;
  accentDeep: string;
  surface: string;
};

type PersonaVisualBase = Pick<PersonaVisual, "assetSrc" | "baseKey" | "baseLabel" | "propLabel" | "shape" | "tone" | "typeLabel"> & {
  ariaBase: string;
};

type PersonaVisualPatch = Pick<PersonaVisual, "propAssetSrc" | "propLabel" | "shape" | "typeLabel"> & {
  paletteGroup: ReadingPersonaPaletteGroup;
};

export const PERSONA_VISUAL_CODES: ReadingPersonaVisualCode[] = [
  "INTJ",
  "INTP",
  "ENTJ",
  "ENTP",
  "INFJ",
  "INFP",
  "ENFJ",
  "ENFP",
  "ISTJ",
  "ISFJ",
  "ESTJ",
  "ESFJ",
  "ISTP",
  "ISFP",
  "ESTP",
  "ESFP"
];

const paletteFallbacks: Record<ReadingPersonaPaletteGroup, PersonaVisualBase> = {
  NT: {
    ariaBase: "知识建筑师画像，带有结构图纸和冷静蓝绿背景",
    assetSrc: personaBaseNt,
    baseKey: "NT",
    baseLabel: "知识建筑师",
    propLabel: "结构图纸",
    shape: "archive",
    tone: "bluegreen",
    typeLabel: "分析型阅读"
  },
  NF: {
    ariaBase: "历史共情者画像，带有档案地图和玫瑰色背景",
    assetSrc: personaBaseNf,
    baseKey: "NF",
    baseLabel: "历史共情者",
    propLabel: "档案地图",
    shape: "map",
    tone: "rose",
    typeLabel: "共情型阅读"
  },
  SJ: {
    ariaBase: "秩序型读者画像，带有笔记索引和松绿色背景",
    assetSrc: personaBaseSj,
    baseKey: "SJ",
    baseLabel: "秩序型读者",
    propLabel: "笔记索引",
    shape: "archive",
    tone: "moss",
    typeLabel: "秩序型阅读"
  },
  SP: {
    ariaBase: "行动派读者画像，带有工具箱和琥珀色背景",
    assetSrc: personaBaseSp,
    baseKey: "SP",
    baseLabel: "行动派读者",
    propLabel: "工具箱",
    shape: "tool",
    tone: "amber",
    typeLabel: "实践型阅读"
  }
};

const codeVisuals: Record<ReadingPersonaVisualCode, PersonaVisualPatch> = {
  INTJ: { paletteGroup: "NT", propAssetSrc: personaPropIntj, propLabel: "结构图纸", shape: "archive", typeLabel: "结构规划型" },
  INTP: { paletteGroup: "NT", propAssetSrc: personaPropIntp, propLabel: "概念碎片", shape: "spark", typeLabel: "概念探索型" },
  ENTJ: { paletteGroup: "NT", propAssetSrc: personaPropEntj, propLabel: "路线图", shape: "map", typeLabel: "路线推进型" },
  ENTP: { paletteGroup: "NT", propAssetSrc: personaPropEntp, propLabel: "观点卡片", shape: "spark", typeLabel: "观点碰撞型" },
  INFJ: { paletteGroup: "NF", propAssetSrc: personaPropInfj, propLabel: "档案地图", shape: "map", typeLabel: "历史共情型" },
  INFP: { paletteGroup: "NF", propAssetSrc: personaPropInfp, propLabel: "故事书页", shape: "archive", typeLabel: "故事漫游型" },
  ENFJ: { paletteGroup: "NF", propAssetSrc: personaPropEnfj, propLabel: "连接线索", shape: "spark", typeLabel: "关系理解型" },
  ENFP: { paletteGroup: "NF", propAssetSrc: personaPropEnfp, propLabel: "灵感便签", shape: "spark", typeLabel: "灵感发散型" },
  ISTJ: { paletteGroup: "SJ", propAssetSrc: personaPropIstj, propLabel: "笔记索引", shape: "archive", typeLabel: "笔记秩序型" },
  ISFJ: { paletteGroup: "SJ", propAssetSrc: personaPropIsfj, propLabel: "温故书签", shape: "archive", typeLabel: "温故积累型" },
  ESTJ: { paletteGroup: "SJ", propAssetSrc: personaPropEstj, propLabel: "执行清单", shape: "tool", typeLabel: "清单推进型" },
  ESFJ: { paletteGroup: "SJ", propAssetSrc: personaPropEsfj, propLabel: "生活札记", shape: "map", typeLabel: "经验整理型" },
  ISTP: { paletteGroup: "SP", propAssetSrc: personaPropIstp, propLabel: "工具箱", shape: "tool", typeLabel: "工具拆解型" },
  ISFP: { paletteGroup: "SP", propAssetSrc: personaPropIsfp, propLabel: "审美拼贴", shape: "map", typeLabel: "体验拼贴型" },
  ESTP: { paletteGroup: "SP", propAssetSrc: personaPropEstp, propLabel: "行动标记", shape: "tool", typeLabel: "现场行动型" },
  ESFP: { paletteGroup: "SP", propAssetSrc: personaPropEsfp, propLabel: "体验卡片", shape: "spark", typeLabel: "体验捕捉型" }
};

const tonePalettes: Record<ReadingPersonaAccentTone, PersonaVisualPalette> = {
  bluegreen: {
    accent: "#217d83",
    accentSoft: "rgba(33, 125, 131, 0.10)",
    accentMid: "rgba(33, 125, 131, 0.18)",
    accentDeep: "#184d55",
    surface: "#eff7f4"
  },
  rose: {
    accent: "#ad627e",
    accentSoft: "rgba(173, 98, 126, 0.10)",
    accentMid: "rgba(173, 98, 126, 0.20)",
    accentDeep: "#71364e",
    surface: "#f8f0f2"
  },
  moss: {
    accent: "#527b54",
    accentSoft: "rgba(82, 123, 84, 0.10)",
    accentMid: "rgba(82, 123, 84, 0.20)",
    accentDeep: "#36533b",
    surface: "#f0f5ef"
  },
  amber: {
    accent: "#a4752f",
    accentSoft: "rgba(202, 163, 93, 0.10)",
    accentMid: "rgba(202, 163, 93, 0.24)",
    accentDeep: "#6b4a1d",
    surface: "#f8f3ea"
  }
};

export function getPersonaVisual(persona: ReadingPersona): PersonaVisual {
  const code = normalizePersonaVisualCode(persona.code);
  const codePatch = code ? codeVisuals[code] : undefined;
  const paletteGroup = codePatch?.paletteGroup ?? persona.paletteGroup ?? "NT";
  const fallback = paletteFallbacks[paletteGroup];
  const label = persona.label ?? fallback.baseLabel;
  const propLabel = codePatch?.propLabel ?? fallback.propLabel;

  return {
    ariaLabel: `${persona.displayTitle ?? label}画像，${propLabel}作为阅读风格隐喻`,
    assetSrc: fallback.assetSrc,
    baseKey: fallback.baseKey,
    baseLabel: fallback.baseLabel,
    code,
    propAssetSrc: codePatch?.propAssetSrc,
    propLabel,
    shape: codePatch?.shape ?? fallback.shape,
    tone: persona.accentTone ?? fallback.tone,
    typeLabel: codePatch?.typeLabel ?? fallback.typeLabel
  };
}

export function getPersonaVisualPalette(
  tone: ReadingPersonaAccentTone = "bluegreen"
): PersonaVisualPalette {
  return tonePalettes[tone] ?? tonePalettes.bluegreen;
}

function normalizePersonaVisualCode(code?: string): ReadingPersonaVisualCode | undefined {
  const normalized = code?.trim().toUpperCase();
  if (!normalized) {
    return undefined;
  }

  return PERSONA_VISUAL_CODES.includes(normalized as ReadingPersonaVisualCode)
    ? normalized as ReadingPersonaVisualCode
    : undefined;
}
