import { Bot } from "lucide-react";

type ReadingAssistantLauncherProps = {
  onOpen: () => void;
};

export function ReadingAssistantLauncher({ onOpen }: ReadingAssistantLauncherProps) {
  return (
    <button
      className="reading-assistant-launcher"
      type="button"
      onClick={onOpen}
      aria-label="打开 AI 阅读助手"
      title="AI 阅读助手"
    >
      <Bot aria-hidden="true" size={20} />
    </button>
  );
}
