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
  HardDrive,
  Info,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import onboardingLocalVault from "../assets/generated/onboarding-local-vault.png";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../components/ToastProvider";
import { copyTextToClipboard } from "../lib/clipboard";
import { formatUnixDate } from "../lib/formatters";
import {
  chooseCustomExportDirectory,
  chooseCustomDataDirectory,
  checkForAppUpdate,
  clearAiOutputCache,
  clearLocalCache,
  downloadAndInstallAppUpdate,
  exportLocalDataBackup,
  exportDiagnostics,
  getCommandErrorMessage,
  getAiSettingsState,
  getSettingsState,
  migrateLocalDataDirectory,
  removeAiCredential,
  removeCredential,
  resetCustomExportDirectory,
  restoreLocalDataBackup,
  saveCustomExportDirectory,
  saveAiSettings,
  saveCredential,
  testAiConnection,
  validateAiCredential,
  validateCredential,
} from "../lib/reading-api";
import type { UserPreferences } from "../lib/preferences";
import type {
  AiSettingsState,
  AppUpdateStatus,
  CredentialStatus,
  ExportBackupResult,
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
};

type PendingAction =
  | "removeCredential"
  | "removeAiCredential"
  | "clearAiOutputCache"
  | "clearCache"
  | "restoreBackup"
  | "migrateDataDirectory"
  | "installUpdate";
