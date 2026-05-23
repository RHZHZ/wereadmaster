import { useEffect, useState } from "react";
import { CheckCircle2, Layers3, X } from "lucide-react";
import type { ReadingRouteBookInput } from "../../lib/types";

type ReadingRouteInputPanelProps = {
  currentBook?: ReadingRouteBookInput;
  candidateBooks: ReadingRouteBookInput[];
  selectedCandidates: ReadingRouteBookInput[];
  onCandidateToggle: (bookId: string) => void;
  onSelectAllCandidates: () => void;
  onClearCandidates: () => void;
  onOpenDiscovery: () => void;
};

export function ReadingRouteInputPanel({
  currentBook,
  candidateBooks,
  selectedCandidates,
  onCandidateToggle,
  onSelectAllCandidates,
  onClearCandidates,
  onOpenDiscovery
}: ReadingRouteInputPanelProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const dialogTitleId = "reading-route-input-dialog-title";

  useEffect(() => {
    setIsDialogOpen(false);
  }, [currentBook?.bookId, candidateBooks.length]);

  useEffect(() => {
    if (!isDialogOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsDialogOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isDialogOpen]);

  return (
    <section className="reading-route-input-panel" aria-label="阅读指南输入范围">
      <div className="reading-route-input-summary">
        <div>
          <p className="section-kicker">输入范围</p>
          <strong>{currentBook ? `当前书：${currentBook.title}` : "缺少当前书"}</strong>
          <p>默认只用当前书；候选书只在需要生成跨书路线时纳入。</p>
        </div>
        <div className="reading-route-input-actions">
          <span>
            {selectedCandidates.length} / {candidateBooks.length} 本候选已纳入
          </span>
          <button className="secondary-action" type="button" onClick={() => setIsDialogOpen(true)}>
            调整输入范围
          </button>
        </div>
      </div>

      {isDialogOpen ? (
        <div className="reading-route-dialog-backdrop" role="presentation" onMouseDown={() => setIsDialogOpen(false)}>
          <div
            className="reading-route-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="reading-route-dialog-heading">
              <div>
                <p className="section-kicker">输入确认</p>
                <h3 id={dialogTitleId}>调整阅读指南输入范围</h3>
                <p>当前书固定纳入；候选书只在你明确选择后参与跨书路线图。</p>
              </div>
              <button className="icon-button" type="button" aria-label="关闭" onClick={() => setIsDialogOpen(false)}>
                <X aria-hidden="true" size={18} />
              </button>
            </div>

            {currentBook ? (
              <div className="reading-route-input-book-card">
                <div>
                  <p className="section-kicker">默认输入</p>
                  <strong>{currentBook.title}</strong>
                  <small>{[currentBook.author, currentBook.category].filter(Boolean).join(" · ") || "当前书"}</small>
                </div>
                <span>当前书必含</span>
              </div>
            ) : null}

            <div className="reading-route-optional-panel">
              <div className="reading-route-section-heading">
                <div>
                  <p className="section-kicker">可选扩展</p>
                  <h3>加入候选书，生成跨书路线</h3>
                  <p>候选书来自发现页保存的本地候选，只保存在本机。</p>
                </div>
                <span>
                  {selectedCandidates.length} / {candidateBooks.length} 本候选已纳入
                </span>
              </div>

              {candidateBooks.length > 0 ? (
                <>
                  <div className="reading-route-candidate-toolbar">
                    <button
                      className="text-button"
                      type="button"
                      onClick={onSelectAllCandidates}
                      disabled={selectedCandidates.length === candidateBooks.length}
                    >
                      全选候选
                    </button>
                    <button
                      className="text-button"
                      type="button"
                      onClick={onClearCandidates}
                      disabled={selectedCandidates.length === 0}
                    >
                      清空候选
                    </button>
                  </div>
                  <div className="reading-route-candidate-grid">
                    {candidateBooks.map((book) => (
                      <button
                        key={book.bookId}
                        type="button"
                        className={selectedCandidates.some((item) => item.bookId === book.bookId) ? "is-selected" : ""}
                        onClick={() => onCandidateToggle(book.bookId)}
                        aria-pressed={selectedCandidates.some((item) => item.bookId === book.bookId)}
                      >
                        <CheckCircle2 aria-hidden="true" size={17} />
                        <strong>{book.title}</strong>
                        <small>{book.author || book.category || "本地候选"}</small>
                      </button>
                    ))}
                  </div>
                  <p className="reading-route-input-hint">不勾选候选书时会生成本书阅读指南；勾选后会生成多本书先后顺序图。</p>
                </>
              ) : (
                <div className="review-empty-block">
                  <Layers3 aria-hidden="true" size={22} />
                  <span>还没有本地候选书。可先在发现页保存候选，再回到这里生成更完整路线。</span>
                  <button className="secondary-action" type="button" onClick={onOpenDiscovery}>
                    去发现页保存候选
                  </button>
                </div>
              )}
            </div>

            <div className="reading-route-dialog-footer">
              <button className="secondary-action" type="button" onClick={() => setIsDialogOpen(false)}>
                完成
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
