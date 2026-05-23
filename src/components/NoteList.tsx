import { useEffect, useState } from "react";
import { Bookmark, ChevronDown, ChevronRight, ListCollapse, ListTree, MessageSquareText } from "lucide-react";
import { formatUnixDate } from "../lib/formatters";
import type { ChapterNoteGroup, Highlight, Thought } from "../lib/types";

type NoteListProps = {
  groups: ChapterNoteGroup[];
};

type ChapterFilter = "all" | "thoughts";

const DEFAULT_EXPANDED_GROUP_COUNT = 1;

export function NoteList({ groups }: NoteListProps) {
  const [chapterFilter, setChapterFilter] = useState<ChapterFilter>("all");
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string>>(() =>
    getDefaultExpandedGroupKeys(groups)
  );

  useEffect(() => {
    setChapterFilter("all");
    setExpandedGroupKeys(getDefaultExpandedGroupKeys(groups));
  }, [groups]);

  if (groups.length === 0) {
    return (
      <section className="empty-inline" aria-label="没有可展示的笔记">
        <Bookmark aria-hidden="true" size={28} />
        <h3>这本书暂时没有可导出的笔记内容</h3>
        <p>书签只记录数量，不会作为正文内容展示或导出。</p>
      </section>
    );
  }

  const visibleGroups = filterChapterGroups(groups, chapterFilter);
  const isAllVisibleExpanded =
    visibleGroups.length > 0 && visibleGroups.every((group) => expandedGroupKeys.has(getGroupKey(group)));

  function handleToggleGroup(group: ChapterNoteGroup) {
    const groupKey = getGroupKey(group);
    setExpandedGroupKeys((currentKeys) => {
      const nextKeys = new Set(currentKeys);
      if (nextKeys.has(groupKey)) {
        nextKeys.delete(groupKey);
        return nextKeys;
      }

      nextKeys.add(groupKey);
      return nextKeys;
    });
  }

  function handleToggleAllVisibleGroups() {
    if (isAllVisibleExpanded) {
      setExpandedGroupKeys(new Set());
      return;
    }

    setExpandedGroupKeys(new Set(visibleGroups.map(getGroupKey)));
  }

  function handleJumpToGroup(group: ChapterNoteGroup) {
    const groupKey = getGroupKey(group);
    setExpandedGroupKeys((currentKeys) => new Set(currentKeys).add(groupKey));
    document.getElementById(getGroupDomId(groupKey))?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  return (
    <div className="note-list" aria-label="笔记内容">
      <section className="note-list-toolbar" aria-label="章节视图工具">
        <div className="note-list-toolbar-main">
          <div>
            <p className="section-kicker">章节管理</p>
            <h3>{visibleGroups.length} 个章节可浏览</h3>
          </div>
          <div className="note-list-toolbar-actions">
            <div className="filter-tabs compact-tabs" role="tablist" aria-label="章节筛选">
              {[
                { id: "all", label: "全部章节" },
                { id: "thoughts", label: "只看有想法" }
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={chapterFilter === item.id}
                  className={chapterFilter === item.id ? "is-active" : ""}
                  onClick={() => setChapterFilter(item.id as ChapterFilter)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button className="sync-button" type="button" onClick={handleToggleAllVisibleGroups}>
              {isAllVisibleExpanded ? (
                <ListCollapse aria-hidden="true" size={17} />
              ) : (
                <ListTree aria-hidden="true" size={17} />
              )}
              {isAllVisibleExpanded ? "收起全部" : "展开全部"}
            </button>
          </div>
        </div>

        {visibleGroups.length > 0 ? (
          <nav className="note-chapter-index" aria-label="章节快速目录">
            {visibleGroups.map((group) => {
              const groupKey = getGroupKey(group);
              return (
                <button
                  className={expandedGroupKeys.has(groupKey) ? "is-expanded" : ""}
                  key={groupKey}
                  type="button"
                  onClick={() => handleJumpToGroup(group)}
                >
                  <span>{group.chapterUid ? `章节 ${group.chapterUid}` : "全书"}</span>
                  <small>{group.highlights.length} 划线 · {group.thoughts.length} 想法</small>
                </button>
              );
            })}
          </nav>
        ) : null}
      </section>

      {visibleGroups.length === 0 ? (
        <section className="empty-inline" aria-label="没有有想法的章节">
          <MessageSquareText aria-hidden="true" size={28} />
          <h3>这本书还没有带想法的章节</h3>
          <p>可以切回全部章节查看划线内容。</p>
          <button className="secondary-action" type="button" onClick={() => setChapterFilter("all")}>
            查看全部章节
          </button>
        </section>
      ) : null}

      {visibleGroups.map((group) => {
        const groupKey = getGroupKey(group);
        const isExpanded = expandedGroupKeys.has(groupKey);
        return (
          <section
            className={`note-group ${isExpanded ? "is-expanded" : "is-collapsed"}`}
            id={getGroupDomId(groupKey)}
            key={groupKey}
            aria-label={group.title}
          >
            <button
              className="note-group-heading"
              type="button"
              aria-expanded={isExpanded}
              onClick={() => handleToggleGroup(group)}
            >
              <div className="note-group-heading-main">
                <p className="section-kicker">{group.chapterUid ? `章节 ${group.chapterUid}` : "全书"}</p>
                <h3>{group.title}</h3>
              </div>
              <span className="note-group-count">
                {group.highlights.length} 划线 · {group.thoughts.length} 想法
              </span>
              {isExpanded ? (
                <ChevronDown aria-hidden="true" size={18} />
              ) : (
                <ChevronRight aria-hidden="true" size={18} />
              )}
            </button>

            {isExpanded ? (
              <div className="note-group-body">
                {group.highlights.length > 0 ? (
                  <div className="note-section">
                    <h4>
                      <Bookmark aria-hidden="true" size={17} />
                      划线
                    </h4>
                    {group.highlights.map((highlight) => (
                      <HighlightCard key={highlight.bookmarkId} highlight={highlight} />
                    ))}
                  </div>
                ) : null}

                {group.thoughts.length > 0 ? (
                  <div className="note-section">
                    <h4>
                      <MessageSquareText aria-hidden="true" size={17} />
                      想法/点评
                    </h4>
                    {group.thoughts.map((thought) => (
                      <ThoughtCard key={thought.reviewId} thought={thought} />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="note-group-preview">已收起，点击章节标题展开原始划线和想法。</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function filterChapterGroups(groups: ChapterNoteGroup[], filter: ChapterFilter): ChapterNoteGroup[] {
  if (filter === "thoughts") {
    return groups.filter((group) => group.thoughts.length > 0);
  }

  return groups;
}

function getDefaultExpandedGroupKeys(groups: ChapterNoteGroup[]): Set<string> {
  return new Set(groups.slice(0, DEFAULT_EXPANDED_GROUP_COUNT).map(getGroupKey));
}

function getGroupKey(group: ChapterNoteGroup): string {
  return `${group.chapterUid ?? "book"}-${group.title}`;
}

function getGroupDomId(groupKey: string): string {
  return `note-group-${groupKey.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function HighlightCard({ highlight }: { highlight: Highlight }) {
  return (
    <article className="highlight-card">
      <blockquote>{highlight.markText}</blockquote>
      <div className="note-meta">
        {highlight.createTime ? <span>{formatUnixDate(highlight.createTime)}</span> : null}
        {highlight.range ? <span>位置 {highlight.range}</span> : null}
      </div>
    </article>
  );
}

function ThoughtCard({ thought }: { thought: Thought }) {
  return (
    <article className="thought-card">
      {thought.abstractText ? (
        <blockquote className="thought-card-abstract">{thought.abstractText}</blockquote>
      ) : null}
      <p>{thought.content}</p>
      <div className="note-meta">
        {thought.createTime ? <span>{formatUnixDate(thought.createTime)}</span> : null}
        {thought.star !== undefined ? <span>{formatPersonalStar(thought.star)}</span> : null}
        {thought.range ? <span>位置 {thought.range}</span> : null}
        {thought.isFinish ? <span>读完点评</span> : null}
      </div>
    </article>
  );
}

function formatPersonalStar(star: number): string {
  if (!Number.isFinite(star) || star <= 0) {
    return "未评分";
  }

  return `${Math.min(5, Math.trunc(star))} 星`;
}
