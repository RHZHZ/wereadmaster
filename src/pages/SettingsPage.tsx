import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertCircle,
  Bot,
  ChevronDown,
  Copy,
  Database,
  Download,
  Eye,
  ExternalLink,
  FolderOpen,
  Github,
  HardDrive,
  HeartHandshake,
  Info,
  KeyRound,
  Loader2,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import onboardingLocalVault from "../assets/generated/onboarding-local-vault.png";
import authorContactCode from "../assets/support/author-contact-code.jpg";
import authorRewardCode from "../assets/support/author-reward-code.jpg";
import { AppUpdateNotes } from "../components/AppUpdateNotes";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../components/ToastProvider";
import { copyTextToClipboard } from "../lib/clipboard";
import { formatUnixDate } from "../lib/formatters";
import {
  APP_UPDATE_RELEASE_AUTHOR,
  APP_UPDATE_RELEASE_AUTHOR_URL,
  APP_UPDATE_RELEASE_FEED_URL,
  APP_UPDATE_RELEASE_PAGE_URL,
  APP_UPDATE_RELEASE_REPOSITORY_URL,
} from "../lib/app-update-config";
import {
  AI_PROVIDER_PRESETS,
  AI_RESPONSE_FORMAT_POLICY_OPTIONS,
  DEFAULT_AI_PROVIDER_PRESET_ID,
  DEFAULT_AI_RESPONSE_FORMAT_POLICY,
  getAiProviderPreset,
  normalizeAiProviderPresetId,
  normalizeAiResponseFormatPolicy,
} from "../lib/ai-provider-presets";
import {
  chooseCustomExportDirectory,
  chooseCustomDataDirectory,
  clearAiOutputCache,
  clearLocalCache,
  clearReadingAssistantHistory,
  exportLocalDataBackup,
  exportDiagnostics,
  getCommandErrorMessage,
  getAiSettingsState,
  getReadingAssistantPreferences,
  getSettingsState,
  listAiProviderModels,
  migrateLocalDataDirectory,
  probeAiProviderCapabilities,
  removeAiCredential,
  removeCredential,
  resetCustomExportDirectory,
  resetWereadProxyUrl,
  restoreLocalDataBackup,
  saveCustomExportDirectory,
  saveAiSettings,
  saveCredential,
  saveReadingAssistantPreferences,
  saveWereadProxyUrl,
  testAiConnection,
  validateAiCredential,
  validateCredential,
} from "../lib/reading-api";
import type { UserPreferences } from "../lib/preferences";
import type {
  AiProviderCapabilityStatus,
  AiProviderPresetId,
  AiProviderCapabilityProbe,
  AiProviderModelListItem,
  AiProviderSettings,
  AiResponseFormatPolicy,
  AiSettingsState,
  AppUpdateStatus,
  CredentialStatus,
  ExportBackupResult,
  ReadingAssistantPreferences,
  SettingsState,
  SyncState,
} from "../lib/types";

type SettingsPageProps = {
  open: boolean;
  credentialStatus?: CredentialStatus;
  onCredentialChange: (status: CredentialStatus) => void;
  onLocalCacheCleared?: () => void;
  preferences: UserPreferences;
  onPreferencesChange: (preferences: UserPreferences) => void;
  onClose: () => void;
  preferredCategory?: SettingsCategoryId;
  appUpdateStatus?: AppUpdateStatus;
  hasPendingAppUpdate?: boolean;
  isCheckingForAppUpdate?: boolean;
  isInstallingAppUpdate?: boolean;
  appUpdateProgressLabel?: string;
  onCheckForAppUpdate?: () => Promise<void>;
  onInstallAppUpdate?: () => Promise<void>;
  onViewAppUpdate?: () => void;
};

type PendingAction =
  | "removeCredential"
  | "removeAiCredential"
  | "clearAiOutputCache"
  | "clearReadingAssistantHistory"
  | "clearCache"
  | "restoreBackup"
  | "migrateDataDirectory"
  | "installUpdate";
type PendingStorageMigration = {
  targetDir: string;
};
export type SettingsCategoryId =
  | "account"
  | "ai"
  | "appearance"
  | "export"
  | "updates"
  | "support"
  | "advanced";
type SettingsCategory = {
  id: SettingsCategoryId;
  label: string;
  description: string;
  heroDescription: string;
  icon: LucideIcon;
};

const WEREAD_SKILL_API_KEY_URL = "https://weread.qq.com/r/weread-skills";

const settingsCategories: SettingsCategory[] = [
  {
    id: "account",
    label: "账户与同步",
    description: "微信读书凭据",
    heroDescription: "连接后可同步书架、笔记和统计，凭据仅在本机使用。",
    icon: KeyRound,
  },
  {
    id: "ai",
    label: "AI 设置",
    description: "Provider 和 Key",
    heroDescription:
      "配置用于书籍复盘、阅读指南、统计复盘和选书决策的 Provider；只有主动生成时才会发送对应输入范围。",
    icon: Bot,
  },
  {
    id: "appearance",
    label: "外观偏好",
    description: "主题、字号、默认入口",
    heroDescription: "调整主题、字号和默认入口，让应用更贴合你的阅读习惯。",
    icon: Eye,
  },
  {
    id: "export",
    label: "导出设置",
    description: "保存目录",
    heroDescription:
      "统一控制笔记、批量导出、书籍复盘和诊断信息的后续保存位置，不移动历史导出内容。",
    icon: Download,
  },
  {
    id: "updates",
    label: "应用更新",
    description: "版本、发布、安装",
    heroDescription:
      "集中查看版本、发布来源和更新摘要，让安装动作继续保持清晰、可验证和可回退。",
    icon: Sparkles,
  },
  {
    id: "support",
    label: "关于与支持",
    description: "作者、反馈、赞赏",
    heroDescription: "查看项目来源、联系作者或自愿赞赏维护工作。",
    icon: HeartHandshake,
  },
  {
    id: "advanced",
    label: "高级维护",
    description: "缓存、备份、数据库、诊断",
    heroDescription:
      "这些操作偏排障或有数据影响，集中放在维护分类，避免和日常设置混在同一层级。",
    icon: Database,
  },
];

const sectionLabels: Record<string, string> = {
  shelf: "书架",
  book: "书籍详情",
  notes: "笔记",
  stats: "统计",
  discovery: "发现",
  dashboard: "总览",
};

const DEFAULT_READING_ASSISTANT_PREFERENCES: ReadingAssistantPreferences = {
  usePersonalizedContext: true,
  useReadingMemory: true,
  allowRawBookNotes: false,
  saveConversationHistory: true,
};

