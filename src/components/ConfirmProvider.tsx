import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog } from "./ConfirmDialog";

export type ConfirmRequestOptions = {
  title: string;
  description: string;
  confirmLabel?: string;
  isDanger?: boolean;
};

type ConfirmContextValue = (options: ConfirmRequestOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmContextValue | undefined>(undefined);

/**
 * 应用级确认弹窗宿主:任意组件通过 useConfirm() 以
 * `const ok = await requestConfirm({...})` 的方式发起确认,
 * 替代 window.confirm,保证与应用主题、键盘行为一致。
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const resolverRef = useRef<((value: boolean) => void) | undefined>(undefined);
  const [options, setOptions] = useState<ConfirmRequestOptions | undefined>(undefined);

  const requestConfirm = useCallback<ConfirmContextValue>((nextOptions) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current?.(false);
      resolverRef.current = resolve;
      setOptions(nextOptions);
    });
  }, []);

  function settle(result: boolean) {
    const resolve = resolverRef.current;
    resolverRef.current = undefined;
    setOptions(undefined);
    resolve?.(result);
  }

  return (
    <ConfirmContext.Provider value={requestConfirm}>
      {children}
      <ConfirmDialog
        open={options !== undefined}
        title={options?.title ?? ""}
        description={options?.description ?? ""}
        confirmLabel={options?.confirmLabel ?? "确认"}
        isDanger={options?.isDanger ?? false}
        onCancel={() => settle(false)}
        onConfirm={() => settle(true)}
      />
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmContextValue {
  const context = useContext(ConfirmContext);
  const fallback = useCallback<ConfirmContextValue>(async ({ title, description }) => {
    if (typeof window === "undefined") {
      return true;
    }

    return window.confirm(description ? `${title}\n\n${description}` : title);
  }, []);

  return context ?? fallback;
}
