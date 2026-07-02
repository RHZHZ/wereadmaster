import { BarChart3, BookOpen, Bookmark, Library, UserRound, type LucideIcon } from "lucide-react";

export type BottomNavigationId =
  | "dashboard"
  | "shelf"
  | "notes"
  | "readingReview"
  | "mine";

export type BottomNavigationItem = {
  id: BottomNavigationId;
  label: string;
  icon: LucideIcon;
};

export const bottomNavigationItems: BottomNavigationItem[] = [
  { id: "dashboard", label: "总览", icon: BookOpen },
  { id: "shelf", label: "书架", icon: Library },
  { id: "notes", label: "笔记", icon: Bookmark },
  { id: "readingReview", label: "复盘", icon: BarChart3 },
  { id: "mine", label: "我的", icon: UserRound },
];

type BottomNavigationProps = {
  activeId?: BottomNavigationId;
  onNavigate: (id: BottomNavigationId) => void;
};

export function BottomNavigation({
  activeId,
  onNavigate,
}: BottomNavigationProps) {
  return (
    <nav className="bottom-nav" aria-label="移动端主导航">
      {bottomNavigationItems.map((item) => {
        const Icon = item.icon;
        const isActive = item.id === activeId;

        return (
          <button
            key={item.id}
            type="button"
            className={`bottom-nav-item ${isActive ? "is-active" : ""}`}
            aria-current={isActive ? "page" : undefined}
            onClick={() => onNavigate(item.id)}
          >
            <Icon aria-hidden="true" size={22} strokeWidth={1.9} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