export function SettingsPage({
  open,
  credentialStatus,
  onCredentialChange,
  onLocalCacheCleared,
  preferences,
  onPreferencesChange,
  onClose,
  preferredCategory,
  appUpdateStatus,
  hasPendingAppUpdate = false,
  isCheckingForAppUpdate = false,
  isInstallingAppUpdate = false,
  appUpdateProgressLabel,
  onCheckForAppUpdate,
  onInstallAppUpdate,
  onViewAppUpdate,
}: SettingsPageProps) {
  const [state, setState] = useState<SettingsState>();
  const [aiState, setAiState] = useState<AiSettingsState>();
  const [apiKey, setApiKey] = useState("");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiBaseUrl, setAiBaseUrl] = useState("https://api.openai.com/v1");
  const [aiModel, setAiModel] = useState("gpt-4o-mini");
  const [aiProviderPresetId, setAiProviderPresetId] =
    useState<AiProviderPresetId>(DEFAULT_AI_PROVIDER_PRESET_ID);
  const [aiResponseFormatPolicy, setAiResponseFormatPolicy] =
    useState<AiResponseFormatPolicy>(DEFAULT_AI_RESPONSE_FORMAT_POLICY);
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingCredential, setIsSavingCredential] = useState(false);
  const [isSavingAiCredential, setIsSavingAiCredential] = useState(false);
  const [isTestingAiConnection, setIsTestingAiConnection] = useState(false);
  const [isProbingAiProvider, setIsProbingAiProvider] = useState(false);
  const [isRefreshingAiModels, setIsRefreshingAiModels] = useState(false);
  const [aiProviderProbe, setAiProviderProbe] =
    useState<AiProviderCapabilityProbe>();
  const [aiProviderModels, setAiProviderModels] = useState<
    AiProviderModelListItem[]
  >([]);
  const [aiProviderModelsFetchedAt, setAiProviderModelsFetchedAt] =
    useState<string>();
  const [aiProviderModelMessage, setAiProviderModelMessage] =
    useState<string>();
  const [readingAssistantPreferences, setReadingAssistantPreferences] =
    useState<ReadingAssistantPreferences>(
      DEFAULT_READING_ASSISTANT_PREFERENCES,
    );
  const [isSavingReadingAssistantPreferences, setIsSavingReadingAssistantPreferences] =
    useState(false);
  const [isClearingReadingAssistantHistory, setIsClearingReadingAssistantHistory] =
    useState(false);
  const [isClearingAiOutputCache, setIsClearingAiOutputCache] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [isExportingBackup, setIsExportingBackup] = useState(false);
  const [isRestoringBackup, setIsRestoringBackup] = useState(false);
  const [isChoosingDataDirectory, setIsChoosingDataDirectory] = useState(false);
  const [isMigratingDataDirectory, setIsMigratingDataDirectory] =
    useState(false);
  const [isChoosingExportDirectory, setIsChoosingExportDirectory] =
    useState(false);
  const [isSavingExportDirectory, setIsSavingExportDirectory] = useState(false);
  const [isResettingExportDirectory, setIsResettingExportDirectory] =
    useState(false);
  const [exportDirectoryInput, setExportDirectoryInput] = useState("");
  const [wereadProxyInput, setWereadProxyInput] = useState("");
  const [isSavingWereadProxy, setIsSavingWereadProxy] = useState(false);
  const [isResettingWereadProxy, setIsResettingWereadProxy] = useState(false);
  const [isExportingDiagnostics, setIsExportingDiagnostics] = useState(false);
  const [lastBackup, setLastBackup] = useState<ExportBackupResult>();
  const [pendingStorageMigration, setPendingStorageMigration] =
    useState<PendingStorageMigration>();
  const [pendingAction, setPendingAction] = useState<PendingAction>();
  const [activeCategory, setActiveCategory] = useState<SettingsCategoryId>(
    preferredCategory ?? "account",
  );
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [error, setError] = useState<string>();
  const { showToast } = useToast();
  const credential = state?.credential ?? credentialStatus;
  const activeCategoryConfig =
    settingsCategories.find((category) => category.id === activeCategory) ??
    settingsCategories[0];
  const supportsNativeUpdater =
    state?.supportsNativeUpdater ??
    appUpdateStatus?.supportsNativeUpdater ??
    false;

  async function handleOpenExternalLink(url: string, fallbackLabel: string) {
    try {
      await openUrl(url);
    } catch {
      try {
        await copyTextToClipboard(url);
        showToast({
          message: `外部浏览器打开失败，已复制${fallbackLabel}链接。`,
          tone: "warning",
        });
      } catch {
        showToast({
          message: `外部浏览器打开失败，请手动访问${fallbackLabel}链接。`,
          tone: "warning",
        });
      }
    }
  }

  function handleOpenWereadSkill() {
    void handleOpenExternalLink(WEREAD_SKILL_API_KEY_URL, "技能页面");
  }

  function applyAiProviderSettings(provider: AiProviderSettings) {
    setAiBaseUrl(provider.baseUrl);
    setAiModel(provider.model);
    setAiProviderPresetId(normalizeAiProviderPresetId(provider.presetId));
    setAiResponseFormatPolicy(
      normalizeAiResponseFormatPolicy(provider.responseFormatPolicy),
    );
    resetAiProviderModels();
  }

  function handleAiProviderPresetChange(nextPresetId: AiProviderPresetId) {
    const preset = getAiProviderPreset(nextPresetId);
    setAiProviderProbe(undefined);
    resetAiProviderModels();
    setAiProviderPresetId(nextPresetId);
    setAiResponseFormatPolicy(preset.responseFormatPolicy);

    if (nextPresetId === "custom") {
      return;
    }

    setAiBaseUrl(preset.defaultBaseUrl);
    setAiModel(preset.defaultModel);
  }

  function resetAiProviderModels() {
    setAiProviderModels([]);
    setAiProviderModelsFetchedAt(undefined);
    setAiProviderModelMessage(undefined);
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    void loadState();
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (!open || !preferredCategory) {
      return;
    }

    setActiveCategory(preferredCategory);
  }, [open, preferredCategory]);

  useEffect(() => {
    if (!open || activeCategory !== "updates") {
      return;
    }

    onViewAppUpdate?.();
  }, [activeCategory, onViewAppUpdate, open]);

  async function loadState() {
    setIsLoading(true);
    setError(undefined);

    try {
      const [nextState, nextAiState, nextReadingAssistantPreferences] = await Promise.all([
        getSettingsState(),
        getAiSettingsState(),
        getReadingAssistantPreferences(),
      ]);
      setState(nextState);
      setAiState(nextAiState);
      setReadingAssistantPreferences(nextReadingAssistantPreferences);
      applyAiProviderSettings(nextAiState.provider);
      setExportDirectoryInput(nextState.exportData.exportDir);
      setWereadProxyInput(nextState.network.wereadProxyUrl ?? "");
      onCredentialChange(nextState.credential);
    } catch (loadError) {
      setError(getCommandErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSaveCredential() {
    setIsSavingCredential(true);
    setError(undefined);

    try {
      const validation = await validateCredential(apiKey);
      if (!validation.isValid) {
        setError(validation.message || "API Key 格式不正确。");
        return;
      }

      const status = await saveCredential(apiKey);
      onCredentialChange(status);
      setState((current) =>
        current ? { ...current, credential: status } : current,
      );
      setApiKey("");
      showToast({ message: "API Key 已保存到本机安全存储。", tone: "success" });
      void loadState();
    } catch (saveError) {
      setError(getCommandErrorMessage(saveError));
    } finally {
      setIsSavingCredential(false);
    }
  }

  async function handleRemoveCredential() {
    setIsSavingCredential(true);
    setError(undefined);

    try {
      const status = await removeCredential(true);
      onCredentialChange(status);
      setState((current) =>
        current ? { ...current, credential: status } : current,
      );
      showToast({ message: "已移除本机保存的 API Key。", tone: "success" });
      setPendingAction(undefined);
    } catch (removeError) {
      setError(getCommandErrorMessage(removeError));
    } finally {
      setIsSavingCredential(false);
    }
  }

  async function handleSaveAiCredential() {
    setIsSavingAiCredential(true);
    setError(undefined);

    try {
      const trimmedAiKey = aiApiKey.trim();
      if (trimmedAiKey) {
        const validation = await validateAiCredential({
          apiKey: trimmedAiKey,
          baseUrl: aiBaseUrl,
          model: aiModel,
          presetId: aiProviderPresetId,
          responseFormatPolicy: aiResponseFormatPolicy,
        });
        if (!validation.isValid) {
          setError(
            validation.message || "AI API Key 或 Provider 设置格式不正确。",
          );
          return;
        }
      }

      const nextAiState = await saveAiSettings({
        apiKey: trimmedAiKey || undefined,
        baseUrl: aiBaseUrl,
        model: aiModel,
        presetId: aiProviderPresetId,
        responseFormatPolicy: aiResponseFormatPolicy,
      });
      setAiState(nextAiState);
      applyAiProviderSettings(nextAiState.provider);
      setAiProviderProbe(undefined);
      setAiApiKey("");
      showToast({
        message: trimmedAiKey
          ? "AI 设置和新 Key 已保存到本机安全存储。"
          : "AI Provider 设置已保存，已保留原有 AI Key。",
        tone: "success",
      });
    } catch (saveError) {
      setError(getCommandErrorMessage(saveError));
    } finally {
      setIsSavingAiCredential(false);
    }
  }

  async function handleTestAiConnection() {
    setIsTestingAiConnection(true);
    setError(undefined);

    try {
      const validation = await testAiConnection({
        apiKey: aiApiKey.trim() || undefined,
        baseUrl: aiBaseUrl,
        model: aiModel,
        presetId: aiProviderPresetId,
        responseFormatPolicy: aiResponseFormatPolicy,
      });
      if (!validation.isValid) {
        setError(validation.message || "AI Provider 连通性测试失败。");
        return;
      }

      showToast({
        message: validation.message || "AI Provider 连通性测试通过。",
        tone: "success",
      });
    } catch (testError) {
      setError(getCommandErrorMessage(testError));
    } finally {
      setIsTestingAiConnection(false);
    }
  }

  async function handleProbeAiProviderCapabilities() {
    setIsProbingAiProvider(true);
    setAiProviderProbe(undefined);
    setError(undefined);

    try {
      const probe = await probeAiProviderCapabilities({
        apiKey: aiApiKey.trim() || undefined,
        baseUrl: aiBaseUrl,
        model: aiModel,
        presetId: aiProviderPresetId,
        responseFormatPolicy: aiResponseFormatPolicy,
      });
      setAiProviderProbe(probe);
      if (probe.basic === "failed") {
        setError(probe.message || "AI Provider 基础连通性探测失败。");
        return;
      }

      if (probe.recommendedPolicy !== aiResponseFormatPolicy) {
        setAiResponseFormatPolicy(probe.recommendedPolicy);
      }

      showToast({
        message: probe.message || "AI Provider 兼容性探测完成。",
        tone:
          probe.jsonObject === "failed" && probe.jsonSchema === "failed"
            ? "warning"
            : "success",
      });
    } catch (probeError) {
      setError(getCommandErrorMessage(probeError));
    } finally {
      setIsProbingAiProvider(false);
    }
  }

  async function handleRefreshAiProviderModels() {
    setIsRefreshingAiModels(true);
    setAiProviderModelMessage(undefined);
    setError(undefined);

    try {
      const response = await listAiProviderModels({
        apiKey: aiApiKey.trim() || undefined,
        baseUrl: aiBaseUrl,
      });
      setAiProviderModels(response.models);
      setAiProviderModelsFetchedAt(response.fetchedAt);
      setAiProviderModelMessage(response.message);
      if (!aiModel.trim() && response.models[0]?.id) {
        setAiModel(response.models[0].id);
      }

      showToast({
        message:
          response.message ||
          `已获取 ${response.models.length} 个可用模型，仍可手动输入模型名。`,
        tone: response.models.length ? "success" : "warning",
      });
    } catch (modelsError) {
      setAiProviderModelMessage("未能获取模型列表，仍可手动输入模型名。");
      setError(getCommandErrorMessage(modelsError));
    } finally {
      setIsRefreshingAiModels(false);
    }
  }

  async function handleRemoveAiCredential() {
    setIsSavingAiCredential(true);
    setError(undefined);

    try {
      const nextAiState = await removeAiCredential(true);
      setAiState(nextAiState);
      applyAiProviderSettings(nextAiState.provider);
      setAiApiKey("");
      showToast({
        message: "已移除本机保存的 AI API Key。历史 AI 阅读成果缓存不会被删除。",
        tone: "success",
      });
      setPendingAction(undefined);
    } catch (removeError) {
      setError(getCommandErrorMessage(removeError));
    } finally {
      setIsSavingAiCredential(false);
    }
  }

  async function handleSaveReadingAssistantPreferences(
    nextPreferences: ReadingAssistantPreferences,
  ) {
    setReadingAssistantPreferences(nextPreferences);
    setIsSavingReadingAssistantPreferences(true);
    setError(undefined);

    try {
      const saved = await saveReadingAssistantPreferences(nextPreferences);
      setReadingAssistantPreferences(saved);
      showToast({ message: "AI 阅读助手偏好已保存。", tone: "success" });
    } catch (saveError) {
      setError(getCommandErrorMessage(saveError));
    } finally {
      setIsSavingReadingAssistantPreferences(false);
    }
  }

  async function handleClearReadingAssistantHistory() {
    setIsClearingReadingAssistantHistory(true);
    setError(undefined);

    try {
      await clearReadingAssistantHistory();
      showToast({
        message: "AI 阅读助手本地对话历史已清空。",
        tone: "success",
      });
      setPendingAction(undefined);
    } catch (clearError) {
      setError(getCommandErrorMessage(clearError));
    } finally {
      setIsClearingReadingAssistantHistory(false);
    }
  }

  async function handleClearCache() {
    setIsClearingCache(true);
    setError(undefined);

    try {
      const result = await clearLocalCache(true);
      setState(result.state);
      onCredentialChange(result.state.credential);
      onLocalCacheCleared?.();
      showToast({
        message: `已清除 ${result.deletedRows} 条本地缓存记录，API Key 不受影响。`,
        tone: "success",
      });
      setPendingAction(undefined);
    } catch (clearError) {
      setError(getCommandErrorMessage(clearError));
    } finally {
      setIsClearingCache(false);
    }
  }

  async function handleClearAiOutputCache() {
    setIsClearingAiOutputCache(true);
    setError(undefined);

    try {
      const result = await clearAiOutputCache(true);
      setState(result.state);
      onCredentialChange(result.state.credential);
      showToast({
        message: `已清除 ${result.deletedRows} 条 AI 输出缓存，API Key、微信读书缓存和本地阅读状态不受影响。`,
        tone: "success",
      });
      setPendingAction(undefined);
    } catch (clearError) {
      setError(getCommandErrorMessage(clearError));
    } finally {
      setIsClearingAiOutputCache(false);
    }
  }

  async function handleExportDiagnostics() {
    setIsExportingDiagnostics(true);
    setError(undefined);

    try {
      const result = await exportDiagnostics();
      showToast({
        message: `已导出诊断信息：${result.fileName}`,
        tone: "success",
      });
    } catch (exportError) {
      setError(getCommandErrorMessage(exportError));
    } finally {
      setIsExportingDiagnostics(false);
    }
  }

  async function handleCheckForUpdate() {
    setError(undefined);

    try {
      await onCheckForAppUpdate?.();
    } catch (updateError) {
      setError(getCommandErrorMessage(updateError));
    }
  }

  async function handleInstallUpdate() {
    if (!appUpdateStatus?.available) {
      setError("请先检查更新，确认存在可安装的新版本。");
      return;
    }

    setError(undefined);
    setPendingAction(undefined);

    try {
      await onInstallAppUpdate?.();
    } catch (installError) {
      setError(getCommandErrorMessage(installError));
    }
  }

  async function handleExportBackup() {
    setIsExportingBackup(true);
    setError(undefined);

    try {
      const result = await exportLocalDataBackup();
      setLastBackup(result);
      showToast({
        message: `已导出本地备份：${result.backupId}`,
        tone: "success",
      });
    } catch (backupError) {
      setError(getCommandErrorMessage(backupError));
    } finally {
      setIsExportingBackup(false);
    }
  }

  async function handleRestoreBackup() {
    if (!lastBackup?.path) {
      setError("请先导出或选择一个本地备份包。");
      return;
    }

    setIsRestoringBackup(true);
    setError(undefined);

    try {
      const result = await restoreLocalDataBackup(lastBackup.path, true);
      setState(result.state);
      onCredentialChange(result.state.credential);
      onLocalCacheCleared?.();
      showToast({
        message: "已恢复本地数据备份，请重启应用以确保所有页面重新读取数据库。",
        tone: "success",
      });
      setPendingAction(undefined);
    } catch (restoreError) {
      setError(getCommandErrorMessage(restoreError));
    } finally {
      setIsRestoringBackup(false);
    }
  }

  async function handleChooseDataDirectory() {
    setIsChoosingDataDirectory(true);
    setError(undefined);

    try {
      const result = await chooseCustomDataDirectory();
      setState(result.state);
      onCredentialChange(result.state.credential);

      if (!result.path) {
        showToast({ message: "已取消选择数据目录。", tone: "neutral" });
        return;
      }

      setPendingStorageMigration({ targetDir: result.path });
      setPendingAction("migrateDataDirectory");
    } catch (chooseError) {
      setError(getCommandErrorMessage(chooseError));
    } finally {
      setIsChoosingDataDirectory(false);
    }
  }

  async function handleMigrateDataDirectory() {
    if (!pendingStorageMigration?.targetDir) {
      setError("请先通过系统目录选择器选择目标数据目录。");
      return;
    }

    setIsMigratingDataDirectory(true);
    setError(undefined);

    try {
      const result = await migrateLocalDataDirectory(
        pendingStorageMigration.targetDir,
        true,
      );
      setState(result.state);
      onCredentialChange(result.state.credential);
      setPendingStorageMigration(undefined);
      setPendingAction(undefined);
      showToast({
        message:
          "本地数据库已迁移，请重启应用后继续使用。API Key 仍保留在本机安全存储中。",
        tone: "success",
      });
    } catch (migrationError) {
      setError(getCommandErrorMessage(migrationError));
    } finally {
      setIsMigratingDataDirectory(false);
    }
  }

  async function handleChooseExportDirectory() {
    setIsChoosingExportDirectory(true);
    setError(undefined);

    try {
      const result = await chooseCustomExportDirectory();

      if (!result.path) {
        showToast({ message: "已取消选择导出保存位置。", tone: "neutral" });
        return;
      }

      setExportDirectoryInput(result.path);
      showToast({
        message: "已选择导出保存位置，请保存后生效。",
        tone: "neutral",
      });
    } catch (chooseError) {
      setError(getCommandErrorMessage(chooseError));
    } finally {
      setIsChoosingExportDirectory(false);
    }
  }

  async function handleSaveExportDirectory() {
    const targetDir = exportDirectoryInput.trim();
    if (!targetDir) {
      setError("请先选择或输入导出保存位置。");
      return;
    }

    setIsSavingExportDirectory(true);
    setError(undefined);

    try {
      const result = await saveCustomExportDirectory(targetDir);
      setState(result.state);
      setExportDirectoryInput(result.state.exportData.exportDir);
      onCredentialChange(result.state.credential);
      showToast({
        message: "导出保存位置已更新，只影响后续导出文件。",
        tone: "success",
      });
    } catch (saveError) {
      setError(getCommandErrorMessage(saveError));
    } finally {
      setIsSavingExportDirectory(false);
    }
  }

  async function handleResetExportDirectory() {
    setIsResettingExportDirectory(true);
    setError(undefined);

    try {
      const result = await resetCustomExportDirectory();
      setState(result.state);
      setExportDirectoryInput(result.state.exportData.exportDir);
      onCredentialChange(result.state.credential);
      showToast({ message: "已恢复默认导出保存位置。", tone: "success" });
    } catch (resetError) {
      setError(getCommandErrorMessage(resetError));
    } finally {
      setIsResettingExportDirectory(false);
    }
  }

  async function handleSaveWereadProxy() {
    const proxyUrl = wereadProxyInput.trim();
    if (!proxyUrl) {
      setError("请先输入微信读书网络代理地址。");
      return;
    }

    setIsSavingWereadProxy(true);
    setError(undefined);

    try {
      const result = await saveWereadProxyUrl(proxyUrl);
      setState(result.state);
      setWereadProxyInput(result.state.network.wereadProxyUrl ?? "");
      onCredentialChange(result.state.credential);
      showToast({
        message: "微信读书网络代理已保存，后续同步会使用该代理。",
        tone: "success",
      });
    } catch (saveError) {
      setError(getCommandErrorMessage(saveError));
    } finally {
      setIsSavingWereadProxy(false);
    }
  }

  async function handleResetWereadProxy() {
    setIsResettingWereadProxy(true);
    setError(undefined);

    try {
      const result = await resetWereadProxyUrl();
      setState(result.state);
      setWereadProxyInput("");
      onCredentialChange(result.state.credential);
      showToast({
        message: "已恢复微信读书默认网络连接。",
        tone: "success",
      });
    } catch (resetError) {
      setError(getCommandErrorMessage(resetError));
    } finally {
      setIsResettingWereadProxy(false);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div className="settings-modal-backdrop" role="presentation">
      <section
        className="settings-page settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
      >
        <button
          className="settings-modal-close"
          type="button"
          onClick={onClose}
          aria-label="关闭设置"
        >
          <X aria-hidden="true" size={20} />
        </button>
        <aside className="settings-modal-nav" aria-label="设置分类">
          <div className="settings-modal-nav-heading">
            <p className="section-kicker">选项</p>
            <h3>设置</h3>
          </div>
          <nav>
            {settingsCategories.map((category) => {
              const Icon = category.icon;
              const isActive = activeCategory === category.id;

              return (
                <button
                  key={category.id}
                  className={`settings-modal-nav-item ${isActive ? "is-active" : ""}`}
                  type="button"
                  onClick={() => setActiveCategory(category.id)}
                  aria-current={isActive ? "page" : undefined}
                >
                  <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
                  <span>
                    <strong>
                      {category.label}
                      {category.id === "updates" && hasPendingAppUpdate ? (
                        <i className="app-update-badge" aria-hidden="true" />
                      ) : null}
                    </strong>
                    <small>{category.description}</small>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="settings-modal-content">
          <section className="settings-hero">
            <div>
              <p className="section-kicker">本地设置</p>
              <h3>{activeCategoryConfig.label}</h3>
              <p>{activeCategoryConfig.heroDescription}</p>
            </div>
            <div className="settings-hero-actions">
              <button
                className="sync-button settings-refresh-button"
                type="button"
                onClick={() => void loadState()}
                disabled={isLoading}
              >
                {isLoading ? (
                  <Loader2 aria-hidden="true" size={16} className="spin" />
                ) : (
                  <RefreshCw aria-hidden="true" size={16} />
                )}
                刷新状态
              </button>
            </div>
          </section>

          {error ? (
            <div className="status-message status-message--error">
              <AlertCircle aria-hidden="true" size={18} />
              <span>{error}</span>
            </div>
          ) : null}

          <div className="settings-main">
            {activeCategory === "account" ? (
              <SettingsSection title="账户与同步">
                <section
                  className="settings-card settings-panel settings-control-panel credential-card"
                  aria-label="凭据"
                >
                  {!credential?.hasCredential ? (
                    <section
                      className="settings-onboarding-card"
                      aria-label="本地凭据引导"
                    >
                      <img
                        src={onboardingLocalVault}
                        alt=""
                      />
                      <div className="settings-onboarding-copy">
                        <p className="section-kicker">首次绑定</p>
                        <h3>先把凭据安全地留在本机</h3>
                        <p>
                          API Key 来自微信读书 Skill 页面，只保存在当前设备。
                          连接后可以同步书架、读取笔记、回顾统计并导出阅读成果；页面不会显示已保存密钥。
                        </p>
                        <ul className="settings-onboarding-points">
                          <li>绑定后即可同步书架、笔记、统计和发现数据</li>
                          <li>笔记、复盘、路线和导出记录会继续保存在本机</li>
                          <li>移除凭据不会删除已经缓存到本机的阅读数据</li>
                        </ul>
                      </div>
                    </section>
                  ) : null}
                  <div className="settings-card-heading">
                    <span className="settings-icon">
                      <KeyRound aria-hidden="true" size={20} />
                    </span>
                    <div>
                      <p className="section-kicker">API Key</p>
                      <h3>
                        {credential?.hasCredential
                          ? "已保存凭据"
                          : "未保存凭据"}
                      </h3>
                    </div>
                  </div>
                  <p>
                    {credential?.hasCredential
                      ? "凭据仅在本机使用，已缓存内容仍保留在本机。"
                      : "保存微信读书 Skill API Key 后即可同步书架、笔记、统计和发现数据。"}
                  </p>
                  <p className="credential-help-note">
                    会在新窗口打开技能页面；如果被拦截，链接会复制到剪贴板。
                  </p>
                  {state?.credentialError ? (
                    <div className="status-message status-message--warning">
                      <AlertCircle aria-hidden="true" size={18} />
                      <span>
                        {state.credentialError.message}
                        {state.credentialError.detail
                          ? ` 原因：${state.credentialError.detail}`
                          : ""}
                      </span>
                    </div>
                  ) : null}
                  <button
                    className="credential-help-link"
                    type="button"
                    onClick={handleOpenWereadSkill}
                  >
                    <ExternalLink aria-hidden="true" size={16} />
                    获取微信读书 API Key
                  </button>
                  <dl className="settings-dl">
                    <div>
                      <dt>验证时间</dt>
                      <dd>{formatTimestamp(credential?.lastValidatedAt)}</dd>
                    </div>
                    <div>
                      <dt>验证错误</dt>
                      <dd>{credential?.lastValidationError || "无"}</dd>
                    </div>
                  </dl>
                  <div className="settings-control-row">
                    <label className="credential-input">
                      <span>新的 API Key</span>
                      <input
                        value={apiKey}
                        type="password"
                        autoComplete="off"
                        placeholder="粘贴 wrk-...，保存后不会再显示"
                        onChange={(event) => setApiKey(event.target.value)}
                      />
                    </label>
                  </div>
                  <div className="settings-control-row">
                    <label className="credential-input">
                      <span>微信读书网络代理</span>
                      <input
                        value={wereadProxyInput}
                        type="url"
                        autoComplete="off"
                        placeholder="如 http://127.0.0.1:7890 或 socks5://127.0.0.1:1080"
                        onChange={(event) =>
                          setWereadProxyInput(event.target.value)
                        }
                      />
                    </label>
                  </div>
                  <dl className="settings-dl">
                    <div>
                      <dt>代理状态</dt>
                      <dd>
                        {state?.network.isCustomWereadProxy
                          ? "已启用"
                          : "默认网络"}
                      </dd>
                    </div>
                    <div className="wide-row">
                      <dt>作用范围</dt>
                      <dd>仅微信读书同步接口</dd>
                    </div>
                  </dl>
                  <p className="credential-help-note">
                    Android 代理工具通常会提供 HTTP 或 SOCKS 本地端口；如系统代理不生效，可在这里填写对应地址。
                  </p>
                  {aiProviderProbe ? (
                    <section
                      className="ai-provider-probe"
                      aria-label="AI Provider 兼容性探测结果"
                    >
                      <dl className="settings-dl">
                        <div>
                          <dt>基础连通</dt>
                          <dd>
                            {formatAiProviderCapabilityStatus(
                              aiProviderProbe.basic,
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>通用 JSON</dt>
                          <dd>
                            {formatAiProviderCapabilityStatus(
                              aiProviderProbe.jsonObject,
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>严格结构</dt>
                          <dd>
                            {formatAiProviderCapabilityStatus(
                              aiProviderProbe.jsonSchema,
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>建议模式</dt>
                          <dd>
                            {formatAiResponseFormatPolicyLabel(
                              aiProviderProbe.recommendedPolicy,
                            )}
                          </dd>
                        </div>
                      </dl>
                      {aiProviderProbe.message ? (
                        <p>{aiProviderProbe.message}</p>
                      ) : null}
                    </section>
                  ) : null}
                  <div className="settings-actions settings-card-actions">
                    <button
                      className="secondary-action"
                      type="button"
                      onClick={() => void handleSaveCredential()}
                      disabled={isSavingCredential || !apiKey.trim()}
                    >
                      {isSavingCredential ? "保存中" : "保存 API Key"}
                    </button>
                    <button
                      className="sync-button"
                      type="button"
                      onClick={() => setPendingAction("removeCredential")}
                      disabled={
                        !credential?.hasCredential || isSavingCredential
                      }
                    >
                      移除凭据
                    </button>
                  </div>
                  <div className="settings-actions settings-card-actions">
                    <button
                      className="secondary-action"
                      type="button"
                      onClick={() => void handleSaveWereadProxy()}
                      disabled={
                        isSavingWereadProxy ||
                        isResettingWereadProxy ||
                        !wereadProxyInput.trim()
                      }
                    >
                      {isSavingWereadProxy ? "保存中" : "保存代理"}
                    </button>
                    <button
                      className="sync-button"
                      type="button"
                      onClick={() => void handleResetWereadProxy()}
                      disabled={
                        isSavingWereadProxy ||
                        isResettingWereadProxy ||
                        !state?.network.isCustomWereadProxy
                      }
                    >
                      {isResettingWereadProxy ? "重置中" : "重置代理"}
                    </button>
                  </div>
                </section>
              </SettingsSection>
            ) : null}

            {activeCategory === "ai" ? (
              <SettingsSection title="AI 设置">
                <section
                  className="settings-card settings-panel settings-control-panel credential-card ai-settings-card"
                  aria-label="AI 设置"
                >
                  <div className="settings-card-heading">
                    <span className="settings-icon">
                      <Bot aria-hidden="true" size={20} />
                    </span>
                    <div>
                      <p className="section-kicker">AI 阅读成果</p>
                      <h3>
                        {aiState?.credential.hasCredential
                          ? "已配置 AI Provider"
                          : "未配置 AI Provider"}
                      </h3>
                    </div>
                  </div>
                  <p>
                    AI 仅在点击生成时调用配置的 Provider，并使用确认的输入范围。
                  </p>
                  <ul className="settings-onboarding-points">
                    <li>单本复盘只发送当前书的本地划线和想法</li>
                    <li>阅读指南和选书决策只使用你确认的当前书、候选书和本地统计信号</li>
                    <li>已生成结果会保存在本机，后续可查看和导出</li>
                  </ul>
                  <dl className="settings-dl">
                    <div>
                      <dt>验证时间</dt>
                      <dd>
                        {formatTimestamp(aiState?.credential.lastValidatedAt)}
                      </dd>
                    </div>
                    <div>
                      <dt>验证错误</dt>
                      <dd>{aiState?.credential.lastValidationError || "无"}</dd>
                    </div>
                  </dl>
                  <div className="settings-form-grid">
                    <label className="credential-input">
                      <span>Provider 预设</span>
                      <select
                        value={aiProviderPresetId}
                        onChange={(event) =>
                          handleAiProviderPresetChange(
                            normalizeAiProviderPresetId(event.target.value),
                          )
                        }
                      >
                        {AI_PROVIDER_PRESETS.map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="credential-input">
                      <span>兼容模式</span>
                      <select
                        value={aiResponseFormatPolicy}
                        onChange={(event) => {
                          setAiProviderProbe(undefined);
                          setAiResponseFormatPolicy(
                            normalizeAiResponseFormatPolicy(event.target.value),
                          );
                        }}
                      >
                        {AI_RESPONSE_FORMAT_POLICY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="credential-input">
                      <span>Base URL</span>
                      <input
                        value={aiBaseUrl}
                        type="url"
                        autoComplete="off"
                        placeholder="https://api.openai.com/v1"
                        onChange={(event) => {
                          setAiProviderProbe(undefined);
                          resetAiProviderModels();
                          setAiBaseUrl(event.target.value);
                        }}
                      />
                    </label>
                    <label className="credential-input settings-form-span">
                      <span>模型</span>
                      <div className="ai-model-control">
                        <input
                          value={aiModel}
                          type="text"
                          autoComplete="off"
                          placeholder="输入模型名，或刷新后从候选中选择"
                          onChange={(event) => {
                            setAiProviderProbe(undefined);
                            setAiModel(event.target.value);
                          }}
                        />
                        <button
                          className="sync-button"
                          type="button"
                          onClick={() => void handleRefreshAiProviderModels()}
                          disabled={
                            isRefreshingAiModels ||
                            isSavingAiCredential ||
                            isTestingAiConnection ||
                            isProbingAiProvider ||
                            !aiBaseUrl.trim() ||
                            (!aiApiKey.trim() &&
                              !aiState?.credential.hasCredential)
                          }
                        >
                          {isRefreshingAiModels ? (
                            <Loader2
                              aria-hidden="true"
                              size={18}
                              className="spin"
                            />
                          ) : (
                            <RefreshCw aria-hidden="true" size={18} />
                          )}
                          {isRefreshingAiModels ? "刷新中" : "刷新可用模型"}
                        </button>
                      </div>
                      {aiProviderModels.length || aiProviderModelMessage ? (
                        <small className="credential-help-note">
                          {aiProviderModelMessage ||
                            `已获取 ${aiProviderModels.length} 个模型，可选择或继续手动输入。`}
                          {aiProviderModelsFetchedAt
                            ? ` ${formatTimestamp(aiProviderModelsFetchedAt)}`
                            : ""}
                        </small>
                      ) : null}
                      {aiProviderModels.length ? (
                        <div
                          className="ai-model-option-list"
                          aria-label="可用模型候选"
                        >
                          {aiProviderModels.map((model) => (
                            <button
                              key={model.id}
                              className="ai-model-option"
                              type="button"
                              aria-pressed={model.id === aiModel}
                              title={model.ownedBy ?? model.id}
                              onClick={() => {
                                setAiProviderProbe(undefined);
                                setAiModel(model.id);
                              }}
                            >
                              <span>{model.id}</span>
                              {model.ownedBy ? <small>{model.ownedBy}</small> : null}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </label>
                    <label className="credential-input settings-form-span">
                      <span>新的 AI API Key</span>
                      <input
                        value={aiApiKey}
                        type="password"
                        autoComplete="off"
                        placeholder={
                          aiState?.credential.hasCredential
                            ? "已保存，留空则不更改"
                            : "粘贴 Provider Key，保存后不会再显示"
                        }
                        onChange={(event) => setAiApiKey(event.target.value)}
                      />
                    </label>
                  </div>
                  <div className="settings-actions settings-card-actions">
                    <button
                      className="secondary-action"
                      type="button"
                      onClick={() => void handleSaveAiCredential()}
                      disabled={
                        isSavingAiCredential ||
                        isRefreshingAiModels ||
                        !aiBaseUrl.trim() ||
                        !aiModel.trim()
                      }
                    >
                      {isSavingAiCredential ? "保存中" : "保存 AI 设置"}
                    </button>
                    <button
                      className="sync-button"
                      type="button"
                      onClick={() => void handleTestAiConnection()}
                      disabled={
                        isTestingAiConnection ||
                        isProbingAiProvider ||
                        isRefreshingAiModels ||
                        isSavingAiCredential ||
                        !aiBaseUrl.trim() ||
                        !aiModel.trim() ||
                        (!aiApiKey.trim() && !aiState?.credential.hasCredential)
                      }
                    >
                      {isTestingAiConnection ? (
                        <Loader2
                          aria-hidden="true"
                          size={18}
                          className="spin"
                        />
                      ) : (
                        <RefreshCw aria-hidden="true" size={18} />
                      )}
                      {isTestingAiConnection ? "测试中" : "测试连通性"}
                    </button>
                    <button
                      className="sync-button"
                      type="button"
                      onClick={() => void handleProbeAiProviderCapabilities()}
                      disabled={
                        isProbingAiProvider ||
                        isTestingAiConnection ||
                        isRefreshingAiModels ||
                        isSavingAiCredential ||
                        !aiBaseUrl.trim() ||
                        !aiModel.trim() ||
                        (!aiApiKey.trim() && !aiState?.credential.hasCredential)
                      }
                    >
                      {isProbingAiProvider ? (
                        <Loader2
                          aria-hidden="true"
                          size={18}
                          className="spin"
                        />
                      ) : (
                        <ShieldCheck aria-hidden="true" size={18} />
                      )}
                      {isProbingAiProvider ? "探测中" : "测试兼容性"}
                    </button>
                    <button
                      className="sync-button"
                      type="button"
                      onClick={() => setPendingAction("removeAiCredential")}
                      disabled={
                        !aiState?.credential.hasCredential ||
                        isSavingAiCredential ||
                        isTestingAiConnection ||
                        isProbingAiProvider ||
                        isRefreshingAiModels
                      }
                    >
                      移除 AI Key
                    </button>
                  </div>
                </section>
                <section
                  className="settings-card settings-panel settings-control-panel reading-assistant-settings-card"
                  aria-label="AI 阅读助手"
                >
                  <div className="settings-card-heading">
                    <span className="settings-icon">
                      <MessageSquare aria-hidden="true" size={20} />
                    </span>
                    <div>
                      <p className="section-kicker">对话助手</p>
                      <h3>上下文与历史</h3>
                    </div>
                  </div>
                  <div className="reading-assistant-settings-grid">
                    <label>
                      <input
                        type="checkbox"
                        checked={readingAssistantPreferences.usePersonalizedContext}
                        onChange={(event) =>
                          void handleSaveReadingAssistantPreferences({
                            ...readingAssistantPreferences,
                            usePersonalizedContext: event.currentTarget.checked,
                          })
                        }
                        disabled={isSavingReadingAssistantPreferences}
                      />
                      <span>
                        <strong>个性化上下文</strong>
                        <small>当前书、统计、候选和 AI 资产摘要</small>
                      </span>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={readingAssistantPreferences.allowRawBookNotes}
                        onChange={(event) =>
                          void handleSaveReadingAssistantPreferences({
                            ...readingAssistantPreferences,
                            allowRawBookNotes: event.currentTarget.checked,
                          })
                        }
                        disabled={
                          isSavingReadingAssistantPreferences ||
                          !readingAssistantPreferences.usePersonalizedContext
                        }
                      />
                      <span>
                        <strong>原始笔记片段</strong>
                        <small>仅在手动打开后用于当前书提问</small>
                      </span>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={readingAssistantPreferences.saveConversationHistory}
                        onChange={(event) =>
                          void handleSaveReadingAssistantPreferences({
                            ...readingAssistantPreferences,
                            saveConversationHistory: event.currentTarget.checked,
                          })
                        }
                        disabled={isSavingReadingAssistantPreferences}
                      />
                      <span>
                        <strong>保存对话历史</strong>
                        <small>只保存本地线程和消息</small>
                      </span>
                    </label>
                  </div>
                  <div className="settings-actions settings-card-actions">
                    <button
                      className="sync-button"
                      type="button"
                      onClick={() => setPendingAction("clearReadingAssistantHistory")}
                      disabled={isClearingReadingAssistantHistory}
                    >
                      {isClearingReadingAssistantHistory ? (
                        <Loader2 aria-hidden="true" size={18} className="spin" />
                      ) : (
                        <Trash2 aria-hidden="true" size={18} />
                      )}
                      {isClearingReadingAssistantHistory ? "清空中" : "清空对话历史"}
                    </button>
                  </div>
                </section>
              </SettingsSection>
            ) : null}

            {activeCategory === "appearance" ? (
              <SettingsSection title="外观与使用偏好">
                <section
                  className="settings-card settings-panel settings-control-panel settings-preference-card"
                  aria-label="外观与使用偏好"
                >
                  <div className="settings-card-heading">
                    <span className="settings-icon">
                      <Eye aria-hidden="true" size={20} />
                    </span>
                    <div>
                      <p className="section-kicker">偏好</p>
                      <h3>显示与默认行为</h3>
                    </div>
                  </div>
                  <p>
                    这些设置只影响当前设备上的显示方式和默认打开位置，不会改动你的阅读数据。
                  </p>
                  <div className="settings-select-grid">
                    <PreferenceSelect
                      label="主题模式"
                      value={preferences.themeMode}
                      onChange={(value) =>
                        onPreferencesChange({
                          ...preferences,
                          themeMode: value as UserPreferences["themeMode"],
                        })
                      }
                      options={[
                        { value: "system", label: "跟随系统" },
                        { value: "light", label: "浅色" },
                        { value: "dark", label: "暗色" },
                      ]}
                    />
                    <PreferenceSelect
                      label="字体大小"
                      value={preferences.fontScale}
                      onChange={(value) =>
                        onPreferencesChange({
                          ...preferences,
                          fontScale: value as UserPreferences["fontScale"],
                        })
                      }
                      options={[
                        { value: "normal", label: "标准" },
                        { value: "large", label: "大号" },
                        { value: "extraLarge", label: "特大" },
                      ]}
                    />
                    <PreferenceSelect
                      label="信息密度"
                      value={preferences.density}
                      onChange={(value) =>
                        onPreferencesChange({
                          ...preferences,
                          density: value as UserPreferences["density"],
                        })
                      }
                      options={[
                        { value: "comfortable", label: "舒适" },
                        { value: "compact", label: "紧凑" },
                      ]}
                    />
                    <PreferenceSelect
                      label="默认启动页"
                      value={preferences.defaultStartPage}
                      onChange={(value) =>
                        onPreferencesChange({
                          ...preferences,
                          defaultStartPage:
                            value as UserPreferences["defaultStartPage"],
                        })
                      }
                      options={[
                        { value: "dashboard", label: "总览" },
                        { value: "shelf", label: "书架" },
                        { value: "notes", label: "笔记" },
                        { value: "stats", label: "统计" },
                        { value: "readingReview", label: "复盘" },
                        { value: "discovery", label: "发现" },
                      ]}
                    />
                    <PreferenceSelect
                      label="默认单本笔记视图"
                      value={preferences.defaultNotesView}
                      onChange={(value) =>
                        onPreferencesChange({
                          ...preferences,
                          defaultNotesView:
                            value as UserPreferences["defaultNotesView"],
                        })
                      }
                      options={[
                        { value: "list", label: "章节" },
                        { value: "cards", label: "卡片" },
                      ]}
                    />
                    <PreferenceSelect
                      label="默认统计周期"
                      value={preferences.defaultStatsPeriod}
                      onChange={(value) =>
                        onPreferencesChange({
                          ...preferences,
                          defaultStatsPeriod:
                            value as UserPreferences["defaultStatsPeriod"],
                        })
                      }
                      options={[
                        { value: "weekly", label: "本周" },
                        { value: "monthly", label: "本月" },
                        { value: "annually", label: "今年" },
                        { value: "overall", label: "总计" },
                      ]}
                    />
                  </div>
                </section>
              </SettingsSection>
            ) : null}

            {activeCategory === "export" ? (
              <SettingsSection title="导出设置">
                <section
                  className="settings-card settings-panel settings-control-panel settings-export-panel"
                  aria-label="导出保存位置"
                >
                  <div className="settings-card-heading">
                    <span className="settings-icon">
                      <Download aria-hidden="true" size={20} />
                    </span>
                    <div>
                      <p className="section-kicker">导出</p>
                      <h3>导出保存位置</h3>
                    </div>
                  </div>
                  <p>
                    用于笔记
                    Markdown、批量导出、书籍复盘和诊断信息。修改后只影响新的导出文件，不移动历史导出内容。
                  </p>
                  <dl className="settings-dl path-dl">
                    <div className="wide-row">
                      <dt>当前导出目录</dt>
                      <dd title={state?.exportData.exportDir}>
                        {state?.exportData.exportDir || "尚未读取"}
                      </dd>
                    </div>
                    <div className="wide-row">
                      <dt>默认导出目录</dt>
                      <dd title={state?.exportData.defaultExportDir}>
                        {state?.exportData.defaultExportDir || "尚未读取"}
                      </dd>
                    </div>
                    <div>
                      <dt>位置类型</dt>
                      <dd>
                        {state?.exportData.isCustomExportDir
                          ? "自定义目录"
                          : "默认目录"}
                      </dd>
                    </div>
                    <div>
                      <dt>生效范围</dt>
                      <dd>后续导出</dd>
                    </div>
                  </dl>
                  <div className="settings-control-row">
                    <label className="credential-input">
                      <span>手动输入目录（可选兜底）</span>
                      <input
                        value={exportDirectoryInput}
                        type="text"
                        autoComplete="off"
                        placeholder="例如 D:/wxreadmaster-exports"
                        onChange={(event) =>
                          setExportDirectoryInput(event.target.value)
                        }
                      />
                    </label>
                  </div>
                  <div className="settings-actions settings-card-actions">
                    <button
                      className="secondary-action"
                      type="button"
                      onClick={() => void handleChooseExportDirectory()}
                      disabled={
                        isChoosingExportDirectory ||
                        isSavingExportDirectory ||
                        isResettingExportDirectory ||
                        isLoading
                      }
                    >
                      {isChoosingExportDirectory ? (
                        <Loader2
                          aria-hidden="true"
                          size={18}
                          className="spin"
                        />
                      ) : (
                        <FolderOpen aria-hidden="true" size={18} />
                      )}
                      {isChoosingExportDirectory ? "选择中" : "选择导出目录"}
                    </button>
                    <button
                      className="sync-button"
                      type="button"
                      onClick={() => void handleSaveExportDirectory()}
                      disabled={
                        isChoosingExportDirectory ||
                        isSavingExportDirectory ||
                        isResettingExportDirectory ||
                        !exportDirectoryInput.trim()
                      }
                    >
                      {isSavingExportDirectory ? (
                        <Loader2
                          aria-hidden="true"
                          size={18}
                          className="spin"
                        />
                      ) : (
                        <ShieldCheck aria-hidden="true" size={18} />
                      )}
                      {isSavingExportDirectory ? "保存中" : "保存导出目录"}
                    </button>
                    <button
                      className="sync-button"
                      type="button"
                      onClick={() => void handleResetExportDirectory()}
                      disabled={
                        isChoosingExportDirectory ||
                        isSavingExportDirectory ||
                        isResettingExportDirectory ||
                        !state?.exportData.isCustomExportDir
                      }
                    >
                      {isResettingExportDirectory ? "恢复中" : "恢复默认"}
                    </button>
                  </div>
                </section>
              </SettingsSection>
            ) : null}

            {activeCategory === "updates" ? (
              <SettingsSection title="应用更新">
                <section
                  className="settings-card settings-panel settings-control-panel settings-update-card"
                  aria-label="应用更新"
                >
                  <div className="settings-card-heading">
                    <span className="settings-icon">
                      <Sparkles aria-hidden="true" size={20} />
                    </span>
                    <div>
                      <p className="section-kicker">版本更新</p>
                      <h3>本地阅读工作台更新</h3>
                    </div>
                  </div>
                  <p>
                    先核对版本、发布时间和更新摘要，再决定是否安装。更新包来自 GitHub Releases，
                    会在下载前后执行签名校验。
                  </p>
                  <dl className="settings-dl settings-update-meta">
                    <div>
                      <dt>当前版本</dt>
                      <dd>
                        {state?.appVersion ||
                          appUpdateStatus?.currentVersion ||
                          "尚未读取"}
                      </dd>
                    </div>
                    <div>
                      <dt>检查结果</dt>
                      <dd>
                        {renderUpdateSummary(
                          appUpdateStatus,
                          supportsNativeUpdater
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>最新版本</dt>
                      <dd>{appUpdateStatus?.latestVersion || "尚未检查"}</dd>
                    </div>
                    <div>
                      <dt>发布时间</dt>
                      <dd>
                        {formatReleaseDate(appUpdateStatus?.publishedAt)}
                      </dd>
                    </div>
                    <div>
                      <dt>作者</dt>
                      <dd className="update-link-cell">
                        <button
                          className="inline-link-button"
                          type="button"
                          onClick={() =>
                            void handleOpenExternalLink(
                              APP_UPDATE_RELEASE_AUTHOR_URL,
                              "作者主页"
                            )
                          }
                        >
                          作者 @{APP_UPDATE_RELEASE_AUTHOR}
                          <ExternalLink aria-hidden="true" size={14} />
                        </button>
                      </dd>
                    </div>
                    <div>
                      <dt>项目地址</dt>
                      <dd className="update-link-cell">
                        <button
                          className="inline-link-button"
                          type="button"
                          onClick={() =>
                            void handleOpenExternalLink(
                              APP_UPDATE_RELEASE_REPOSITORY_URL,
                              "项目地址"
                            )
                          }
                        >
                          RHZHZ/wereadmaster
                          <ExternalLink aria-hidden="true" size={14} />
                        </button>
                      </dd>
                    </div>
                    <div className="wide-row">
                      <dt>更新源</dt>
                      <dd title={APP_UPDATE_RELEASE_FEED_URL}>{APP_UPDATE_RELEASE_FEED_URL}</dd>
                    </div>
                  </dl>
                  <section
                    className="settings-update-notes"
                    aria-label="更新摘要"
                  >
                    <div className="settings-update-notes-heading">
                      <Info aria-hidden="true" size={16} />
                      <strong>更新摘要</strong>
                    </div>
                    <AppUpdateNotes
                      notes={appUpdateStatus?.notes}
                      emptyText="检查到新版本后，这里会显示这次版本带来的改动和影响范围。"
                    />
                  </section>
                  {state && !supportsNativeUpdater ? (
                    <div className="status-message status-message--actionable">
                      <Info aria-hidden="true" size={18} />
                      <span>
                        当前平台暂不支持应用内下载安装。请前往 GitHub Release 页面下载最新 APK
                        或安装包。
                      </span>
                    </div>
                  ) : null}
                  {appUpdateProgressLabel ? (
                    <div className="status-message status-message--actionable">
                      <Download aria-hidden="true" size={18} />
                      <span>{appUpdateProgressLabel}</span>
                    </div>
                  ) : null}
                  <div className="settings-actions settings-card-actions">
                    <button
                      className="secondary-action"
                      type="button"
                      onClick={() => void handleCheckForUpdate()}
                      disabled={
                        isCheckingForAppUpdate ||
                        isInstallingAppUpdate ||
                        isLoading ||
                        !state
                      }
                    >
                      {isCheckingForAppUpdate ? (
                        <Loader2
                          aria-hidden="true"
                          size={18}
                          className="spin"
                        />
                      ) : (
                        <Sparkles aria-hidden="true" size={18} />
                      )}
                      {supportsNativeUpdater
                        ? isCheckingForAppUpdate
                          ? "检查中"
                          : "检查更新"
                        : isCheckingForAppUpdate
                          ? "检查中"
                          : "检查更新"}
                    </button>
                    <button
                      className="sync-button"
                      type="button"
                      onClick={() =>
                        supportsNativeUpdater
                          ? setPendingAction("installUpdate")
                          : void handleOpenExternalLink(
                              APP_UPDATE_RELEASE_PAGE_URL,
                              "发布页"
                            )
                      }
                      disabled={
                        !state ||
                        (supportsNativeUpdater
                          ? !appUpdateStatus?.available ||
                            isCheckingForAppUpdate ||
                            isInstallingAppUpdate
                          : false)
                      }
                    >
                      {supportsNativeUpdater
                        ? isInstallingAppUpdate
                          ? "安装中"
                          : "安装更新"
                        : "前往下载"}
                    </button>
                  </div>
                </section>
              </SettingsSection>
            ) : null}

            {activeCategory === "support" ? (
              <SettingsSection title="关于与支持">
                <section
                  className="settings-card settings-panel settings-control-panel settings-support-intro-card"
                  aria-label="关于与支持说明"
                >
                  <div className="settings-card-heading">
                    <span className="settings-icon">
                      <HeartHandshake aria-hidden="true" size={20} />
                    </span>
                    <div>
                      <p className="section-kicker">开源项目</p>
                      <h3>开源项目，感谢支持</h3>
                    </div>
                  </div>
                  <p>
                    这个工具会继续围绕本地阅读管理、复盘和导出体验迭代。赞赏完全自愿，不会解锁额外功能，也不会影响本地数据。
                  </p>
                  <p>
                    项目代码和安装包仍以 GitHub Releases 为准；问题反馈建议优先走 GitHub Issue，私下交流可扫码联系作者。
                  </p>
                  <div className="settings-actions settings-card-actions">
                    <button
                      className="secondary-action"
                      type="button"
                      onClick={() =>
                        void handleOpenExternalLink(
                          APP_UPDATE_RELEASE_REPOSITORY_URL,
                          "项目地址"
                        )
                      }
                    >
                      <Github aria-hidden="true" size={18} />
                      访问 GitHub
                    </button>
                    <button
                      className="sync-button"
                      type="button"
                      onClick={() => setActiveCategory("updates")}
                    >
                      <Sparkles aria-hidden="true" size={18} />
                      查看更新
                    </button>
                  </div>
                </section>

                <div className="settings-support-grid">
                  <section className="settings-card settings-support-card" aria-label="赞赏作者">
                    <div className="settings-card-heading">
                      <span className="settings-icon settings-support-icon">
                        <HeartHandshake aria-hidden="true" size={20} />
                      </span>
                      <div>
                        <p className="section-kicker">自愿支持</p>
                        <h3>赞赏作者</h3>
                      </div>
                    </div>
                    <p>如果这个工具节省了你的整理时间，可以扫码自愿支持维护。</p>
                    <figure className="settings-support-qr-frame">
                      <img
                        className="settings-support-qr"
                        src={authorRewardCode}
                        alt="RHZ 的赞赏码"
                      />
                    </figure>
                    <p className="settings-support-note">
                      赞赏不会解锁功能，应用也不会记录或校验赞赏状态。
                    </p>
                  </section>

                  <section className="settings-card settings-support-card" aria-label="联系作者">
                    <div className="settings-card-heading">
                      <span className="settings-icon">
                        <MessageSquare aria-hidden="true" size={20} />
                      </span>
                      <div>
                        <p className="section-kicker">反馈交流</p>
                        <h3>联系作者</h3>
                      </div>
                    </div>
                    <p>扫码添加作者，适合反馈使用问题、交流需求或提供复现信息。</p>
                    <figure className="settings-support-qr-frame">
                      <img
                        className="settings-support-qr settings-support-qr--contact"
                        src={authorContactCode}
                        alt="RHZ 微信联系方式二维码"
                      />
                    </figure>
                    <p className="settings-support-note">
                      添加好友是你主动在微信中完成的操作，应用不会读取或上传联系人信息。
                    </p>
                  </section>
                </div>
              </SettingsSection>
            ) : null}
          </div>

          {activeCategory === "advanced" ? (
            <section
              className="settings-advanced-layout"
              aria-label="高级维护"
            >
              <div className="settings-grid settings-maintenance-grid">
                <section
                  className="settings-card settings-maintenance-card"
                  aria-label="本地缓存"
                >
                  <div className="settings-card-heading">
                    <span className="settings-icon">
                      <Database aria-hidden="true" size={20} />
                    </span>
                    <div>
                      <p className="section-kicker">本地缓存</p>
                      <h3>
                        {state?.localData.cacheRowCount ?? 0} 条缓存记录
                      </h3>
                    </div>
                  </div>
                  <p>
                    清除缓存会删除已同步的书架、详情、笔记、统计、发现缓存和同步状态，但不会移除
                    API Key。
                  </p>
                  <dl className="settings-dl">
                    <div>
                      <dt>数据库大小</dt>
                      <dd>
                        {formatBytes(state?.localData.databaseSizeBytes ?? 0)}
                      </dd>
                    </div>
                    <div>
                      <dt>应用版本</dt>
                      <dd>{state?.appVersion ?? "0.1.0"}</dd>
                    </div>
                  </dl>
                  <div className="settings-actions settings-card-actions">
                    <button
                      className="secondary-action"
                      type="button"
                      onClick={() => setPendingAction("clearAiOutputCache")}
                      disabled={isClearingAiOutputCache}
                    >
                      {isClearingAiOutputCache ? (
                        <Loader2
                          aria-hidden="true"
                          size={18}
                          className="spin"
                        />
                      ) : (
                        <Bot aria-hidden="true" size={18} />
                      )}
                      {isClearingAiOutputCache
                        ? "清理中"
                        : "清除 AI 输出缓存"}
                    </button>
                    <button
                      className="secondary-action danger-action"
                      type="button"
                      onClick={() => setPendingAction("clearCache")}
                      disabled={isClearingCache || isClearingAiOutputCache}
                    >
                      <Trash2 aria-hidden="true" size={18} />
                      清除本地缓存
                    </button>
                  </div>
                </section>

                <section
                  className="settings-card settings-maintenance-card"
                  aria-label="本地数据备份"
                >
                  <div className="settings-card-heading">
                    <span className="settings-icon">
                      <HardDrive aria-hidden="true" size={20} />
                    </span>
                    <div>
                      <p className="section-kicker">备份与恢复</p>
                      <h3>本地数据备份</h3>
                    </div>
                  </div>
                  <p>
                    备份只包含本地 SQLite 数据库及 WAL/SHM
                    辅助文件，不包含微信读书 API Key、AI API Key
                    或安全存储文件。
                  </p>
                  <dl className="settings-dl">
                    <div className="wide-row">
                      <dt>最近备份</dt>
                      <dd>{lastBackup?.path || "尚未导出"}</dd>
                    </div>
                    <div>
                      <dt>包含文件</dt>
                      <dd>
                        {lastBackup?.files.length
                          ? lastBackup.files.join("、")
                          : "无"}
                      </dd>
                    </div>
                    <div>
                      <dt>恢复策略</dt>
                      <dd>验证后替换，失败回滚</dd>
                    </div>
                  </dl>
                  <div className="settings-actions settings-card-actions">
                    <button
                      className="secondary-action"
                      type="button"
                      onClick={() => void handleExportBackup()}
                      disabled={isExportingBackup || isRestoringBackup}
                    >
                      {isExportingBackup ? (
                        <Loader2
                          aria-hidden="true"
                          size={18}
                          className="spin"
                        />
                      ) : (
                        <Download aria-hidden="true" size={18} />
                      )}
                      {isExportingBackup ? "导出中" : "导出本地备份"}
                    </button>
                    <button
                      className="sync-button"
                      type="button"
                      onClick={() => setPendingAction("restoreBackup")}
                      disabled={
                        !lastBackup?.path ||
                        isExportingBackup ||
                        isRestoringBackup
                      }
                    >
                      {isRestoringBackup ? "恢复中" : "恢复最近备份"}
                    </button>
                  </div>
                </section>

                <section
                  className="settings-card settings-maintenance-card"
                  aria-label="本地数据库位置"
                >
                  <div className="settings-card-heading">
                    <span className="settings-icon">
                      <FolderOpen aria-hidden="true" size={20} />
                    </span>
                    <div>
                      <p className="section-kicker">高级</p>
                      <h3>本地数据库位置</h3>
                    </div>
                  </div>
                  <p>
                    仅通过系统目录选择器迁移本地 SQLite 数据库及 WAL/SHM
                    文件；微信读书 API Key 和 AI API Key
                    仍保留在本机安全存储中，不会随数据库目录移动。
                  </p>
                  <dl className="settings-dl path-dl">
                    <div className="wide-row">
                      <dt>当前数据目录</dt>
                      <dd title={state?.localData.dataDir}>
                        {state?.localData.dataDir || "尚未读取"}
                      </dd>
                    </div>
                    <div className="wide-row">
                      <dt>默认数据目录</dt>
                      <dd title={state?.localData.defaultDataDir}>
                        {state?.localData.defaultDataDir || "尚未读取"}
                      </dd>
                    </div>
                    <div>
                      <dt>位置类型</dt>
                      <dd>
                        {state?.localData.isCustomDataDir
                          ? "自定义目录"
                          : "默认目录"}
                      </dd>
                    </div>
                    <div>
                      <dt>迁移后</dt>
                      <dd>需要重启应用</dd>
                    </div>
                  </dl>
                  <div className="settings-actions settings-card-actions">
                    <button
                      className="secondary-action"
                      type="button"
                      onClick={() => void handleChooseDataDirectory()}
                      disabled={
                        isChoosingDataDirectory || isMigratingDataDirectory
                      }
                    >
                      {isChoosingDataDirectory ? (
                        <Loader2
                          aria-hidden="true"
                          size={18}
                          className="spin"
                        />
                      ) : (
                        <FolderOpen aria-hidden="true" size={18} />
                      )}
                      {isChoosingDataDirectory ? "选择中" : "选择并迁移目录"}
                    </button>
                  </div>
                </section>
              </div>

              <section
                className={`settings-diagnostics ${showDiagnostics ? "is-open" : ""}`}
                aria-label="本地诊断"
              >
                <div className="settings-diagnostics-heading">
                  <div>
                    <p className="section-kicker">本地诊断</p>
                    <h3>同步状态、数据库路径和表记录数</h3>
                    <p>
                      这些信息用于排查本机缓存问题，默认收起，避免干扰日常设置。
                    </p>
                  </div>
                  <div className="settings-diagnostics-actions">
                    {showDiagnostics ? (
                      <button
                        className="secondary-action"
                        type="button"
                        onClick={() => void handleExportDiagnostics()}
                        disabled={isExportingDiagnostics || isLoading}
                      >
                        {isExportingDiagnostics ? (
                          <Loader2
                            aria-hidden="true"
                            size={18}
                            className="spin"
                          />
                        ) : (
                          <Download aria-hidden="true" size={18} />
                        )}
                        {isExportingDiagnostics ? "导出中" : "导出诊断信息"}
                      </button>
                    ) : null}
                    <button
                      className="sync-button"
                      type="button"
                      onClick={() =>
                        setShowDiagnostics((current) => !current)
                      }
                    >
                      <ChevronDown
                        aria-hidden="true"
                        size={18}
                        className={showDiagnostics ? "rotate-180" : ""}
                      />
                      {showDiagnostics ? "收起" : "展开"}
                    </button>
                  </div>
                </div>

                {showDiagnostics ? (
                  <div className="settings-diagnostics-grid">
                    <section
                      className="settings-card"
                      aria-label="数据库路径"
                    >
                      <div className="settings-card-heading">
                        <span className="settings-icon">
                          <HardDrive aria-hidden="true" size={20} />
                        </span>
                        <div>
                          <p className="section-kicker">路径</p>
                          <h3>本地数据位置</h3>
                        </div>
                      </div>
                      <dl className="settings-dl">
                        <div className="wide-row">
                          <dt>数据目录</dt>
                          <dd>{state?.localData.dataDir || "尚未读取"}</dd>
                        </div>
                        <div className="wide-row">
                          <dt>默认目录</dt>
                          <dd>
                            {state?.localData.defaultDataDir || "尚未读取"}
                          </dd>
                        </div>
                        <div className="wide-row">
                          <dt>数据库文件</dt>
                          <dd>
                            {state?.localData.databasePath || "尚未读取"}
                          </dd>
                        </div>
                        <div>
                          <dt>自定义位置</dt>
                          <dd>
                            {state?.localData.isCustomDataDir
                              ? "已启用"
                              : "未启用"}
                          </dd>
                        </div>
                        <div className="wide-row">
                          <dt>最近迁移/恢复错误</dt>
                          <dd>
                            {state?.localData.lastDataOperationError || "无"}
                          </dd>
                        </div>
                      </dl>
                    </section>

                    <section className="settings-card" aria-label="同步状态">
                      <div className="settings-card-heading">
                        <span className="settings-icon">
                          <ShieldCheck aria-hidden="true" size={20} />
                        </span>
                        <div>
                          <p className="section-kicker">同步状态</p>
                          <h3>各模块最近同步情况</h3>
                        </div>
                      </div>
                      {state?.syncStates.length ? (
                        <div className="sync-state-list">
                          {state.syncStates.map((item) => (
                            <SyncStateRow key={item.section} state={item} />
                          ))}
                        </div>
                      ) : (
                        <section className="empty-inline settings-empty">
                          <HardDrive aria-hidden="true" size={28} />
                          <h3>还没有同步记录</h3>
                          <p>
                            完成一次书架、笔记、统计或发现同步后，这里会显示本地状态。
                          </p>
                        </section>
                      )}
                    </section>

                    <section
                      className="settings-card settings-diagnostics-table-card"
                      aria-label="缓存表"
                    >
                      <div className="settings-card-heading">
                        <div>
                          <p className="section-kicker">缓存明细</p>
                          <h3>本地表记录数</h3>
                        </div>
                      </div>
                      <div className="cache-table-grid">
                        {(state?.localData.tableCounts ?? []).map((item) => (
                          <article key={item.table}>
                            <span>{tableLabel(item.table)}</span>
                            <strong>{item.rowCount}</strong>
                          </article>
                        ))}
                      </div>
                    </section>
                  </div>
                ) : null}
              </section>
            </section>
          ) : null}

          <ConfirmDialog
            open={pendingAction === "removeCredential"}
            title="确认移除 API Key？"
            description="移除后将无法继续同步微信读书数据，已缓存的本地阅读数据不会被删除。"
            confirmLabel="确认移除"
            isDanger
            isBusy={isSavingCredential}
            onCancel={() => setPendingAction(undefined)}
            onConfirm={() => void handleRemoveCredential()}
          />
          <ConfirmDialog
            open={pendingAction === "removeAiCredential"}
            title="确认移除 AI API Key？"
            description="移除后将无法生成新的 AI 阅读成果。已缓存的书籍复盘、阅读报告和阅读指南不会被删除，清除本地缓存时才会删除。"
            confirmLabel="确认移除"
            isDanger
            isBusy={isSavingAiCredential}
            onCancel={() => setPendingAction(undefined)}
            onConfirm={() => void handleRemoveAiCredential()}
          />
          <ConfirmDialog
            open={pendingAction === "clearCache"}
            title="确认清除本地缓存？"
            description="这会删除书架、详情、笔记、统计、发现缓存和同步状态。API Key 会保留，后续可以重新同步。"
            confirmLabel="确认清除"
            isDanger
            isBusy={isClearingCache}
            onCancel={() => setPendingAction(undefined)}
            onConfirm={() => void handleClearCache()}
          />
          <ConfirmDialog
            open={pendingAction === "clearAiOutputCache"}
            title="确认清除 AI 输出缓存？"
            description="这只会删除已生成的书籍复盘、阅读报告、阅读指南和选书决策缓存。API Key、微信读书缓存、本地阅读状态和导出文件不会被删除。"
            confirmLabel="确认清除"
            isDanger
            isBusy={isClearingAiOutputCache}
            onCancel={() => setPendingAction(undefined)}
            onConfirm={() => void handleClearAiOutputCache()}
          />
          <ConfirmDialog
            open={pendingAction === "clearReadingAssistantHistory"}
            title="确认清空 AI 阅读助手对话历史？"
            description="这只会删除本机保存的助手线程和消息，不会删除书籍复盘、阅读报告、阅读指南、选书决策或 API Key。"
            confirmLabel="确认清空"
            isDanger
            isBusy={isClearingReadingAssistantHistory}
            onCancel={() => setPendingAction(undefined)}
            onConfirm={() => void handleClearReadingAssistantHistory()}
          />
          <ConfirmDialog
            open={pendingAction === "restoreBackup"}
            title="确认恢复本地备份？"
            description="恢复会先验证备份结构，然后替换当前本地数据库。API Key 不包含在备份中，也不会随恢复移动。建议恢复后重启应用。"
            confirmLabel="确认恢复"
            isDanger
            isBusy={isRestoringBackup}
            onCancel={() => setPendingAction(undefined)}
            onConfirm={() => void handleRestoreBackup()}
          />
          <ConfirmDialog
            open={pendingAction === "migrateDataDirectory"}
            title="确认迁移本地数据目录？"
            description={`将把当前本地数据库复制到：${pendingStorageMigration?.targetDir || "未选择目录"}。API Key 和安全存储不会移动，迁移成功后需要重启应用。`}
            confirmLabel="确认迁移"
            isDanger
            isBusy={isMigratingDataDirectory}
            onCancel={() => {
              setPendingAction(undefined);
              setPendingStorageMigration(undefined);
            }}
            onConfirm={() => void handleMigrateDataDirectory()}
          />
          <ConfirmDialog
            open={pendingAction === "installUpdate"}
            title="确认安装更新？"
            description={`将从 ${APP_UPDATE_RELEASE_PAGE_URL} 下载并安装 ${appUpdateStatus?.latestVersion || "新版本"}。安装完成后需要重新启动应用。`}
            confirmLabel="确认安装"
            isBusy={isInstallingAppUpdate}
            onCancel={() => setPendingAction(undefined)}
            onConfirm={() => void handleInstallUpdate()}
          />
        </div>
      </section>
    </div>
  );
}

function renderUpdateSummary(
  status?: AppUpdateStatus,
  supportsNativeUpdater?: boolean
): string {
  if (!status) {
    return supportsNativeUpdater === false ? "尚未检查（安装包更新）" : "尚未检查";
  }

  if (status.available) {
    return status.supportsNativeUpdater ? "发现新版本" : "发现新版本（安装包更新）";
  }

  if (status.latestVersion) {
    return status.supportsNativeUpdater ? "已是最新版本" : "已是最新版本（安装包更新）";
  }

  return supportsNativeUpdater === false ? "当前平台使用安装包更新" : "已是最新版本";
}

function formatReleaseDate(value?: string): string {
  if (!value) {
    return "尚未检查";
  }

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

function PreferenceSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="credential-input preference-select">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
      >
        {options.map((option) => (
          <option value={option.value} key={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-section" aria-label={`${title}分区`}>
      {children}
    </section>
  );
}

function SyncStateRow({ state }: { state: SyncState }) {
  const isUpgradeRequired = state.errorCode === "upgrade_required";
  const errorMessage = isUpgradeRequired && state.errorMessage
    ? formatSkillUpgradeSyncError(state.errorMessage)
    : state.errorMessage;

  return (
    <article className={`sync-state-row is-${state.status}`}>
      <div>
        <strong>{sectionLabels[state.section] ?? state.section}</strong>
        <small>{isUpgradeRequired ? "Skill 需升级" : statusLabel(state.status)}</small>
      </div>
      <span>{formatTimestamp(state.lastSuccessAt) || "暂无成功同步"}</span>
      {errorMessage ? <p>{errorMessage}</p> : null}
    </article>
  );
}

function formatSkillUpgradeSyncError(message: string): string {
  return message.startsWith("微信读书 Skill 需要升级")
    ? message
    : `微信读书 Skill 需要升级：${message}`;
}

function formatTimestamp(value?: string): string {
  if (!value) {
    return "暂无";
  }

  const timestamp = Number(value);
  return formatUnixDate(timestamp) || value;
}

function formatAiProviderCapabilityStatus(
  status: AiProviderCapabilityStatus,
): string {
  if (status === "passed") {
    return "通过";
  }

  if (status === "failed") {
    return "失败";
  }

  return "跳过";
}

function formatAiResponseFormatPolicyLabel(
  policy: AiResponseFormatPolicy,
): string {
  return (
    AI_RESPONSE_FORMAT_POLICY_OPTIONS.find((option) => option.value === policy)
      ?.label ?? "自动"
  );
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 KB";
  }

  if (value >= 1024 * 1024) {
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

function statusLabel(status: SyncState["status"]): string {
  if (status === "success") {
    return "同步成功";
  }

  if (status === "failed") {
    return "同步失败";
  }

  if (status === "syncing") {
    return "同步中";
  }

  return "未同步";
}

function tableLabel(table: string): string {
  const labels: Record<string, string> = {
    shelf_entries: "书架",
    book_details: "书籍详情",
    book_progress: "阅读进度",
    chapters: "章节",
    notebook_books: "笔记书籍",
    highlights: "划线",
    thoughts: "想法",
    reading_stats: "阅读统计",
    ai_outputs: "AI 阅读成果",
    raw_cache: "原始缓存",
    sync_state: "同步状态",
    reading_item_states: "本地阅读状态",
  };

  return labels[table] ?? table;
}
