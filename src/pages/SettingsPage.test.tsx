import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  canUseEmbeddingProvider,
  isOllamaEndpoint,
} from "../components/SemanticIndexSettingsCard";
import { ToastProvider } from "../components/ToastProvider";
import { DEFAULT_USER_PREFERENCES } from "../lib/preferences";
import {
  formatTimestamp,
  normalizeImaKnowledgePath,
  SettingsPage,
} from "./SettingsPage";

describe("settings page onboarding artwork", () => {
  it("formats Notion schema check times as readable local date-times", () => {
    expect(formatTimestamp("2026-08-01T09:37:41.287526500+00:00")).toBe("2026年8月1日 17:37");
    expect(formatTimestamp("1785577061")).toBe("2026年8月1日 17:37");
    expect(formatTimestamp("not-a-timestamp")).toBe("暂无");
  });

  it("shows local vault onboarding guidance when WeRead credential is missing", () => {
    const markup = renderToStaticMarkup(
      <ToastProvider>
        <SettingsPage
          open
          credentialStatus={{ hasCredential: false }}
          onCredentialChange={() => undefined}
          preferences={DEFAULT_USER_PREFERENCES}
          onPreferencesChange={() => undefined}
          onClose={() => undefined}
        />
      </ToastProvider>
    );

    expect(markup).toContain("onboarding-local-vault");
    expect(markup).toContain("API Key 来自微信读书 Skill 页面，只保存在当前设备");
    expect(markup).toContain("页面不会显示已保存密钥");
  });

  it("does not show onboarding artwork after WeRead credential is already saved", () => {
    const markup = renderToStaticMarkup(
      <ToastProvider>
        <SettingsPage
          open
          credentialStatus={{ hasCredential: true }}
          onCredentialChange={() => undefined}
          preferences={DEFAULT_USER_PREFERENCES}
          onPreferencesChange={() => undefined}
          onClose={() => undefined}
        />
      </ToastProvider>
    );

    expect(markup).not.toContain("onboarding-local-vault");
    expect(markup).not.toContain("API Key 来自微信读书 Skill 页面，只保存在当前设备");
  });

  it("shows a dedicated updates category in settings navigation", () => {
    const markup = renderToStaticMarkup(
      <ToastProvider>
        <SettingsPage
          open
          credentialStatus={{ hasCredential: true }}
          onCredentialChange={() => undefined}
          preferences={DEFAULT_USER_PREFERENCES}
          onPreferencesChange={() => undefined}
          onClose={() => undefined}
        />
      </ToastProvider>
    );

    expect(markup).toContain("应用更新");
    expect(markup).toContain("版本、发布、安装");
  });

  it("defaults Ima knowledge publication off and labels an unchecked version as unconfirmed", () => {
    const markup = renderToStaticMarkup(
      <ToastProvider>
        <SettingsPage
          open
          credentialStatus={{ hasCredential: true }}
          onCredentialChange={() => undefined}
          preferences={DEFAULT_USER_PREFERENCES}
          onPreferencesChange={() => undefined}
          onClose={() => undefined}
          preferredCategory="export"
        />
      </ToastProvider>
    );

    expect(markup).toContain("版本状态未确认");
    expect(markup).toContain(
      '<input type="checkbox"/><span>创建笔记后加入知识库</span>',
    );
    expect(markup).toContain("按层浏览后选择目标目录，不会自动回退到根目录。");
    expect(markup).toContain("没有子文件夹时，可以直接使用知识库根目录；在 Ima 创建文件夹后再刷新。");
    expect(markup).toContain('aria-label="当前浏览目录"');
  });

  it("does not render root markers as duplicated knowledge-folder breadcrumbs", () => {
    expect(
      normalizeImaKnowledgePath([
        { folderId: "root", name: "根目录" },
        { folderId: "0", name: "旧根目录" },
        { folderId: "chapter-1", name: "书籍复盘", parentFolderId: "root" },
      ]),
    ).toEqual([
      { folderId: "chapter-1", name: "书籍复盘", parentFolderId: "root" },
    ]);
  });

  it("shows a dedicated support category with reward and contact qrs", () => {
    const markup = renderToStaticMarkup(
      <ToastProvider>
        <SettingsPage
          open
          credentialStatus={{ hasCredential: true }}
          onCredentialChange={() => undefined}
          preferences={DEFAULT_USER_PREFERENCES}
          onPreferencesChange={() => undefined}
          onClose={() => undefined}
          preferredCategory="support"
        />
      </ToastProvider>
    );

    expect(markup).toContain("关于与支持");
    expect(markup).toContain("开源项目，感谢支持");
    expect(markup).toContain("赞赏作者");
    expect(markup).toContain("联系作者");
    expect(markup).toContain("赞赏不会解锁功能");
    expect(markup).toContain("应用不会读取或上传联系人信息");
    expect(markup).toContain("RHZ 的赞赏码");
    expect(markup).toContain("RHZ 微信联系方式二维码");
  });

  it("keeps update destination metadata available for the updates category", () => {
    const markup = renderToStaticMarkup(
      <ToastProvider>
        <SettingsPage
          open
          credentialStatus={{ hasCredential: true }}
          onCredentialChange={() => undefined}
          preferences={DEFAULT_USER_PREFERENCES}
          onPreferencesChange={() => undefined}
          onClose={() => undefined}
        />
      </ToastProvider>
    );

    expect(markup).toContain("应用更新");
    expect(markup).toContain("版本、发布、安装");
  });

  it("shows provider presets and response format policy in AI settings", () => {
    const markup = renderToStaticMarkup(
      <ToastProvider>
        <SettingsPage
          open
          credentialStatus={{ hasCredential: true }}
          onCredentialChange={() => undefined}
          preferences={DEFAULT_USER_PREFERENCES}
          onPreferencesChange={() => undefined}
          onClose={() => undefined}
          preferredCategory="ai"
        />
      </ToastProvider>
    );

    expect(markup).toContain("Provider 预设");
    expect(markup).toContain("DeepSeek");
    expect(markup).toContain("通义千问");
    expect(markup).toContain("R-API");
    expect(markup).toContain("兼容模式");
    expect(markup).toContain("宽松兼容");
    expect(markup).toContain("测试兼容性");
    expect(markup).toContain("输入模型名，或刷新后从候选中选择");
    expect(markup).toContain("刷新可用模型");
    expect(markup.indexOf("测试兼容性")).toBeLessThan(markup.indexOf("AI 阅读助手"));
  });

  it("allows an Ollama native endpoint without an API key", () => {
    expect(isOllamaEndpoint("http://localhost:11434/api/embed")).toBe(true);
    expect(isOllamaEndpoint("http://localhost:11434/api/embed/")).toBe(true);
    expect(isOllamaEndpoint("http://localhost:11434/v1")).toBe(false);
    expect(
      canUseEmbeddingProvider(
        "http://localhost:11434/api/embed",
        "qwen3-embedding:4b",
        "",
        false,
      ),
    ).toBe(true);
    expect(
      canUseEmbeddingProvider("https://api.openai.com/v1", "text-embedding-3-small", "", false),
    ).toBe(false);
  });

  it("shows a separate semantic index provider and privacy boundary", () => {
    const markup = renderToStaticMarkup(
      <ToastProvider>
        <SettingsPage
          open
          credentialStatus={{ hasCredential: true }}
          onCredentialChange={() => undefined}
          preferences={DEFAULT_USER_PREFERENCES}
          onPreferencesChange={() => undefined}
          onClose={() => undefined}
          preferredCategory="ai"
        />
      </ToastProvider>
    );

    expect(markup).toContain("语义索引");
    expect(markup).toContain("Embedding Base URL");
    expect(markup).toContain("OpenAI-compatible Provider 或 Ollama 原生接口");
    expect(markup).toContain("独立保存，不复用聊天 AI Key");
    expect(markup).toContain("允许发送笔记正文生成向量");
    expect(markup).toContain("普通笔记查询会自动融合本地词法与语义召回");
    expect(markup.indexOf("语义索引")).toBeLessThan(markup.indexOf("AI 阅读助手"));
  });

  it("shows reading assistant privacy controls in AI settings", () => {
    const markup = renderToStaticMarkup(
      <ToastProvider>
        <SettingsPage
          open
          credentialStatus={{ hasCredential: true }}
          onCredentialChange={() => undefined}
          preferences={DEFAULT_USER_PREFERENCES}
          onPreferencesChange={() => undefined}
          onClose={() => undefined}
          preferredCategory="ai"
        />
      </ToastProvider>
    );

    expect(markup).toContain("对话助手");
    expect(markup).toContain("个性化上下文");
    expect(markup).toContain("原始笔记片段");
    expect(markup).toContain("保存对话历史");
    expect(markup).toContain("清空对话历史");
  });

  it("states the exact SQLite and browser-storage backup boundary", () => {
    const markup = renderToStaticMarkup(
      <ToastProvider>
        <SettingsPage
          open
          credentialStatus={{ hasCredential: true }}
          onCredentialChange={() => undefined}
          preferences={DEFAULT_USER_PREFERENCES}
          onPreferencesChange={() => undefined}
          onClose={() => undefined}
          preferredCategory="advanced"
        />
      </ToastProvider>
    );

    expect(markup).toContain("本地备份数据边界");
    expect(markup).toContain("本地 SQLite 数据库");
    expect(markup).toContain("WAL/SHM");
    expect(markup).toContain("Notion");
    expect(markup).toContain("安全存储文件");
    expect(markup).toContain("本地划线、想法、AI 提问草稿和记录、阅读器偏好");
    expect(markup).toContain("微信版本与本地版本的人工关联");
  });

  it("uses a user-owned Notion database as the primary export path", () => {
    const markup = renderToStaticMarkup(
      <ToastProvider>
        <SettingsPage
          open
          credentialStatus={{ hasCredential: true }}
          onCredentialChange={() => undefined}
          preferences={DEFAULT_USER_PREFERENCES}
          onPreferencesChange={() => undefined}
          onClose={() => undefined}
          preferredCategory="export"
        />
      </ToastProvider>
    );

    expect(markup).toContain("Notion 导出");
    expect(markup).toContain("连接已有数据库");
    expect(markup).toContain("检查数据库");
    expect(markup).toContain("标准阅读成果库");
    expect(markup).not.toContain("Books Tracker + 阅读成果库");
    expect(markup).not.toContain("创建基础工作台");
  });
});