type PendingStorageMigration = {
  targetDir: string;
};
type SettingsCategoryId =
  | "account"
  | "ai"
  | "appearance"
  | "export"
  | "updates"
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
    heroDescription:
      "管理微信读书同步凭据。已保存的 Key 只在本机安全存储中读取，前端不显示明文。",
    icon: KeyRound,
  },
  {
    id: "ai",
    label: "AI 设置",
    description: "Provider 和 Key",
    heroDescription:
      "配置用于复盘和阅读指南的 Provider；只有主动生成时才会发送当前书的本地内容。",
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
      "将版本检查、发布来源和安装动作集中到单独菜单，避免和账户设置混在一起。",
    icon: Sparkles,
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

const releaseAuthor = "RHZ";
const releaseFeedUrl =
  "https://github.com/RHZHZ/wereadmaster/releases/latest/download/latest.json";
const releaseRepositoryUrl = "https://github.com/RHZHZ/wereadmaster";
const releasePageUrl = "https://github.com/RHZHZ/wereadmaster/releases";
const releaseAuthorUrl = "https://github.com/RHZHZ";

export function SettingsPage({
  open,
  credentialStatus,
  onCredentialChange,
  onLocalCacheCleared,
  preferences,
  onPreferencesChange,
  onClose,
}: SettingsPageProps) {
  const [state, setState] = useState<SettingsState>();
  const [aiState, setAiState] = useState<AiSettingsState>();
  const [apiKey, setApiKey] = useState("");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiBaseUrl, setAiBaseUrl] = useState("https://api.openai.com/v1");
  const [aiModel, setAiModel] = useState("gpt-4o-mini");
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingCredential, setIsSavingCredential] = useState(false);
  const [isSavingAiCredential, setIsSavingAiCredential] = useState(false);
  const [isTestingAiConnection, setIsTestingAiConnection] = useState(false);
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
  const [isCheckingForUpdate, setIsCheckingForUpdate] = useState(false);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
  const [exportDirectoryInput, setExportDirectoryInput] = useState("");
  const [isExportingDiagnostics, setIsExportingDiagnostics] = useState(false);
  const [lastBackup, setLastBackup] = useState<ExportBackupResult>();
  const [latestUpdateStatus, setLatestUpdateStatus] = useState<
    AppUpdateStatus | undefined
  >();
  const [pendingStorageMigration, setPendingStorageMigration] =
    useState<PendingStorageMigration>();
  const [pendingAction, setPendingAction] = useState<PendingAction>();
  const [activeCategory, setActiveCategory] =
    useState<SettingsCategoryId>("account");
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [error, setError] = useState<string>();
  const { showToast } = useToast();
  const credential = state?.credential ?? credentialStatus;
  const activeCategoryConfig =
    settingsCategories.find((category) => category.id === activeCategory) ??
    settingsCategories[0];

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

  async function loadState() {
    setIsLoading(true);
    setError(undefined);

    try {
      const [nextState, nextAiState] = await Promise.all([
        getSettingsState(),
        getAiSettingsState(),
      ]);
      setState(nextState);
      setAiState(nextAiState);
      setAiBaseUrl(nextAiState.provider.baseUrl);
      setAiModel(nextAiState.provider.model);
      setExportDirectoryInput(nextState.exportData.exportDir);
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
      });
      setAiState(nextAiState);
      setAiBaseUrl(nextAiState.provider.baseUrl);
      setAiModel(nextAiState.provider.model);
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

  async function handleRemoveAiCredential() {
    setIsSavingAiCredential(true);
    setError(undefined);

    try {
      const nextAiState = await removeAiCredential(true);
      setAiState(nextAiState);
      setAiBaseUrl(nextAiState.provider.baseUrl);
      setAiModel(nextAiState.provider.model);
      setAiApiKey("");
      showToast({
        message: "已移除本机保存的 AI API Key。历史 AI 总结缓存不会被删除。",
        tone: "success",
      });
      setPendingAction(undefined);
    } catch (removeError) {
      setError(getCommandErrorMessage(removeError));
    } finally {
      setIsSavingAiCredential(false);
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
    setIsCheckingForUpdate(true);
    setError(undefined);

    try {
      const updateStatus = await checkForAppUpdate();
      setLatestUpdateStatus(updateStatus);

      if (!updateStatus.available) {
        showToast({
          message: `当前已是最新版本 ${updateStatus.currentVersion}。`,
          tone: "success",
        });
        return;
      }

      const latestVersion = updateStatus.latestVersion || "未知版本";
      showToast({
        message: `发现新版本 ${latestVersion}，请先查看摘要后再安装。`,
        tone: "warning",
      });
    } catch (updateError) {
      setError(getCommandErrorMessage(updateError));
    } finally {
      setIsCheckingForUpdate(false);
    }
  }

  async function handleInstallUpdate() {
    if (!latestUpdateStatus?.available) {
      setError("请先检查更新，确认存在可安装的新版本。");
      return;
    }

    setIsInstallingUpdate(true);
    setError(undefined);

    try {
      const latestVersion = latestUpdateStatus.latestVersion || "未知版本";
      showToast({
        message: `正在下载并安装 ${latestVersion}。`,
        tone: "warning",
      });
      await downloadAndInstallAppUpdate();
      showToast({
        message: "更新已下载并开始安装，完成后请重新启动应用。",
        tone: "success",
      });
      setPendingAction(undefined);
    } catch (installError) {
      setError(getCommandErrorMessage(installError));
    } finally {
      setIsInstallingUpdate(false);
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
                    <strong>{category.label}</strong>
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
                          前端页面不会读取或展示明文，后续同步只通过本地 Rust 层完成。
                        </p>
                        <ul className="settings-onboarding-points">
                          <li>绑定后即可同步书架、笔记、统计和发现数据</li>
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
                      ? "同步会通过本地 Rust 层读取凭据；前端只知道是否已绑定。"
                      : "保存微信读书 Skill API Key 后即可同步书架、笔记、统计和发现数据。"}
                  </p>
                  <p className="credential-help-note">
                    会在新窗口打开技能页面；如果被拦截，链接会复制到剪贴板。
                  </p>
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
                      <p className="section-kicker">AI 总结</p>
                      <h3>
                        {aiState?.credential.hasCredential
                          ? "已配置 AI Provider"
                          : "未配置 AI Provider"}
                      </h3>
                    </div>
                  </div>
                  <p>
                    AI 总结只会在你点击生成时发送当前书的本地划线和想法到配置的
                    Provider； 不会自动上传书架、其他书笔记或任何 API Key。
                  </p>
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
                      <span>Base URL</span>
                      <input
                        value={aiBaseUrl}
                        type="url"
                        autoComplete="off"
                        placeholder="https://api.openai.com/v1"
                        onChange={(event) => setAiBaseUrl(event.target.value)}
                      />
                    </label>
                    <label className="credential-input">
                      <span>模型</span>
                      <input
                        value={aiModel}
                        type="text"
                        autoComplete="off"
                        placeholder="gpt-4o-mini"
                        onChange={(event) => setAiModel(event.target.value)}
                      />
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
                      onClick={() => setPendingAction("removeAiCredential")}
                      disabled={
                        !aiState?.credential.hasCredential ||
                        isSavingAiCredential ||
                        isTestingAiConnection
                      }
                    >
                      移除 AI Key
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
                      <h3>GitHub Releases 更新</h3>
                    </div>
                  </div>
                  <p>
                    先检查版本、发布时间和更新摘要，再决定是否安装；设置首页 Hero
                    区只保留当前分类说明和刷新操作。
                  </p>
                  <dl className="settings-dl settings-update-meta">
                    <div>
                      <dt>当前版本</dt>
                      <dd>
                        {state?.appVersion ||
                          latestUpdateStatus?.currentVersion ||
                          "尚未读取"}
                      </dd>
                    </div>
                    <div>
                      <dt>检查结果</dt>
                      <dd>{renderUpdateSummary(latestUpdateStatus)}</dd>
                    </div>
                    <div>
                      <dt>最新版本</dt>
                      <dd>{latestUpdateStatus?.latestVersion || "尚未检查"}</dd>
                    </div>
                    <div>
                      <dt>发布时间</dt>
                      <dd>
                        {formatReleaseDate(latestUpdateStatus?.publishedAt)}
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
                              releaseAuthorUrl,
                              "作者主页"
                            )
                          }
                        >
                          作者 @{releaseAuthor}
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
                              releaseRepositoryUrl,
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
                      <dd title={releaseFeedUrl}>{releaseFeedUrl}</dd>
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
                    <p>
                      {latestUpdateStatus?.notes?.trim() ||
                        "检查到新版本后，这里会显示 release 摘要。"}
                    </p>
                  </section>
                  <div className="settings-actions settings-card-actions">
                    <button
                      className="secondary-action"
                      type="button"
                      onClick={() => void handleCheckForUpdate()}
                      disabled={
                        isCheckingForUpdate || isInstallingUpdate || isLoading
                      }
                    >
                      {isCheckingForUpdate ? (
                        <Loader2
                          aria-hidden="true"
                          size={18}
                          className="spin"
                        />
                      ) : (
                        <Sparkles aria-hidden="true" size={18} />
                      )}
                      {isCheckingForUpdate ? "检查中" : "检查更新"}
                    </button>
                    <button
                      className="sync-button"
                      type="button"
                      onClick={() => setPendingAction("installUpdate")}
                      disabled={
                        !latestUpdateStatus?.available ||
                        isCheckingForUpdate ||
                        isInstallingUpdate
                      }
                    >
                      {isInstallingUpdate ? "安装中" : "安装更新"}
                    </button>
                  </div>
                </section>
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
            description="移除后将无法生成新的 AI 总结。已缓存的 AI 总结不会被删除，清除本地缓存时才会删除。"
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
            description="这只会删除已生成的 AI 总结、阅读报告和阅读指南缓存。API Key、微信读书缓存、本地阅读状态和导出文件不会被删除。"
            confirmLabel="确认清除"
            isDanger
            isBusy={isClearingAiOutputCache}
            onCancel={() => setPendingAction(undefined)}
            onConfirm={() => void handleClearAiOutputCache()}
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
            description={`将从 ${releasePageUrl} 下载并安装 ${latestUpdateStatus?.latestVersion || "新版本"}。安装完成后需要重新启动应用。`}
            confirmLabel="确认安装"
            isBusy={isInstallingUpdate}
            onCancel={() => setPendingAction(undefined)}
            onConfirm={() => void handleInstallUpdate()}
          />
        </div>
      </section>
    </div>
  );
}

function renderUpdateSummary(status?: AppUpdateStatus): string {
  if (!status) {
    return "尚未检查";
  }

  if (status.available) {
    return "发现新版本";
  }

  return "已是最新版本";
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
  return (
    <article className={`sync-state-row is-${state.status}`}>
      <div>
        <strong>{sectionLabels[state.section] ?? state.section}</strong>
        <small>{statusLabel(state.status)}</small>
      </div>
      <span>{formatTimestamp(state.lastSuccessAt) || "暂无成功同步"}</span>
      {state.errorMessage ? <p>{state.errorMessage}</p> : null}
    </article>
  );
}

function formatTimestamp(value?: string): string {
  if (!value) {
    return "暂无";
  }

  const timestamp = Number(value);
  return formatUnixDate(timestamp) || value;
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
    ai_outputs: "AI 总结",
    raw_cache: "原始缓存",
    sync_state: "同步状态",
    reading_item_states: "本地阅读状态",
  };

  return labels[table] ?? table;
}
