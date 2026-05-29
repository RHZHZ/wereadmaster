import type { ReactNode } from "react";

type ReviewEmptyBlockProps = {
  icon: ReactNode;
  text: string;
};

export function ReviewEmptyBlock({ icon, text }: ReviewEmptyBlockProps) {
  return (
    <div className="review-empty-block">
      {icon}
      <span>{text}</span>
    </div>
  );
}
