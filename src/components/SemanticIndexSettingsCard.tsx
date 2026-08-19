import { useEffect, useMemo, useState } from "react";
import {
  Database,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  cancelEmbeddingIndex,
  clearEmbeddingIndex,
  getCommandErrorMessage,
  getEmbeddingIndexState,
  getEmbeddingSettingsState,
  removeEmbeddingCredential,
  resumeEmbeddingIndex,
  saveEmbeddingSettings,
  startEmbeddingIndex,
  testEmbeddingConnection,
} from "../lib/reading-api";
import type {
  EmbeddingIndexProfile,
  EmbeddingIndexState,
  EmbeddingProviderSettings,
  EmbeddingSettingsState,
} from "../lib/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { useToast } from "./ToastProvider";

const DEFAULT_PROVIDER: EmbeddingProviderSettings = {
  baseUrl: "https://api.openai.com/v1",
  model: "text-embedding-3-small",
  providerLabel: "OpenAI-compatible",
  batchSize: 16,
  remoteNoteEmbeddingEnabled: false,
};

type PendingAction = "enableRemote" | "removeCredential" | "clearIndex";

type SemanticIndexSettingsCardProps = {
  onError: (message: string | undefined) => void;
};

export function SemanticIndexSettingsCard({
  onError,
}: SemanticIndexSettingsCardProps) {
  const [settingsState, setSettingsState] = useState<EmbeddingSettingsState>();
  const [indexState, setIndexState] = useState<EmbeddingIndexState>();
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(DEFAULT_PROVIDER.baseUrl);
  const [model, setModel] = useState(DEFAULT_PROVIDER.model);
  const [providerLabel, setProviderLabel] = useState(DEFAULT_PROVIDER.providerLabel);
  const [batchSize, setBatchSize] = useState(DEFAULT_PROVIDER.batchSize);
  const [remoteEnabled, setRemoteEnabled] = useState(false);
  const [consentConfirmedAt, setConsentConfirmedAt] = useState<string>();
  const [pendingAction, setPendingAction] = useState<PendingAction>();
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isIndexActionRunning, setIsIndexActionRunning] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const { showToast } = useToast();

  const currentProfile = indexState?.active ?? indexState?.latest;
  const progress = useMemo(
    () => profileProgress(currentProfile),
    [currentProfile],
  );
  const hasCredential = settingsState?.credential.hasCredential ?? false;
  const canUseProvider = canUseEmbeddingProvider(
    baseUrl,
    model,
    apiKey,
    hasCredential,
  );
  const canStart =
    canUseProvider &&
    remoteEnabled &&
    Boolean(consentConfirmedAt) &&
    !indexState?.active &&
    !isIndexActionRunning;
  const canResume =
    canStart &&
    Boolean(
      currentProfile &&
        (currentProfile.status === "failed" ||
          currentProfile.status === "cancelled"),
    );

  useEffect(() => {
    let disposed = false;
    setIsLoading(true);
    Promise.all([getEmbeddingSettingsState(), getEmbeddingIndexState()])
      .then(([nextSettings, nextIndex]) => {
        if (disposed) {
          return;
        }
        setSettingsState(nextSettings);
        applyProviderSettings(nextSettings.provider);
        setIndexState(nextIndex);
      })
      .catch((error) => {
        if (!disposed) {
          onError(getCommandErrorMessage(error));
        }
      })
      .finally(() => {
        if (!disposed) {
          setIsLoading(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, [onError]);

  useEffect(() => {
    if (!isIndexActionRunning && indexState?.active?.status !== "building") {
      return;
    }

    let disposed = false;
    const timer = window.setInterval(() => {
      void getEmbeddingIndexState()
        .then((nextState) => {
          if (!disposed) {
            setIndexState(nextState);
          }
        })
        .catch((error) => {
          if (!disposed) {
            onError(getCommandErrorMessage(error));
          }
        });
    }, 1500);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [indexState?.active?.status, isIndexActionRunning, onError]);

  function applyProviderSettings(provider: EmbeddingProviderSettings) {
    setBaseUrl(provider.baseUrl);
    setModel(provider.model);
    setProviderLabel(provider.providerLabel);
    setBatchSize(provider.batchSize);
    setRemoteEnabled(provider.remoteNoteEmbeddingEnabled);
    setConsentConfirmedAt(provider.consentConfirmedAt);
  }

  function providerSettings(): EmbeddingProviderSettings {
    return {
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      providerLabel: providerLabel.trim() || "OpenAI-compatible",
      batchSize: Math.max(1, Math.min(128, Math.trunc(batchSize) || 16)),
      remoteNoteEmbeddingEnabled: remoteEnabled,
      consentConfirmedAt: remoteEnabled ? consentConfirmedAt : undefined,
    };
  }

  async function refreshIndexState() {
    const nextState = await getEmbeddingIndexState();
    setIndexState(nextState);
    return nextState;
  }

  async function handleSaveSettings() {
    if (remoteEnabled && !consentConfirmedAt) {
      setPendingAction("enableRemote");
      return;
    }

    setIsSaving(true);
    onError(undefined);
    try {
      const nextState = await saveEmbeddingSettings({
        ...providerSettings(),
        apiKey: apiKey.trim() || undefined,
      });
      setSettingsState(nextState);
      applyProviderSettings(nextState.provider);
      setApiKey("");
      showToast({
        message: apiKey.trim()
          ? "语义索引设置和独立 Key 已保存到本机安全存储。"
          : "语义索引 Provider 设置已保存。",
        tone: "success",
      });
    } catch (error) {
      onError(getCommandErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleTestConnection() {
    setIsTesting(true);
    onError(undefined);
    try {
      const result = await testEmbeddingConnection({
        apiKey: apiKey.trim() || undefined,
        settings: providerSettings(),
      });
      if (!result.isValid) {
        onError(result.message || "Embedding Provider 连通性测试失败。");
        return;
      }
      showToast({
        message:
          result.message ||
          `Embedding Provider 可用，模型维度为 ${result.dimensions}。`,
        tone: "success",
      });
    } catch (error) {
      onError(getCommandErrorMessage(error));
    } finally {
      setIsTesting(false);
    }
  }

  async function handleRemoveCredential() {
    setIsSaving(true);
    onError(undefined);
    try {
      const nextState = await removeEmbeddingCredential(true);
      setSettingsState(nextState);
      applyProviderSettings(nextState.provider);
      setApiKey("");
      setPendingAction(undefined);
      showToast({
        message: "已移除独立的 Embedding API Key，现有本地向量不会自动删除。",
        tone: "success",
      });
    } catch (error) {
      onError(getCommandErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleStartOrResume() {
    setIsIndexActionRunning(true);
    onError(undefined);
    try {
      if (!canResume) {
        const nextSettings = await saveEmbeddingSettings({
          ...providerSettings(),
          apiKey: apiKey.trim() || undefined,
        });
        setSettingsState(nextSettings);
        applyProviderSettings(nextSettings.provider);
        setApiKey("");
      }
      const profile = canResume && currentProfile
        ? await resumeEmbeddingIndex(currentProfile.id)
        : await startEmbeddingIndex();
      await refreshIndexState();
      showToast({
        message:
          profile.status === "ready"
            ? "语义索引构建完成。普通笔记查询将自动使用混合检索。"
            : profile.errorMessage || formatProfileStatus(profile.status),
        tone: profile.status === "ready" ? "success" : "warning",
      });
    } catch (error) {
      onError(getCommandErrorMessage(error));
      try {
        await refreshIndexState();
      } catch {
        // 保留首个错误。
      }
    } finally {
      setIsIndexActionRunning(false);
    }
  }

  async function handleCancel() {
    const profileId = indexState?.active?.id;
    if (!profileId) {
      return;
    }
    setIsCancelling(true);
    onError(undefined);
    try {
      await cancelEmbeddingIndex(profileId);
      await refreshIndexState();
      showToast({ message: "已请求在当前批次结束后取消索引构建。", tone: "neutral" });
    } catch (error) {
      onError(getCommandErrorMessage(error));
    } finally {
      setIsCancelling(false);
    }
  }

  async function handleClearIndex() {
    setIsClearing(true);
    onError(undefined);
    try {
      const nextState = await clearEmbeddingIndex(undefined, true);
      setIndexState(nextState);
      setPendingAction(undefined);
      showToast({
        message: "本机语义向量和索引任务记录已清除，原始笔记不受影响。",
        tone: "success",
      });
    } catch (error) {
      onError(getCommandErrorMessage(error));
    } finally {
      setIsClearing(false);
    }
  }

  return (
    <section
      className="settings-card settings-panel settings-control-panel semantic-index-settings-card"
      aria-label="语义索引"
    >
      <div className="settings-card-heading">
        <span className="settings-icon">
          <Database aria-hidden="true" size={20} />
        </span>
        <div>
          <p className="section-kicker">实验性基础设施</p>
          <h3>语义索引</h3>
        </div>
      </div>
      <p>
        使用独立的 OpenAI-compatible Provider 或 Ollama 原生接口生成本地向量。索引完成后，普通笔记查询会自动融合本地词法与语义召回；精确短语、全量匹配和分页续查仍优先使用本地词法检索。
      </p>
      <p className="settings-card-hint">
        索引未完成、Provider 配置发生漂移或向量查询失败时，笔记搜索仍会保留本地词法结果，并在结果卡片中标明回退原因；语义索引不是书目查询或本地笔记查询的前置条件。
      </p>
      <div className="status-message status-message--warning">
        <ShieldCheck aria-hidden="true" size={18} />
        <span>
          开启远程构建会把笔记正文发送到你配置的 Provider；聊天 AI 的 Key 和授权不会被复用。向量保存在本机，默认不进入备份。
        </span>
      </div>
      <div className="settings-form-grid">
        <label className="credential-input settings-form-span">
          <span>Embedding Base URL</span>
          <input
            value={baseUrl}
            type="url"
            autoComplete="off"
            placeholder="https://api.openai.com/v1"
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </label>
        <label className="credential-input">
          <span>模型</span>
          <input
            value={model}
            type="text"
            autoComplete="off"
            placeholder="text-embedding-3-small"
            onChange={(event) => setModel(event.target.value)}
          />
        </label>
        <label className="credential-input">
          <span>Provider 显示名</span>
          <input
            value={providerLabel}
            type="text"
            autoComplete="off"
            placeholder="OpenAI-compatible"
            onChange={(event) => setProviderLabel(event.target.value)}
          />
        </label>
        <label className="credential-input">
          <span>每批文档数</span>
          <input
            value={batchSize}
            type="number"
            min={1}
            max={128}
            onChange={(event) => setBatchSize(Number(event.target.value))}
          />
        </label>
        <label className="credential-input">
          <span>新的 Embedding API Key</span>
          <input
            value={apiKey}
            type="password"
            autoComplete="off"
            placeholder={
              isOllamaEndpoint(baseUrl)
                ? "Ollama 本地接口无需 Key"
                : hasCredential
                  ? "已保存，留空则不更改"
                  : "独立保存，不复用聊天 AI Key"
            }
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
      </div>
      <div className="reading-assistant-settings-grid">
        <label>
          <input
            type="checkbox"
            checked={remoteEnabled}
            onChange={(event) => {
              if (event.currentTarget.checked) {
                setPendingAction("enableRemote");
              } else {
                setRemoteEnabled(false);
                setConsentConfirmedAt(undefined);
              }
            }}
            disabled={isSaving}
          />
          <span>
            <strong>允许发送笔记正文生成向量</strong>
            <small>
              独立授权；{consentConfirmedAt ? `确认于 ${formatLocalTime(consentConfirmedAt)}` : "尚未授权"}
            </small>
          </span>
        </label>
      </div>
      <div className="settings-actions settings-card-actions">
        <button
          className="secondary-action"
          type="button"
          onClick={() => void handleSaveSettings()}
          disabled={isSaving || isTesting || isLoading || !baseUrl.trim() || !model.trim()}
        >
          {isSaving ? "保存中" : "保存语义索引设置"}
        </button>
        <button
          className="sync-button"
          type="button"
          onClick={() => void handleTestConnection()}
          disabled={isTesting || isSaving || !canUseProvider}
        >
          {isTesting ? (
            <Loader2 aria-hidden="true" size={18} className="spin" />
          ) : (
            <RefreshCw aria-hidden="true" size={18} />
          )}
          {isTesting ? "测试中" : "测试 Embedding 连接"}
        </button>
        <button
          className="sync-button"
          type="button"
          onClick={() => setPendingAction("removeCredential")}
          disabled={!hasCredential || isSaving || isTesting}
        >
          <KeyRound aria-hidden="true" size={18} />
          移除 Embedding Key
        </button>
      </div>

      <dl className="settings-dl">
        <div>
          <dt>任务状态</dt>
          <dd>{currentProfile ? formatProfileStatus(currentProfile.status) : "尚未构建"}</dd>
        </div>
        <div>
          <dt>进度</dt>
          <dd>
            {currentProfile
              ? `${currentProfile.indexedDocumentCount} / ${currentProfile.totalDocumentCount}`
              : "0 / 0"}
          </dd>
        </div>
        <div>
          <dt>索引模型</dt>
          <dd>{currentProfile?.modelId || "尚未记录"}</dd>
        </div>
        <div>
          <dt>向量维度</dt>
          <dd>{currentProfile?.dimensions || "尚未记录"}</dd>
        </div>
      </dl>
      <progress
        className="semantic-index-progress"
        max={100}
        value={progress}
        aria-label="语义索引构建进度"
      >
        {progress}%
      </progress>
      {currentProfile?.errorMessage ? (
        <div className="status-message status-message--error">
          <span>{currentProfile.errorMessage}</span>
        </div>
      ) : null}
      <div className="settings-actions settings-card-actions">
        <button
          className="secondary-action"
          type="button"
          onClick={() => void handleStartOrResume()}
          disabled={canResume ? false : !canStart}
        >
          {isIndexActionRunning ? (
            <Loader2 aria-hidden="true" size={18} className="spin" />
          ) : (
            <Database aria-hidden="true" size={18} />
          )}
          {isIndexActionRunning
            ? "构建中"
            : canResume
              ? "继续构建"
              : indexState?.ready
                ? "重建索引"
                : "开始构建"}
        </button>
        <button
          className="sync-button"
          type="button"
          onClick={() => void handleCancel()}
          disabled={!indexState?.active || isCancelling}
        >
          {isCancelling ? "取消中" : "取消构建"}
        </button>
        <button
          className="sync-button"
          type="button"
          onClick={() => setPendingAction("clearIndex")}
          disabled={Boolean(indexState?.active) || isClearing || !indexState?.latest}
        >
          <Trash2 aria-hidden="true" size={18} />
          {isClearing ? "清除中" : "清除语义索引"}
        </button>
      </div>

      <ConfirmDialog
        open={pendingAction === "enableRemote"}
        title="允许远程生成语义向量？"
        description="启用后，构建索引时会把本机笔记正文分批发送到你配置的 Embedding Provider。此授权独立于聊天 AI，向量仅保存在本机且默认不进入备份。"
        confirmLabel="确认授权"
        onCancel={() => setPendingAction(undefined)}
        onConfirm={() => {
          setRemoteEnabled(true);
          setConsentConfirmedAt(new Date().toISOString());
          setPendingAction(undefined);
        }}
      />
      <ConfirmDialog
        open={pendingAction === "removeCredential"}
        title="确认移除 Embedding API Key？"
        description="移除后不能继续构建或重建语义索引；现有本地向量不会自动删除，当前词法检索不受影响。"
        confirmLabel="确认移除"
        isDanger
        isBusy={isSaving}
        onCancel={() => setPendingAction(undefined)}
        onConfirm={() => void handleRemoveCredential()}
      />
      <ConfirmDialog
        open={pendingAction === "clearIndex"}
        title="确认清除本机语义索引？"
        description="这会删除本机向量和索引任务记录，不会删除原始笔记、聊天 AI 设置或导出文件。需要时可以重新构建。"
        confirmLabel="确认清除"
        isDanger
        isBusy={isClearing}
        onCancel={() => setPendingAction(undefined)}
        onConfirm={() => void handleClearIndex()}
      />
    </section>
  );
}

export function isOllamaEndpoint(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl.trim());
    return url.pathname.replace(/\/+$/, "").endsWith("/api/embed");
  } catch {
    return false;
  }
}

export function canUseEmbeddingProvider(
  baseUrl: string,
  model: string,
  apiKey: string,
  hasCredential: boolean,
): boolean {
  return (
    Boolean(baseUrl.trim()) &&
    Boolean(model.trim()) &&
    (isOllamaEndpoint(baseUrl) || Boolean(apiKey.trim()) || hasCredential)
  );
}

function profileProgress(profile?: EmbeddingIndexProfile): number {
  if (!profile) {
    return 0;
  }
  if (profile.status === "ready") {
    return 100;
  }
  if (profile.totalDocumentCount <= 0) {
    return 0;
  }
  return Math.max(
    0,
    Math.min(100, Math.round((profile.indexedDocumentCount / profile.totalDocumentCount) * 100)),
  );
}

function formatProfileStatus(status: EmbeddingIndexProfile["status"]): string {
  switch (status) {
    case "building":
      return "正在构建";
    case "ready":
      return "构建完成";
    case "failed":
      return "构建失败，可继续";
    case "cancelled":
      return "已取消，可继续";
    case "superseded":
      return "已被新索引替代";
  }
}

function formatLocalTime(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}
