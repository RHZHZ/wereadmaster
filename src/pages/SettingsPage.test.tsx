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
    expect(markup).toContain("API Key 只保存在当前设备");
    expect(markup).toContain("前端页面不会读取或展示明文");
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
    expect(markup).not.toContain("API Key 只保存在当前设备");
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
});
