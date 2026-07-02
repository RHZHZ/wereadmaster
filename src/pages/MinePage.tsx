import {
  BarChart3,
  Bot,
  ChevronRight,
  Compass,
  Database,
  Download,
  Eye,
  KeyRound,
  Library,
  Network,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { BookshelfResponse } from "../lib/reading-api";
import type { CredentialStatus } from "../lib/types";
import type { SettingsCategoryId } from "./SettingsPage";

type MinePageProps = {
  credentialStatus?: CredentialStatus;
  bookshelf?: BookshelfResponse;
  isSyncing: boolean;
  onSync: () => void;
  onOpenStats: () => void;
  onOpenDiscovery: () => void;
  onOpenSettings: (category?: SettingsCategoryId) => void;
  onOpenLocalLibrary: () => void;
};

type MineShortcut = {
  label: string;
  description: string;
  icon: LucideIcon;
  onClick: () => void;
};

type MineLink = {
  label: string;
  description: string;
  icon: LucideIcon;
  onClick: () => void;
};

type MineLinkSection = {
  title: string;
  links: MineLink[];
};

export function MinePage({
  credentialStatus,
  bookshelf,
  isSyncing,
  onSync,
  onOpenStats,
  onOpenDiscovery,
  onOpenSettings,
  onOpenLocalLibrary,
}: MinePageProps) {
  const credentialLabel =
    credentialStatus?.hasCredential === true ? "凭据已配置" : "等待配置凭据";
  const syncLabel = formatSyncState(bookshelf);
  const totalVisibleEntries = bookshelf?.snapshot.summary.totalVisibleEntries ?? 0;
  const noteCount = bookshelf?.snapshot.summary.bookCount ?? 0;
  const shortcuts: MineShortcut[] = [
    {
      label: "统计",
      description: "阅读时间和偏好",
      icon: BarChart3,
      onClick: onOpenStats,
    },
    {
      label: "发现",
      description: "搜索和推荐",
      icon: Compass,
      onClick: onOpenDiscovery,
    },
    {
      label: "设置",
      description: "账户、AI、外观",
      icon: Settings,
      onClick: () => onOpenSettings(),
    },
    {
      label: "本地数据",
      description: "缓存和诊断",
      icon: Database,
      onClick: () => onOpenSettings("advanced"),
    },
  ];
  const sections: MineLinkSection[] = [
    {
      title: "阅读与数据",
      links: [
        {
          label: "阅读统计",
          description: "查看时间、偏好和周期报告",
          icon: BarChart3,
          onClick: onOpenStats,
        },
        {
          label: "搜索与推荐",
          description: "从书架出发发现下一本书",
          icon: Compass,
          onClick: onOpenDiscovery,
        },
        {
          label: "本地书库管理",
          description: "管理 EPUB、TXT、Markdown 书籍",
          icon: Library,
          onClick: onOpenLocalLibrary,
        },
        {
          label: "导出设置",
          description: "管理笔记、复盘和诊断导出位置",
          icon: Download,
          onClick: () => onOpenSettings("export"),
        },
      ],
    },
    {
      title: "系统设置",
      links: [
        {
          label: "账户与同步",
          description: "配置微信读书凭据和同步能力",
          icon: KeyRound,
          onClick: () => onOpenSettings("account"),
        },
        {
          label: "AI 服务配置",
          description: "设置 Provider、模型和 API Key",
          icon: Bot,
          onClick: () => onOpenSettings("ai"),
        },
        {
          label: "外观与阅读偏好",
          description: "调整主题、字号和默认入口",
          icon: Eye,
          onClick: () => onOpenSettings("appearance"),
        },
        {
          label: "更新与关于",
          description: "检查版本和发布说明",
          icon: Sparkles,
          onClick: () => onOpenSettings("updates"),
        },
      ],
    },
    {
      title: "本地安全",
      links: [
        {
          label: "代理与网络诊断",
          description: "排查 Android 微信读书同步网络问题",
          icon: Network,
          onClick: () => onOpenSettings("account"),
        },
        {
          label: "缓存、数据库与诊断",
          description: "查看本地缓存状态并导出诊断",
          icon: Database,
          onClick: () => onOpenSettings("advanced"),
        },
      ],
    },
  ];

  return (
    <section className="mine-page" aria-label="我的">
      <section className="mine-status-card">
        <div className="mine-status-heading">
          <span className="mine-status-icon" aria-hidden="true">
            <ShieldCheck size={24} />
          </span>
          <div>
            <p className="section-kicker">WxReadMaster</p>
            <h3>本机阅读工作台</h3>
          </div>
        </div>
        <p>
          API Key 和阅读数据只保存在本机。这里集中管理同步、设置、诊断和低频入口。
        </p>
        <div className="mine-status-grid" aria-label="本机状态">
          <StatusItem label="凭据" value={credentialLabel} />
          <StatusItem label="同步" value={syncLabel} />
          <StatusItem label="书架" value={`${totalVisibleEntries} 个条目`} />
          <StatusItem label="书籍" value={`${noteCount} 本书`} />
        </div>
        <button
          type="button"
          className="sync-button mine-sync-button"
          disabled={isSyncing}
          onClick={onSync}
        >
          <RefreshCw
            aria-hidden="true"
            size={18}
            className={isSyncing ? "spin" : undefined}
          />
          {isSyncing ? "同步中" : "立即同步"}
        </button>
      </section>

      <section className="mine-shortcut-grid" aria-label="快捷入口">
        {shortcuts.map((shortcut) => (
          <button
            key={shortcut.label}
            type="button"
            className="mine-shortcut-card"
            onClick={shortcut.onClick}
          >
            <shortcut.icon aria-hidden="true" size={22} />
            <strong>{shortcut.label}</strong>
            <span>{shortcut.description}</span>
          </button>
        ))}
      </section>

      {sections.map((section) => (
        <section key={section.title} className="mine-link-section">
          <h3>{section.title}</h3>
          <div className="mine-link-list">
            {section.links.map((link) => (
              <button
                key={link.label}
                type="button"
                className="mine-link-item"
                onClick={link.onClick}
              >
                <span className="mine-link-icon" aria-hidden="true">
                  <link.icon size={20} />
                </span>
                <span>
                  <strong>{link.label}</strong>
                  <small>{link.description}</small>
                </span>
                <ChevronRight aria-hidden="true" size={17} />
              </button>
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="mine-status-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatSyncState(bookshelf?: BookshelfResponse): string {
  const syncState = bookshelf?.syncState;

  if (!syncState) {
    return "尚未读取";
  }

  if (syncState.status === "syncing") {
    return "正在同步";
  }

  if (syncState.status === "failed") {
    return "同步失败";
  }

  if (syncState.lastSuccessAt) {
    return formatDateTime(syncState.lastSuccessAt);
  }

  return syncState.status === "success" ? "已同步" : "尚未同步";
}

function formatDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");

  return `${month}-${day} ${hour}:${minute}`;
}
