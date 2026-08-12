import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertCircle,
  Bot,
  ChevronDown,
  CheckCircle2,
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
import { SemanticIndexSettingsCard } from "../components/SemanticIndexSettingsCard";
import { useToast } from "../components/ToastProvider";
import { copyTextToClipboard } from "../lib/clipboard";
import { parseNotionObjectId } from "../lib/notion-page-id";
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
  chooseObsidianVaultDirectory,
  chooseCustomDataDirectory,
  clearAiOutputCache,
  clearLocalCache,
  clearReadingAssistantHistory,
  analyzeNotionDatabase,
  cancelNotionCoverBackfill,
  continueNotionStandardDatabaseProvisioning,
  createNotionStandardOutcomesDatabase,
  exportLocalDataBackup,
  exportDiagnostics,
  getCommandErrorMessage,
  getAiSettingsState,
  getReadingAssistantPreferences,
  getSettingsState,
  getNotionStandardDatabaseProvisioning,
  listenNotionCoverBackfillProgress,
  listAiProviderModels,
  migrateLocalDataDirectory,
  probeAiProviderCapabilities,
  preflightNotionCoverBackfill,
  removeAiCredential,
  removeCredential,
  removeNotionCredential,
  resetCustomExportDirectory,
  resetWereadProxyUrl,
  resolveNotionStandardDatabaseProvisioning,
  restoreLocalDataBackup,
  runNotionCoverBackfill,
  saveCustomExportDirectory,
  saveAiSettings,
  saveCredential,
  saveNotionCredential,
  saveNotionDatabaseConnection,
  saveNotionExportSettings,
  validateNotionCredential,
  saveObsidianExportSettings,
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
  AnalyzeNotionDatabaseResult,
  CreateNotionStandardDatabaseResult,
  ExportBackupResult,
  ReadingAssistantPreferences,
  SettingsState,
  NotionCoverMode,
  NotionCoverBackfillPreflight,
  NotionCoverBackfillProgress,
  NotionCoverBackfillReport,
  NotionDatabaseConnection,
  NotionDefaultViewStatus,
  NotionLogicalField,
  NotionParentType,
  NotionPropertyMapping,
  ObsidianAttachmentMode,
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
  | "installUpdate"
  | "replaceNotionExportTarget"
  | "confirmNotionCoverBackfill"
  | "confirmNotionDatabaseNotCreated";
