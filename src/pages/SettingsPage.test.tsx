import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ToastProvider } from "../components/ToastProvider";
import { DEFAULT_USER_PREFERENCES } from "../lib/preferences";
import { SettingsPage } from "./SettingsPage";

describe("settings page onboarding artwork", () => {
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
    expect(markup).toContain("兼容模式");
    expect(markup).toContain("宽松兼容");
    expect(markup).toContain("测试兼容性");
    expect(markup).toContain("输入模型名，或刷新后从候选中选择");
    expect(markup).toContain("刷新可用模型");
  });
});
