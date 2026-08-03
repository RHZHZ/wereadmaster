const NOTION_OBJECT_ID_PATTERN = /[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|[0-9a-f]{32}/gi;

export function parseNotionObjectId(value: string): string | undefined {
  const matches = value.match(NOTION_OBJECT_ID_PATTERN) ?? [];
  const ids = [...new Set(matches.map(normalizeNotionObjectId))];

  return ids.length === 1 ? ids[0] : undefined;
}

export const parseNotionPageId = parseNotionObjectId;

function normalizeNotionObjectId(value: string): string {
  const compact = value.replace(/-/g, "").toLowerCase();
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}
