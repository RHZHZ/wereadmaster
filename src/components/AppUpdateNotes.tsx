type AppUpdateNotesProps = {
  notes?: string;
  emptyText: string;
};

type NotesBlock =
  | {
      type: "paragraph";
      content: string;
    }
  | {
      type: "list";
      items: string[];
    };

export function AppUpdateNotes({
  notes,
  emptyText
}: AppUpdateNotesProps) {
  const blocks = parseAppUpdateNotes(notes);

  if (blocks.length === 0) {
    return <p>{emptyText}</p>;
  }

  return (
    <>
      {blocks.map((block, index) =>
        block.type === "list" ? (
          <ul key={`list-${index}`} className="app-update-notes-list">
            {block.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p key={`paragraph-${index}`}>{block.content}</p>
        )
      )}
    </>
  );
}

function parseAppUpdateNotes(notes?: string): NotesBlock[] {
  const normalized = notes?.trim();
  if (!normalized) {
    return [];
  }

  return normalized
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      const listItems = lines
        .filter((line) => /^[-*]\s+/.test(line))
        .map((line) => line.replace(/^[-*]\s+/, "").trim())
        .filter(Boolean);

      if (listItems.length === lines.length && listItems.length > 0) {
        return {
          type: "list",
          items: listItems
        } satisfies NotesBlock;
      }

      return {
        type: "paragraph",
        content: lines.join(" ")
      } satisfies NotesBlock;
    });
}
