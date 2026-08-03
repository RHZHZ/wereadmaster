import glossaryData from "./glossary-data.json";

export const TERMS = glossaryData.terms;

export type GlossaryTermKey = keyof typeof TERMS;

export type BannedTerm = Readonly<{
  banned: string;
  useInstead: GlossaryTermKey;
}>;

export const BANNED_TERMS = glossaryData.bannedTerms as readonly BannedTerm[];