type PendingStorageMigration = {
  targetDir: string;
};
type NotionConnectionView = {
  analysis: AnalyzeNotionDatabaseResult;
  mappings: NotionPropertyMapping[];
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

const NOTION_LOGICAL_FIELD_LABELS: Record<NotionLogicalField, string> = {
  title: "标题",
  author: "作者",
  cover: "封面",
  bookId: "Book ID",
  assetType: "资产类型",
  source: "来源",
  exportedAt: "导出时间",
  importStatus: "导入状态",
  readingStatus: "阅读状态",
  readingStage: "阅读阶段",
  progress: "阅读进度",
  tags: "标签",
  wereadUrl: "微信读书链接",
  obsidianPath: "Obsidian 路径",
  promptVersion: "Prompt 版本",
  inputHash: "输入哈希",
  scopeId: "范围 ID",
  period: "统计周期",
  actionCount: "行动数",
  candidateCount: "候选数",
  highlightCount: "划线数",
  thoughtCount: "想法数",
  bookmarkCount: "书签数",
  exportableCount: "可导出数",
};

const NOTION_PRIMARY_MAPPING_FIELDS: NotionLogicalField[] = [
  "title",
  "author",
  "cover",
  "bookId",
  "assetType",
  "source",
  "exportedAt",
  "importStatus",
  "readingStatus",
  "readingStage",
  "progress",
  "tags",
  "wereadUrl",
  "obsidianPath",
  "actionCount",
  "highlightCount",
  "thoughtCount",
  "bookmarkCount",
];

const NOTION_LOGICAL_FIELD_TYPES: Record<NotionLogicalField, string[]> = {
  title: ["title"],
  author: ["rich_text"],
  cover: ["files"],
  bookId: ["rich_text"],
  assetType: ["select", "status"],
  source: ["select", "status", "rich_text"],
  exportedAt: ["date"],
  importStatus: ["select", "status"],
  readingStatus: ["select", "status"],
  readingStage: ["select", "status"],
  progress: ["number"],
  tags: ["multi_select"],
  wereadUrl: ["url"],
  obsidianPath: ["rich_text"],
  promptVersion: ["rich_text"],
  inputHash: ["rich_text"],
  scopeId: ["rich_text"],
  period: ["select", "status"],
  actionCount: ["number"],
  candidateCount: ["number"],
  highlightCount: ["number"],
  thoughtCount: ["number"],
  bookmarkCount: ["number"],
  exportableCount: ["number"],
};

function notionDefaultViewStatusLabel(status: NotionDefaultViewStatus): string {
  switch (status) {
    case "created":
      return "已创建";
    case "updated":
      return "已更新";
    case "reused":
      return "已复用";
    case "skipped":
      return "已跳过";
    case "conflict":
      return "配置冲突";
    case "failed":
      return "初始化失败";
    case "unknown":
      return "结果待确认";
  }
}

function notionConnectionSnapshot(
  connection: NotionDatabaseConnection,
): NotionConnectionView {
  const properties = Array.from(
    new Map(
      connection.mappings.map((mapping) => [
        mapping.propertyId,
        {
          id: mapping.propertyId,
          name: mapping.propertyNameSnapshot,
          type: mapping.propertyType,
        },
      ]),
    ).values(),
  );
  const titleProperty = properties.find(
    (property) => property.id === connection.titlePropertyId,
  ) ?? {
    id: connection.titlePropertyId,
    name: connection.titlePropertyNameSnapshot,
    type: "title",
  };

  return {
    analysis: {
      compatibility: connection.mappings.filter(
        (mapping) => mapping.enabled && mapping.logicalField !== "title",
      ).length >= 4
        ? "full"
        : "basic",
      databaseId: connection.databaseId,
      databaseName: connection.databaseName,
      databaseUrl: connection.databaseUrl,
      titleProperty,
      properties,
      suggestedMappings: connection.mappings,
      issues: [],
      schemaCheckedAt: connection.schemaCheckedAt,
      schemaFingerprint: connection.schemaFingerprint,
    },
    mappings: connection.mappings,
  };
}

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
  const [obsidianVaultInput, setObsidianVaultInput] = useState("");
  const [obsidianAttachmentMode, setObsidianAttachmentMode] =
    useState<ObsidianAttachmentMode>("siblingAssets");
  const [obsidianOpenAfterExport, setObsidianOpenAfterExport] = useState(false);
  const [notionToken, setNotionToken] = useState("");
  const [notionDatabaseInput, setNotionDatabaseInput] = useState("");
  const [notionConnectionView, setNotionConnectionView] =
    useState<NotionConnectionView>();
  const [notionStandardParentPageInput, setNotionStandardParentPageInput] =
    useState("");
  const [notionCreatedDatabaseUrl, setNotionCreatedDatabaseUrl] = useState<string>();
  const [notionProvisioning, setNotionProvisioning] =
    useState<CreateNotionStandardDatabaseResult>();
  const [isResolvingNotionProvisioning, setIsResolvingNotionProvisioning] =
    useState(false);
  const [notionParentId, setNotionParentId] = useState("");
  const [notionParentType, setNotionParentType] = useState<NotionParentType>("page");
  const [notionCoverMode, setNotionCoverMode] = useState<NotionCoverMode>("pageCover");
  const [notionCoverBackfillPreflight, setNotionCoverBackfillPreflight] =
    useState<NotionCoverBackfillPreflight>();
  const [notionCoverBackfillProgress, setNotionCoverBackfillProgress] =
    useState<NotionCoverBackfillProgress>();
  const [notionCoverBackfillReport, setNotionCoverBackfillReport] =
    useState<NotionCoverBackfillReport>();
  const [isPreflightingNotionCoverBackfill, setIsPreflightingNotionCoverBackfill] =
    useState(false);
  const [isRunningNotionCoverBackfill, setIsRunningNotionCoverBackfill] =
    useState(false);
  const [isCancelingNotionCoverBackfill, setIsCancelingNotionCoverBackfill] =
    useState(false);
  const [isSavingIntegrations, setIsSavingIntegrations] = useState(false);
  const [isAnalyzingNotionDatabase, setIsAnalyzingNotionDatabase] = useState(false);
  const [isSavingNotionDatabaseConnection, setIsSavingNotionDatabaseConnection] =
    useState(false);
  const [isCreatingNotionStandardDatabase, setIsCreatingNotionStandardDatabase] =
    useState(false);
  const [isValidatingNotionToken, setIsValidatingNotionToken] = useState(false);
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
  const lastToastErrorRef = useRef<string>();
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

  useEffect(() => {
    if (!open) {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenNotionCoverBackfillProgress((progress) => {
      if (!disposed) {
        setNotionCoverBackfillProgress(progress);
      }
    })
      .then((dispose) => {
        if (disposed) {
          dispose();
        } else {
          unlisten = dispose;
        }
      })
      .catch((listenError) => {
        if (!disposed) {
          setError(getCommandErrorMessage(listenError));
        }
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [open]);

  useEffect(() => {
    if (!error) {
      lastToastErrorRef.current = undefined;
      return;
    }
    if (lastToastErrorRef.current === error) {
      return;
    }

    lastToastErrorRef.current = error;
    showToast({ message: error, tone: "error" });
  }, [error, showToast]);

  async function loadState() {
    setIsLoading(true);
    setError(undefined);

    try {
      const [
        nextState,
        nextAiState,
        nextReadingAssistantPreferences,
        nextNotionProvisioning,
      ] = await Promise.all([
        getSettingsState(),
        getAiSettingsState(),
        getReadingAssistantPreferences(),
        getNotionStandardDatabaseProvisioning(),
      ]);
      setState(nextState);
      setAiState(nextAiState);
      setReadingAssistantPreferences(nextReadingAssistantPreferences);
      setNotionProvisioning(nextNotionProvisioning);
      applyAiProviderSettings(nextAiState.provider);
      setExportDirectoryInput(nextState.exportData.exportDir);
      setObsidianVaultInput(nextState.integrationData.obsidian.vaultDir ?? "");
      setObsidianAttachmentMode(nextState.integrationData.obsidian.attachmentMode);
      setObsidianOpenAfterExport(nextState.integrationData.obsidian.openAfterExport);
      const savedNotionConnection = nextState.integrationData.notion.databaseConnection;
      setNotionParentId(nextState.integrationData.notion.parentId ?? "");
      setNotionParentType(nextState.integrationData.notion.parentType ?? "page");
      setNotionCoverMode(nextState.integrationData.notion.coverMode);
      setNotionDatabaseInput(
        savedNotionConnection?.databaseUrl ?? savedNotionConnection?.databaseId ?? "",
      );
      setNotionConnectionView(
        savedNotionConnection
          ? notionConnectionSnapshot(savedNotionConnection)
          : undefined,
      );
      setNotionStandardParentPageInput("");
      setNotionCreatedDatabaseUrl(nextNotionProvisioning?.url);
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

  async function handleChooseObsidianVault() {
    setIsSavingIntegrations(true);
    setError(undefined);
    try {
      const result = await chooseObsidianVaultDirectory();
      if (result.path) setObsidianVaultInput(result.path);
    } catch (chooseError) {
      setError(getCommandErrorMessage(chooseError));
    } finally {
      setIsSavingIntegrations(false);
    }
  }

  async function handleSaveObsidianSettings() {
    setIsSavingIntegrations(true);
    setError(undefined);
    try {
      const nextState = await saveObsidianExportSettings({
        vaultDir: obsidianVaultInput,
        attachmentMode: obsidianAttachmentMode,
        openAfterExport: obsidianOpenAfterExport,
      });
      setState(nextState);
      showToast({ message: "Obsidian 导出设置已保存。", tone: "success" });
    } catch (saveError) {
      setError(getCommandErrorMessage(saveError));
    } finally {
      setIsSavingIntegrations(false);
    }
  }

  async function handleSaveNotionSettings() {
    setIsSavingIntegrations(true);
    setError(undefined);
    try {
      if (notionToken.trim()) {
        await saveNotionCredential(notionToken);
        setNotionToken("");
      }
      const nextState = await saveNotionExportSettings({
        parentId: notionParentId.trim() || undefined,
        parentType: notionParentId.trim() ? notionParentType : undefined,
        coverMode: notionCoverMode,
      });
      setState(nextState);
      showToast({ message: "Notion 高级导出设置已保存。", tone: "success" });
    } catch (saveError) {
      setError(getCommandErrorMessage(saveError));
    } finally {
      setIsSavingIntegrations(false);
    }
  }

  async function savePendingNotionToken() {
    if (!notionToken.trim()) {
      return;
    }
    await saveNotionCredential(notionToken);
    setNotionToken("");
  }

  async function handleAnalyzeNotionDatabase() {
    const databaseId = parseNotionObjectId(notionDatabaseInput);
    if (!databaseId) {
      setError("请输入唯一且有效的 Notion 数据库链接或数据库 ID。");
      return;
    }

    setIsAnalyzingNotionDatabase(true);
    setError(undefined);
    try {
      await savePendingNotionToken();
      const analysis = await analyzeNotionDatabase(databaseId);
      setNotionDatabaseInput(analysis.databaseUrl ?? analysis.databaseId);
      setNotionConnectionView({
        analysis,
        mappings: analysis.suggestedMappings,
      });
      showToast({
        message:
          analysis.compatibility === "invalid"
            ? "数据库检查完成，但缺少可用的标题字段。"
            : "数据库检查完成，可确认字段映射后保存连接。",
        tone: analysis.compatibility === "invalid" ? "warning" : "success",
      });
    } catch (analysisError) {
      setError(getCommandErrorMessage(analysisError));
    } finally {
      setIsAnalyzingNotionDatabase(false);
    }
  }

  function handleNotionMappingChange(
    logicalField: NotionLogicalField,
    propertyId: string,
  ) {
    setNotionConnectionView((current) => {
      if (!current) {
        return current;
      }
      const property = current.analysis.properties.find(
        (candidate) => candidate.id === propertyId,
      );
      const nextMapping = property
        ? {
            logicalField,
            propertyId: property.id,
            propertyNameSnapshot: property.name,
            propertyType: property.type,
            enabled: true,
          }
        : undefined;
      return {
        ...current,
        mappings: [
          ...current.mappings.filter(
            (mapping) => mapping.logicalField !== logicalField,
          ),
          ...(nextMapping ? [nextMapping] : []),
        ],
      };
    });
  }

  async function handleSaveNotionDatabaseConnection() {
    const current = notionConnectionView;
    const titleMapping = current?.mappings.find(
      (mapping) => mapping.logicalField === "title" && mapping.enabled,
    );
    if (!current || current.analysis.compatibility === "invalid" || !titleMapping) {
      setError("请先检查数据库，并确认有效的标题字段映射。");
      return;
    }

    setIsSavingNotionDatabaseConnection(true);
    setError(undefined);
    try {
      const connection: NotionDatabaseConnection = {
        databaseId: current.analysis.databaseId,
        databaseName: current.analysis.databaseName,
        databaseUrl: current.analysis.databaseUrl,
        titlePropertyId: titleMapping.propertyId,
        titlePropertyNameSnapshot: titleMapping.propertyNameSnapshot,
        mappings: current.mappings,
        schemaCheckedAt: current.analysis.schemaCheckedAt,
        schemaFingerprint: current.analysis.schemaFingerprint,
      };
      const nextState = await saveNotionDatabaseConnection(connection);
      setState(nextState);
      setNotionParentId(connection.databaseId);
      setNotionParentType("database");
      setNotionConnectionView(notionConnectionSnapshot(connection));
      showToast({
        message: "Notion 数据库连接已保存，后续导出将按字段 ID 写入。",
        tone: "success",
      });
    } catch (saveError) {
      setError(getCommandErrorMessage(saveError));
    } finally {
      setIsSavingNotionDatabaseConnection(false);
    }
  }

  function handleRequestCreateNotionStandardDatabase() {
    const parentPageId = parseNotionObjectId(notionStandardParentPageInput);
    if (!parentPageId) {
      setError("请输入已共享给 Integration 的 Notion 父页面链接或页面 ID。");
      return;
    }
    if (state?.integrationData.notion.parentId) {
      setPendingAction("replaceNotionExportTarget");
      return;
    }
    void handleCreateNotionStandardDatabase(parentPageId);
  }

  function applyNotionProvisioningResult(
    result: CreateNotionStandardDatabaseResult,
  ) {
    setNotionProvisioning(result);
    setNotionCreatedDatabaseUrl(result.url);
    if (result.state) {
      setState(result.state);
      setNotionCoverMode(result.state.integrationData.notion.coverMode);
    }
    if (result.connection) {
      setNotionConnectionView(notionConnectionSnapshot(result.connection));
      setNotionDatabaseInput(
        result.connection.databaseUrl ?? result.connection.databaseId,
      );
    } else if (result.url || result.databaseId) {
      setNotionDatabaseInput(result.url ?? result.databaseId ?? "");
    }
    if (result.databaseId) {
      setNotionParentId(result.databaseId);
      setNotionParentType("database");
    }
  }

  async function refreshNotionProvisioningAfterUncertainCommand() {
    const recovered = await getNotionStandardDatabaseProvisioning();
    if (recovered) {
      applyNotionProvisioningResult(recovered);
      return recovered;
    }
    return undefined;
  }

  async function handleCreateNotionStandardDatabase(parentPageId: string) {
    setPendingAction(undefined);
    setIsCreatingNotionStandardDatabase(true);
    setError(undefined);
    try {
      await savePendingNotionToken();
      const result = await createNotionStandardOutcomesDatabase(parentPageId);
      applyNotionProvisioningResult(result);
      setNotionStandardParentPageInput("");
      if (result.status === "complete") {
        showToast({
          message: "标准阅读成果库已创建，4 个推荐视图已初始化。",
          tone: "success",
        });
      } else if (result.status === "partial" && result.connection) {
        showToast({
          message: "数据库连接已保存，可以正常导出；部分推荐视图尚未初始化。",
          tone: "warning",
        });
      } else {
        showToast({
          message: "已保存创建状态，请按恢复提示完成初始化。",
          tone: "warning",
        });
      }
    } catch (createError) {
      const message = getCommandErrorMessage(createError);
      try {
        const recovered = await refreshNotionProvisioningAfterUncertainCommand();
        setError(
          recovered
            ? `${message}。已从本地恢复创建状态，请按下方提示处理，应用不会重复创建数据库。`
            : message,
        );
      } catch (recoveryError) {
        setError(`${message}。读取本地恢复状态失败：${getCommandErrorMessage(recoveryError)}`);
      }
    } finally {
      setIsCreatingNotionStandardDatabase(false);
    }
  }

  async function handleContinueNotionProvisioning() {
    if (!notionProvisioning) {
      return;
    }
    setIsResolvingNotionProvisioning(true);
    setError(undefined);
    try {
      const result = await continueNotionStandardDatabaseProvisioning(
        notionProvisioning.provisioningId,
      );
      applyNotionProvisioningResult(result);
      showToast({
        message:
          result.status === "complete"
            ? "4 个推荐视图已初始化，标准阅读成果库可以正常使用。"
            : result.status === "partial" && result.connection
              ? "数据库连接可正常导出；仍有推荐视图需要重试或人工处理。"
              : "已更新恢复状态，请查看下一步提示。",
        tone:
          result.status === "complete"
            ? "success"
            : result.status === "partial" && result.connection
              ? "warning"
              : "warning",
      });
    } catch (continueError) {
      const message = getCommandErrorMessage(continueError);
      try {
        await refreshNotionProvisioningAfterUncertainCommand();
      } catch {
        // Preserve the original command error when the recovery query also fails.
      }
      setError(message);
    } finally {
      setIsResolvingNotionProvisioning(false);
    }
  }

  async function handleLinkCurrentNotionConnection() {
    if (!notionProvisioning) {
      return;
    }
    setIsResolvingNotionProvisioning(true);
    setError(undefined);
    try {
      const result = await resolveNotionStandardDatabaseProvisioning({
        provisioningId: notionProvisioning.provisioningId,
        resolution: "linkCurrentConnection",
        confirm: true,
      });
      if (result) {
        applyNotionProvisioningResult(result);
      }
      showToast({ message: "已关联同一数据库的现有连接。", tone: "success" });
    } catch (resolveError) {
      setError(getCommandErrorMessage(resolveError));
    } finally {
      setIsResolvingNotionProvisioning(false);
    }
  }

  async function handleConfirmNotionDatabaseNotCreated() {
    if (!notionProvisioning) {
      return;
    }
    setIsResolvingNotionProvisioning(true);
    setError(undefined);
    try {
      await resolveNotionStandardDatabaseProvisioning({
        provisioningId: notionProvisioning.provisioningId,
        resolution: "confirmNotCreated",
        confirm: true,
      });
      setNotionProvisioning(undefined);
      setNotionCreatedDatabaseUrl(undefined);
      setPendingAction(undefined);
      showToast({
        message: "已清除未知创建状态，可以重新发起创建。",
        tone: "success",
      });
    } catch (resolveError) {
      setError(getCommandErrorMessage(resolveError));
    } finally {
      setIsResolvingNotionProvisioning(false);
    }
  }

  async function handlePreflightNotionCoverBackfill() {
    setIsPreflightingNotionCoverBackfill(true);
    setNotionCoverBackfillPreflight(undefined);
    setNotionCoverBackfillProgress(undefined);
    setNotionCoverBackfillReport(undefined);
    setError(undefined);
    try {
      const preflight = await preflightNotionCoverBackfill();
      setNotionCoverBackfillPreflight(preflight);
      showToast({
        message: preflight.canRun
          ? `封面预检完成：${preflight.eligiblePages} 个页面可安全回填。`
          : "封面预检未通过，请先处理字段冲突或连接问题。",
        tone: preflight.canRun ? "success" : "warning",
      });
    } catch (preflightError) {
      setError(getCommandErrorMessage(preflightError));
    } finally {
      setIsPreflightingNotionCoverBackfill(false);
    }
  }

  function handleRequestRunNotionCoverBackfill() {
    if (!notionCoverBackfillPreflight?.canRun) {
      setError("请先完成并通过封面回填预检。");
      return;
    }
    setPendingAction("confirmNotionCoverBackfill");
  }

  async function handleRunNotionCoverBackfill() {
    const preflight = notionCoverBackfillPreflight;
    if (!preflight?.canRun) {
      setPendingAction(undefined);
      setError("封面回填预检已失效，请重新预检。");
      return;
    }
    setPendingAction(undefined);
    setIsRunningNotionCoverBackfill(true);
    setNotionCoverBackfillProgress(undefined);
    setNotionCoverBackfillReport(undefined);
    setError(undefined);
    try {
      const report = await runNotionCoverBackfill({
        preflightId: preflight.preflightId,
        databaseId: preflight.databaseId,
        schemaFingerprint: preflight.schemaFingerprint,
        coverPropertyAction: preflight.coverProperty.action,
        confirm: true,
      });
      setNotionCoverBackfillReport(report);
      setNotionCoverBackfillPreflight(undefined);
      showToast({
        message: report.wasCanceled
          ? "封面回填已取消，已完成的修改已保留。"
          : `封面回填完成：更新 ${report.updated}，部分成功 ${report.partial}，失败 ${report.failed}。`,
        tone: report.wasCanceled || report.failed || report.partial ? "warning" : "success",
      });
      if (report.schemaUpgraded) {
        void loadState();
      }
    } catch (runError) {
      setError(getCommandErrorMessage(runError));
    } finally {
      setIsRunningNotionCoverBackfill(false);
      setIsCancelingNotionCoverBackfill(false);
    }
  }

  async function handleCancelNotionCoverBackfill() {
    const operationId = notionCoverBackfillProgress?.operationId;
    if (!operationId) {
      setError("尚未收到封面回填 operation ID，暂时无法安全取消。");
      return;
    }
    setIsCancelingNotionCoverBackfill(true);
    setError(undefined);
    try {
      await cancelNotionCoverBackfill(operationId);
      showToast({
        message: "已请求取消；当前页面处理结束后将停止，已完成修改不会回滚。",
        tone: "warning",
      });
    } catch (cancelError) {
      setError(getCommandErrorMessage(cancelError));
      setIsCancelingNotionCoverBackfill(false);
    }
  }

  async function handleRemoveNotionCredential() {
    setIsSavingIntegrations(true);
    setError(undefined);
    try {
      const credential = await removeNotionCredential(true);
      setState((current) => current ? {
        ...current,
        integrationData: {
          ...current.integrationData,
          notion: { ...current.integrationData.notion, credential },
        },
      } : current);
      showToast({ message: "已移除 Notion Token。", tone: "success" });
    } catch (removeError) {
      setError(getCommandErrorMessage(removeError));
    } finally {
      setIsSavingIntegrations(false);
    }
  }

  async function handleValidateNotionCredential() {
    setIsValidatingNotionToken(true);
    setError(undefined);
    try {
      if (notionToken.trim()) {
        await saveNotionCredential(notionToken);
        setNotionToken("");
      }
      const credential = await validateNotionCredential();
      setState((current) => current ? {
        ...current,
        integrationData: {
          ...current.integrationData,
          notion: { ...current.integrationData.notion, credential },
        },
      } : current);
      showToast({ message: "Notion Token 验证通过。", tone: "success" });
    } catch (validationError) {
      setError(getCommandErrorMessage(validationError));
    } finally {
      setIsValidatingNotionToken(false);
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
                </section>
                <SemanticIndexSettingsCard onError={setError} />
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
                <IntegrationExportSettings
                  state={state}
                  isSaving={isSavingIntegrations}
                  obsidianVaultInput={obsidianVaultInput}
                  obsidianAttachmentMode={obsidianAttachmentMode}
                  obsidianOpenAfterExport={obsidianOpenAfterExport}
                  notionToken={notionToken}
                  notionDatabaseInput={notionDatabaseInput}
                  notionConnectionView={notionConnectionView}
                  notionProvisioning={notionProvisioning}
                  notionStandardParentPageInput={notionStandardParentPageInput}
                  notionCreatedDatabaseUrl={notionCreatedDatabaseUrl}
                  notionParentId={notionParentId}
                  notionParentType={notionParentType}
                  notionCoverMode={notionCoverMode}
                  notionCoverBackfillPreflight={notionCoverBackfillPreflight}
                  notionCoverBackfillProgress={notionCoverBackfillProgress}
                  notionCoverBackfillReport={notionCoverBackfillReport}
                  isPreflightingNotionCoverBackfill={isPreflightingNotionCoverBackfill}
                  isRunningNotionCoverBackfill={isRunningNotionCoverBackfill}
                  isCancelingNotionCoverBackfill={isCancelingNotionCoverBackfill}
                  isAnalyzingNotionDatabase={isAnalyzingNotionDatabase}
                  isSavingNotionDatabaseConnection={isSavingNotionDatabaseConnection}
                  isCreatingNotionStandardDatabase={isCreatingNotionStandardDatabase}
                  isResolvingNotionProvisioning={isResolvingNotionProvisioning}
                  isValidatingNotionToken={isValidatingNotionToken}
                  onObsidianVaultInputChange={setObsidianVaultInput}
                  onObsidianAttachmentModeChange={setObsidianAttachmentMode}
                  onObsidianOpenAfterExportChange={setObsidianOpenAfterExport}
                  onNotionTokenChange={setNotionToken}
                  onNotionDatabaseInputChange={(value) => {
                    setNotionDatabaseInput(value);
                    setNotionConnectionView(undefined);
                  }}
                  onNotionStandardParentPageInputChange={setNotionStandardParentPageInput}
                  onNotionMappingChange={handleNotionMappingChange}
                  onNotionParentIdChange={setNotionParentId}
                  onNotionParentTypeChange={setNotionParentType}
                  onNotionCoverModeChange={setNotionCoverMode}
                  onChooseObsidianVault={() => void handleChooseObsidianVault()}
                  onSaveObsidian={() => void handleSaveObsidianSettings()}
                  onSaveNotion={() => void handleSaveNotionSettings()}
                  onAnalyzeNotionDatabase={() => void handleAnalyzeNotionDatabase()}
                  onSaveNotionDatabaseConnection={() =>
                    void handleSaveNotionDatabaseConnection()
                  }
                  onCreateNotionStandardDatabase={handleRequestCreateNotionStandardDatabase}
                  onContinueNotionProvisioning={() =>
                    void handleContinueNotionProvisioning()
                  }
                  onLinkCurrentNotionConnection={() =>
                    void handleLinkCurrentNotionConnection()
                  }
                  onConfirmNotionDatabaseNotCreated={() =>
                    setPendingAction("confirmNotionDatabaseNotCreated")
                  }
                  onPreflightNotionCoverBackfill={() =>
                    void handlePreflightNotionCoverBackfill()
                  }
                  onRunNotionCoverBackfill={handleRequestRunNotionCoverBackfill}
                  onCancelNotionCoverBackfill={() =>
                    void handleCancelNotionCoverBackfill()
                  }
                  onOpenExternalLink={(url, fallbackLabel) => void handleOpenExternalLink(url, fallbackLabel)}
                  onRemoveNotionCredential={() => void handleRemoveNotionCredential()}
                  onValidateNotionToken={() => void handleValidateNotionCredential()}
                />
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
                      className="btn-danger"
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
                      className="btn-danger"
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
                  <div aria-label="本地备份数据边界">
                    <p>
                      <strong>包含：</strong>本地 SQLite 数据库，以及存在时的 WAL/SHM
                      辅助文件。
                    </p>
                    <p>
                      <strong>不包含：</strong>微信读书 API Key、AI API Key、Notion
                      凭据或其他安全存储文件。
                    </p>
                    <p>
                      <strong>暂不包含浏览器存储：</strong>
                      本地划线、想法、AI 提问草稿和记录、阅读器偏好，以及微信版本与本地版本的人工关联。
                    </p>
                  </div>
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
          <ConfirmDialog
            open={pendingAction === "confirmNotionCoverBackfill"}
            title="确认回填现有 Notion 成果页封面？"
            description={`将仅处理预检确认的数据库，为最多 ${notionCoverBackfillPreflight?.eligiblePages ?? 0} 个可匹配页面补空的“封面”属性和空的页面封面。已有人工封面不会覆盖，不会创建、删除或归档成果页；已完成的修改无法自动回滚。`}
            confirmLabel="确认开始回填"
            isBusy={isRunningNotionCoverBackfill}
            onCancel={() => setPendingAction(undefined)}
            onConfirm={() => void handleRunNotionCoverBackfill()}
          />
          <ConfirmDialog
            open={pendingAction === "confirmNotionDatabaseNotCreated"}
            title="确认 Notion 中没有创建出数据库？"
            description="只有在你已到 Notion 父页面核对，并确认没有出现本次“阅读成果库”时才能继续。确认后仅清除本地未知状态，不会自动创建；你需要再次手动点击创建按钮。"
            confirmLabel="确认未创建"
            isBusy={isResolvingNotionProvisioning}
            onCancel={() => setPendingAction(undefined)}
            onConfirm={() => void handleConfirmNotionDatabaseNotCreated()}
          />
          <ConfirmDialog
            open={pendingAction === "replaceNotionExportTarget"}
            title="创建并切换 Notion 导出目标？"
            description="这会在所选父页面下创建新的标准阅读成果库，并将后续 Notion 导出切换到该数据库。现有数据库和已导出内容不会被删除。"
            confirmLabel="创建并切换"
            isBusy={isCreatingNotionStandardDatabase}
            onCancel={() => setPendingAction(undefined)}
            onConfirm={() => {
              const parentPageId = parseNotionObjectId(
                notionStandardParentPageInput,
              );
              if (!parentPageId) {
                setPendingAction(undefined);
                setError("请输入已共享给 Integration 的 Notion 父页面链接或页面 ID。");
                return;
              }
              void handleCreateNotionStandardDatabase(parentPageId);
            }}
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

function IntegrationExportSettings({
  state,
  isSaving,
  obsidianVaultInput,
  obsidianAttachmentMode,
  obsidianOpenAfterExport,
  notionToken,
  notionDatabaseInput,
  notionConnectionView,
  notionProvisioning,
  notionStandardParentPageInput,
  notionCreatedDatabaseUrl,
  notionParentId,
  notionParentType,
  notionCoverMode,
  notionCoverBackfillPreflight,
  notionCoverBackfillProgress,
  notionCoverBackfillReport,
  isPreflightingNotionCoverBackfill,
  isRunningNotionCoverBackfill,
  isCancelingNotionCoverBackfill,
  isAnalyzingNotionDatabase,
  isSavingNotionDatabaseConnection,
  isCreatingNotionStandardDatabase,
  isResolvingNotionProvisioning,
  isValidatingNotionToken,
  onObsidianVaultInputChange,
  onObsidianAttachmentModeChange,
  onObsidianOpenAfterExportChange,
  onNotionTokenChange,
  onNotionDatabaseInputChange,
  onNotionStandardParentPageInputChange,
  onNotionMappingChange,
  onNotionParentIdChange,
  onNotionParentTypeChange,
  onNotionCoverModeChange,
  onChooseObsidianVault,
  onSaveObsidian,
  onSaveNotion,
  onAnalyzeNotionDatabase,
  onSaveNotionDatabaseConnection,
  onCreateNotionStandardDatabase,
  onContinueNotionProvisioning,
  onLinkCurrentNotionConnection,
  onConfirmNotionDatabaseNotCreated,
  onPreflightNotionCoverBackfill,
  onRunNotionCoverBackfill,
  onCancelNotionCoverBackfill,
  onOpenExternalLink,
  onRemoveNotionCredential,
  onValidateNotionToken,
}: {
  state?: SettingsState;
  isSaving: boolean;
  obsidianVaultInput: string;
  obsidianAttachmentMode: ObsidianAttachmentMode;
  obsidianOpenAfterExport: boolean;
  notionToken: string;
  notionDatabaseInput: string;
  notionConnectionView?: NotionConnectionView;
  notionProvisioning?: CreateNotionStandardDatabaseResult;
  notionStandardParentPageInput: string;
  notionCreatedDatabaseUrl?: string;
  notionParentId: string;
  notionParentType: NotionParentType;
  notionCoverMode: NotionCoverMode;
  notionCoverBackfillPreflight?: NotionCoverBackfillPreflight;
  notionCoverBackfillProgress?: NotionCoverBackfillProgress;
  notionCoverBackfillReport?: NotionCoverBackfillReport;
  isPreflightingNotionCoverBackfill: boolean;
  isRunningNotionCoverBackfill: boolean;
  isCancelingNotionCoverBackfill: boolean;
  isAnalyzingNotionDatabase: boolean;
  isSavingNotionDatabaseConnection: boolean;
  isCreatingNotionStandardDatabase: boolean;
  isResolvingNotionProvisioning: boolean;
  isValidatingNotionToken: boolean;
  onObsidianVaultInputChange: (value: string) => void;
  onObsidianAttachmentModeChange: (value: ObsidianAttachmentMode) => void;
  onObsidianOpenAfterExportChange: (value: boolean) => void;
  onNotionTokenChange: (value: string) => void;
  onNotionDatabaseInputChange: (value: string) => void;
  onNotionStandardParentPageInputChange: (value: string) => void;
  onNotionMappingChange: (
    logicalField: NotionLogicalField,
    propertyId: string,
  ) => void;
  onNotionParentIdChange: (value: string) => void;
  onNotionParentTypeChange: (value: NotionParentType) => void;
  onNotionCoverModeChange: (value: NotionCoverMode) => void;
  onChooseObsidianVault: () => void;
  onSaveObsidian: () => void;
  onSaveNotion: () => void;
  onAnalyzeNotionDatabase: () => void;
  onSaveNotionDatabaseConnection: () => void;
  onCreateNotionStandardDatabase: () => void;
  onContinueNotionProvisioning: () => void;
  onLinkCurrentNotionConnection: () => void;
  onConfirmNotionDatabaseNotCreated: () => void;
  onPreflightNotionCoverBackfill: () => void;
  onRunNotionCoverBackfill: () => void;
  onCancelNotionCoverBackfill: () => void;
  onOpenExternalLink: (url: string, fallbackLabel: string) => void;
  onRemoveNotionCredential: () => void;
  onValidateNotionToken: () => void;
}) {
  const hasNotionCredential =
    state?.integrationData.notion.credential.hasCredential ?? false;
  const savedNotionConnection = state?.integrationData.notion.databaseConnection;
  const hasNotionTarget = Boolean(state?.integrationData.notion.parentId);
  const backfillBusy = isPreflightingNotionCoverBackfill || isRunningNotionCoverBackfill;
  const analysis = notionConnectionView?.analysis;
  const titleMapping = notionConnectionView?.mappings.find(
    (mapping) => mapping.logicalField === "title" && mapping.enabled,
  );
  const compatibilityLabel =
    analysis?.compatibility === "full"
      ? "完整兼容"
      : analysis?.compatibility === "basic"
        ? "基础兼容"
        : "不可连接";
  const readyViewStatuses: NotionDefaultViewStatus[] = ["created", "updated", "reused"];
  const readyViewCount = notionProvisioning?.views.filter((view) =>
    readyViewStatuses.includes(view.status),
  ).length ?? 0;
  const provisioningTitle = notionProvisioning?.status === "complete"
    ? "数据库和 4 个推荐视图已就绪"
    : notionProvisioning?.status === "partial"
      ? "数据库已连接，推荐视图未全部就绪"
      : notionProvisioning?.status === "recoveryRequired"
        ? "数据库已创建，需要继续初始化"
        : "创建结果尚未确认";
  const provisioningSummary = notionProvisioning?.status === "complete"
    ? "4 个推荐视图均已初始化。"
    : notionProvisioning?.status === "partial"
      ? `数据库连接可正常导出；推荐视图已就绪 ${readyViewCount}/4。`
      : notionProvisioning?.status === "recoveryRequired"
        ? notionProvisioning.lastError?.message ??
          "已保存 database ID，不会重复创建数据库。"
        : notionProvisioning?.lastError?.message ??
          "应用已暂停再次创建，请先到 Notion 核对结果。";
  const canContinueProvisioning = notionProvisioning?.status === "recoveryRequired" ||
    (notionProvisioning?.status === "partial" &&
      notionProvisioning.viewInitialization !== "complete");

  return (
    <>
      <section
        className="settings-card settings-panel settings-control-panel"
        aria-label="Obsidian 导出设置"
      >
        <div className="settings-card-heading">
          <span className="settings-icon">
            <FolderOpen aria-hidden="true" size={20} />
          </span>
          <div><p className="section-kicker">Obsidian</p><h3>Vault 导出</h3></div>
        </div>
        <p>笔记写入 Vault 下的 wxreadmaster/书籍笔记，封面优先保存为本地附件。</p>
        <div className="settings-control-row">
          <label className="credential-input">
            <span>Vault 路径</span>
            <input value={obsidianVaultInput} onChange={(event) => onObsidianVaultInputChange(event.target.value)} />
          </label>
          <label className="credential-input">
            <span>附件目录</span>
            <select value={obsidianAttachmentMode} onChange={(event) => onObsidianAttachmentModeChange(event.target.value as ObsidianAttachmentMode)}>
              <option value="siblingAssets">笔记同级附件</option>
              <option value="centralAssets">中央 assets 目录</option>
            </select>
          </label>
        </div>
        <label className="settings-check-row">
          <input type="checkbox" checked={obsidianOpenAfterExport} onChange={(event) => onObsidianOpenAfterExportChange(event.target.checked)} />
          <span>导出后自动打开笔记</span>
        </label>
        <div className="settings-actions settings-card-actions">
          <button className="secondary-action" type="button" onClick={onChooseObsidianVault} disabled={isSaving}>
            <FolderOpen aria-hidden="true" size={18} />选择 Vault
          </button>
          <button className="sync-button" type="button" onClick={onSaveObsidian} disabled={isSaving || !obsidianVaultInput.trim()}>
            {isSaving ? "保存中" : "保存 Obsidian 设置"}
          </button>
        </div>
      </section>
      <section
        className="settings-card settings-panel settings-control-panel notion-template-card"
        aria-label="Notion 导出设置"
      >
        <div className="settings-card-heading">
          <span className="settings-icon">
            <Database aria-hidden="true" size={20} />
          </span>
          <div>
            <p className="section-kicker">Notion 导出</p>
            <h3>连接你的数据库</h3>
          </div>
        </div>
        <p>
          选择你已有的 Notion 数据库，应用只检查字段并写入阅读成果，不会修改数据库结构、视图或公式。
        </p>
        <div className="notion-status-strip" aria-label="Notion 配置状态">
          <span className={hasNotionCredential ? "is-ready" : ""}>
            <ShieldCheck aria-hidden="true" size={16} />
            {hasNotionCredential ? "Token 已保存" : "Token 未保存"}
          </span>
          <span className={savedNotionConnection ? "is-ready" : ""}>
            <Database aria-hidden="true" size={16} />
            {savedNotionConnection ? "数据库已连接" : "数据库未连接"}
          </span>
        </div>
        <div className="settings-control-row notion-token-row">
          <label className="credential-input">
            <span>Integration Token</span>
            <input
              type="password"
              value={notionToken}
              placeholder={
                hasNotionCredential
                  ? "已保存，留空则保持不变"
                  : "ntn_ 或 secret_ 开头"
              }
              onChange={(event) => onNotionTokenChange(event.target.value)}
              disabled={backfillBusy}
            />
          </label>
          <button
            className="text-button"
            type="button"
            onClick={onValidateNotionToken}
            disabled={
              isValidatingNotionToken ||
              backfillBusy ||
              (!notionToken.trim() && !hasNotionCredential)
            }
          >
            {isValidatingNotionToken ? "验证中" : "验证连接"}
          </button>
        </div>

        <section className="notion-database-connect" aria-label="连接已有数据库">
          <div className="notion-advanced-heading">
            <div>
              <p className="section-kicker">主路径</p>
              <h4>连接已有数据库</h4>
            </div>
            <span>先把数据库共享给 Integration</span>
          </div>
          <div className="notion-database-input-row">
            <label className="credential-input">
              <span>数据库链接或 ID</span>
              <input
                value={notionDatabaseInput}
                placeholder="粘贴 Notion 数据库链接或 32 位 ID"
                onChange={(event) =>
                  onNotionDatabaseInputChange(event.target.value)
                }
                disabled={backfillBusy}
              />
            </label>
            <button
              className="sync-button"
              type="button"
              onClick={onAnalyzeNotionDatabase}
              disabled={
                isAnalyzingNotionDatabase ||
                backfillBusy ||
                !notionDatabaseInput.trim() ||
                (!notionToken.trim() && !hasNotionCredential)
              }
            >
              {isAnalyzingNotionDatabase ? (
                <Loader2 aria-hidden="true" size={18} className="spin" />
              ) : (
                <RefreshCw aria-hidden="true" size={18} />
              )}
              {isAnalyzingNotionDatabase ? "检查中" : "检查数据库"}
            </button>
          </div>

          {analysis ? (
            <div
              className={`notion-compatibility-card is-${analysis.compatibility}`}
              role="status"
              aria-live="polite"
            >
              <div className="notion-compatibility-heading">
                {analysis.compatibility === "invalid" ? (
                  <AlertCircle aria-hidden="true" size={19} />
                ) : (
                  <CheckCircle2 aria-hidden="true" size={19} />
                )}
                <div>
                  <strong>{compatibilityLabel}</strong>
                  <small>
                    {analysis.databaseName || "未命名数据库"} · 标题字段：
                    {analysis.titleProperty?.name || "缺失"}
                  </small>
                </div>
              </div>
              <small>检查时间：{formatTimestamp(analysis.schemaCheckedAt)}</small>
              {analysis.issues.length ? (
                <ul className="notion-issue-list">
                  {analysis.issues.map((issue) => (
                    <li key={`${issue.code}-${issue.propertyId || issue.logicalField || "database"}`}>
                      {issue.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {analysis && analysis.compatibility !== "invalid" ? (
            <section className="notion-mapping-panel" aria-label="字段映射">
              <div className="notion-advanced-heading">
                <div>
                  <p className="section-kicker">字段映射</p>
                  <h4>按属性 ID 保存</h4>
                </div>
                <span>字段改名后仍可继续导出</span>
              </div>
              <div className="notion-mapping-list">
                {NOTION_PRIMARY_MAPPING_FIELDS.map((logicalField) => {
                  const mapping = notionConnectionView?.mappings.find(
                    (candidate) => candidate.logicalField === logicalField,
                  );
                  const acceptedTypes = NOTION_LOGICAL_FIELD_TYPES[logicalField];
                  const properties = analysis.properties.filter((property) =>
                    acceptedTypes.includes(property.type),
                  );
                  return (
                    <label className="notion-mapping-row" key={logicalField}>
                      <span>
                        <strong>
                          {NOTION_LOGICAL_FIELD_LABELS[logicalField]}
                        </strong>
                        <small>
                          {logicalField === "title" ? "必填" : "可选"}
                        </small>
                      </span>
                      <select
                        value={mapping?.propertyId ?? ""}
                        onChange={(event) =>
                          onNotionMappingChange(logicalField, event.target.value)
                        }
                      >
                        {logicalField !== "title" ? (
                          <option value="">不导出</option>
                        ) : (
                          <option value="" disabled>
                            选择标题字段
                          </option>
                        )}
                        {properties.map((property) => (
                          <option key={property.id} value={property.id}>
                            {property.name} · {property.type}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })}
              </div>
              <div className="settings-actions settings-card-actions">
                <button
                  className="secondary-action"
                  type="button"
                  onClick={onSaveNotionDatabaseConnection}
                  disabled={
                    isSavingNotionDatabaseConnection || backfillBusy || !titleMapping
                  }
                >
                  {isSavingNotionDatabaseConnection ? (
                    <Loader2 aria-hidden="true" size={18} className="spin" />
                  ) : (
                    <ShieldCheck aria-hidden="true" size={18} />
                  )}
                  {isSavingNotionDatabaseConnection
                    ? "保存中"
                    : "保存数据库连接"}
                </button>
                {analysis.databaseUrl ? (
                  <button
                    className="sync-button"
                    type="button"
                    onClick={() =>
                      onOpenExternalLink(analysis.databaseUrl!, "Notion 数据库")
                    }
                  >
                    <ExternalLink aria-hidden="true" size={16} />
                    打开数据库
                  </button>
                ) : null}
              </div>
            </section>
          ) : null}
        </section>

        <section className="notion-standard-database" aria-label="标准阅读成果库">
          <div>
            <p className="section-kicker">可选兜底</p>
            <h4>没有现成数据库？创建标准阅读成果库</h4>
            <p>
              应用会在指定父页面下新建一个带推荐字段的数据库，自动保存字段映射，并初始化四个推荐 Table 视图；不会创建额外工作台。各视图的实际名称和状态会在创建结果中列出。
            </p>
          </div>
          {notionProvisioning ? (
            <div
              className={`notion-provisioning-result is-${notionProvisioning.status}`}
              role="status"
              aria-live="polite"
            >
              <div>
                {notionProvisioning.status === "complete" ||
                notionProvisioning.status === "partial" ? (
                  <CheckCircle2 aria-hidden="true" size={18} />
                ) : (
                  <AlertCircle aria-hidden="true" size={18} />
                )}
                <div>
                  <strong>{provisioningTitle}</strong>
                  <small>{provisioningSummary}</small>
                  {notionProvisioning.views.length ? (
                    <ul className="notion-view-status-list" aria-label="推荐视图初始化状态">
                      {notionProvisioning.views.map((view) => (
                        <li key={view.key} className={`is-${view.status}`}>
                          <span>{view.name}</span>
                          <small>{notionDefaultViewStatusLabel(view.status)}</small>
                          {view.warning ? <small>{view.warning}</small> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {notionProvisioning.warnings.length ? (
                    <ul className="notion-issue-list is-warning">
                      {notionProvisioning.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
              <div className="settings-actions settings-card-actions">
                {canContinueProvisioning ? (
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={onContinueNotionProvisioning}
                    disabled={isResolvingNotionProvisioning}
                  >
                    {isResolvingNotionProvisioning
                      ? "处理中"
                      : notionProvisioning.status === "partial"
                        ? "重试缺失视图"
                        : "继续初始化"}
                  </button>
                ) : null}
                {notionProvisioning.databaseId && savedNotionConnection ? (
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={onLinkCurrentNotionConnection}
                    disabled={isResolvingNotionProvisioning}
                  >
                    关联当前连接
                  </button>
                ) : null}
                {notionProvisioning.status === "unknown" ? (
                  <button
                    className="text-button"
                    type="button"
                    onClick={onConfirmNotionDatabaseNotCreated}
                    disabled={isResolvingNotionProvisioning}
                  >
                    我已确认未创建
                  </button>
                ) : null}
                {notionProvisioning.url ? (
                  <button
                    className="sync-button"
                    type="button"
                    onClick={() =>
                      onOpenExternalLink(notionProvisioning.url!, "阅读成果库")
                    }
                  >
                    <ExternalLink aria-hidden="true" size={16} />
                    打开成果库
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          {!notionProvisioning ? (
            <div className="notion-database-input-row">
              <label className="credential-input">
                <span>已共享的父页面链接或 ID</span>
                <input
                  value={notionStandardParentPageInput}
                  placeholder="粘贴父页面链接或 ID"
                  onChange={(event) =>
                    onNotionStandardParentPageInputChange(event.target.value)
                  }
                />
              </label>
              <button
                className="sync-button"
                type="button"
                onClick={onCreateNotionStandardDatabase}
                disabled={
                  isCreatingNotionStandardDatabase ||
                  backfillBusy ||
                  !notionStandardParentPageInput.trim() ||
                  (!notionToken.trim() && !hasNotionCredential)
                }
              >
                {isCreatingNotionStandardDatabase ? (
                  <Loader2 aria-hidden="true" size={18} className="spin" />
                ) : (
                  <Database aria-hidden="true" size={18} />
                )}
                {isCreatingNotionStandardDatabase
                  ? "创建中"
                  : "创建标准阅读成果库"}
              </button>
            </div>
          ) : null}
          {notionCreatedDatabaseUrl && !notionProvisioning ? (
            <div className="notion-template-result" role="status">
              <div>
                <CheckCircle2 aria-hidden="true" size={18} />
                <div>
                  <strong>标准阅读成果库已创建</strong>
                  <small>后续 Notion 导出将写入此数据库。</small>
                </div>
              </div>
              <button
                className="secondary-action"
                type="button"
                onClick={() =>
                  onOpenExternalLink(notionCreatedDatabaseUrl, "阅读成果库")
                }
              >
                <ExternalLink aria-hidden="true" size={16} />
                打开成果库
              </button>
            </div>
          ) : null}
        </section>

        <section className="notion-cover-backfill" aria-label="现有成果页封面回填">
          <div className="notion-advanced-heading">
            <div>
              <p className="section-kicker">安全维护</p>
              <h4>补齐现有成果页封面</h4>
            </div>
            <span>只补空值，不覆盖人工内容</span>
          </div>
          <p>
            按 Book ID 从本地缓存查找 HTTP(S) 封面，同时补空的“封面” Files &amp; media 属性和空的页面封面。不会访问微信读书远端，也不会创建、删除或归档成果页。
          </p>

          {notionCoverBackfillPreflight ? (
            <div
              className={`notion-backfill-preflight ${notionCoverBackfillPreflight.canRun ? "is-ready" : "is-blocked"}`}
              role="status"
              aria-live="polite"
            >
              <div className="notion-compatibility-heading">
                {notionCoverBackfillPreflight.canRun ? (
                  <CheckCircle2 aria-hidden="true" size={19} />
                ) : (
                  <AlertCircle aria-hidden="true" size={19} />
                )}
                <div>
                  <strong>
                    {notionCoverBackfillPreflight.canRun ? "预检通过" : "预检未通过"}
                  </strong>
                  <small>{notionCoverBackfillPreflight.coverProperty.message}</small>
                </div>
              </div>
              <dl className="notion-backfill-metrics">
                <div><dt>成果页</dt><dd>{notionCoverBackfillPreflight.totalPages}</dd></div>
                <div><dt>可回填</dt><dd>{notionCoverBackfillPreflight.eligiblePages}</dd></div>
                <div><dt>缺本地封面</dt><dd>{notionCoverBackfillPreflight.missingLocalCover}</dd></div>
                <div><dt>保留属性封面</dt><dd>{notionCoverBackfillPreflight.preservedCoverProperty}</dd></div>
                <div><dt>保留页面封面</dt><dd>{notionCoverBackfillPreflight.preservedPageCover}</dd></div>
              </dl>
              {notionCoverBackfillPreflight.blockers.length ? (
                <ul className="notion-issue-list">
                  {notionCoverBackfillPreflight.blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              ) : null}
              {notionCoverBackfillPreflight.warnings.length ? (
                <ul className="notion-issue-list is-warning">
                  {notionCoverBackfillPreflight.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {isRunningNotionCoverBackfill || notionCoverBackfillProgress ? (
            <div className="notion-backfill-progress" role="status" aria-live="polite">
              <div>
                <strong>{notionCoverBackfillProgress?.message || "正在启动封面回填…"}</strong>
                <span>
                  {notionCoverBackfillProgress?.completed ?? 0} / {notionCoverBackfillProgress?.total ?? notionCoverBackfillPreflight?.totalPages ?? 0}
                </span>
              </div>
              <progress
                max={Math.max(1, notionCoverBackfillProgress?.total ?? notionCoverBackfillPreflight?.totalPages ?? 1)}
                value={notionCoverBackfillProgress?.completed ?? 0}
              />
              {notionCoverBackfillProgress ? (
                <small>
                  更新 {notionCoverBackfillProgress.updated} · 部分成功 {notionCoverBackfillProgress.partial} · 保留 {notionCoverBackfillProgress.preserved} · 跳过 {notionCoverBackfillProgress.skipped} · 失败 {notionCoverBackfillProgress.failed}
                </small>
              ) : null}
            </div>
          ) : null}

          {notionCoverBackfillReport ? (
            <div className={`notion-backfill-report ${notionCoverBackfillReport.wasCanceled || notionCoverBackfillReport.failed || notionCoverBackfillReport.partial ? "has-warning" : ""}`} role="status">
              <div className="notion-compatibility-heading">
                {notionCoverBackfillReport.wasCanceled || notionCoverBackfillReport.failed ? (
                  <AlertCircle aria-hidden="true" size={19} />
                ) : (
                  <CheckCircle2 aria-hidden="true" size={19} />
                )}
                <div>
                  <strong>{notionCoverBackfillReport.wasCanceled ? "回填已取消" : "回填报告"}</strong>
                  <small>
                    更新 {notionCoverBackfillReport.updated} · 部分成功 {notionCoverBackfillReport.partial} · 保留 {notionCoverBackfillReport.preserved} · 跳过 {notionCoverBackfillReport.skipped} · 失败 {notionCoverBackfillReport.failed} · 取消 {notionCoverBackfillReport.canceled}
                  </small>
                </div>
              </div>
              <small>完成时间：{formatTimestamp(notionCoverBackfillReport.completedAt)}</small>
              {notionCoverBackfillReport.warnings.length ? (
                <ul className="notion-issue-list is-warning">
                  {notionCoverBackfillReport.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="settings-actions settings-card-actions">
            <button
              className="secondary-action"
              type="button"
              onClick={onPreflightNotionCoverBackfill}
              disabled={backfillBusy || !savedNotionConnection || !hasNotionCredential}
            >
              {isPreflightingNotionCoverBackfill ? (
                <Loader2 aria-hidden="true" size={18} className="spin" />
              ) : (
                <RefreshCw aria-hidden="true" size={18} />
              )}
              {isPreflightingNotionCoverBackfill ? "预检中" : "预检封面回填"}
            </button>
            {isRunningNotionCoverBackfill ? (
              <button
                className="text-button"
                type="button"
                onClick={onCancelNotionCoverBackfill}
                disabled={isCancelingNotionCoverBackfill || !notionCoverBackfillProgress?.operationId}
              >
                {isCancelingNotionCoverBackfill ? "取消请求中" : "取消回填"}
              </button>
            ) : (
              <button
                className="sync-button"
                type="button"
                onClick={onRunNotionCoverBackfill}
                disabled={!notionCoverBackfillPreflight?.canRun || notionCoverBackfillPreflight.eligiblePages === 0}
              >
                <ShieldCheck aria-hidden="true" size={18} />
                确认后开始回填
              </button>
            )}
          </div>
        </section>

        <details className="notion-advanced-panel">
          <summary>高级兼容设置</summary>
          <p className="notion-template-help">
            仅在需要直接导出到普通页面，或兼容旧配置时使用。数据库主路径请优先使用上方连接流程。
          </p>
          <div className="settings-control-row notion-target-grid">
            <label className="credential-input">
              <span>目标 ID</span>
              <input
                value={notionParentId}
                onChange={(event) => onNotionParentIdChange(event.target.value)}
              />
            </label>
            <label className="credential-input">
              <span>目标类型</span>
              <select
                value={notionParentType}
                onChange={(event) =>
                  onNotionParentTypeChange(
                    event.target.value as NotionParentType,
                  )
                }
              >
                <option value="page">页面</option>
                <option value="database">数据库</option>
              </select>
            </label>
            <label className="credential-input">
              <span>封面策略</span>
              <select
                value={notionCoverMode}
                onChange={(event) =>
                  onNotionCoverModeChange(
                    event.target.value as NotionCoverMode,
                  )
                }
              >
                <option value="pageCover">页面封面</option>
                <option value="contentImageOnly">仅正文图片</option>
              </select>
            </label>
          </div>
          <button
            className="sync-button"
            type="button"
            onClick={onSaveNotion}
            disabled={isSaving || backfillBusy || (!notionParentId.trim() && !notionToken.trim())}
          >
            {isSaving ? "保存中" : "保存高级设置"}
          </button>
        </details>
        <div className="settings-actions settings-card-actions">
          <button
            className="secondary-action"
            type="button"
            onClick={onRemoveNotionCredential}
            disabled={isSaving || backfillBusy || !hasNotionCredential}
          >
            移除 Token
          </button>
          {hasNotionTarget ? (
            <span className="credential-help-note">
              切换数据库不会删除原数据库或已导出的内容。
            </span>
          ) : null}
        </div>
      </section>
    </>
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

export function formatTimestamp(value?: string): string {
  if (!value) {
    return "暂无";
  }

  const numericValue = Number(value);
  const date = Number.isFinite(numericValue)
    ? new Date(numericValue * 1000)
    : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "暂无";
  }

  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}年${month}月${day}日 ${hour}:${minute}`;
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
