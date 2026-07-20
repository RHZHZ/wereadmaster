import { describe, expect, it } from "vitest";
import {
  AI_PROVIDER_PRESETS,
  getAiProviderPreset,
  normalizeAiProviderPresetId,
  normalizeAiResponseFormatPolicy,
} from "./ai-provider-presets";

describe("AI provider presets", () => {
  it("keeps preset ids unique and defaults editable", () => {
    const ids = AI_PROVIDER_PRESETS.map((preset) => preset.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(getAiProviderPreset("deepseek")).toMatchObject({
      defaultBaseUrl: "https://api.deepseek.com/v1",
      responseFormatPolicy: "noResponseFormatFirst",
    });
    expect(getAiProviderPreset("custom")).toMatchObject({
      defaultBaseUrl: "",
      defaultModel: "",
      responseFormatPolicy: "auto",
    });
    expect(getAiProviderPreset("r-api")).toMatchObject({
      label: "R-API",
      defaultBaseUrl: "https://api.cccc.asia",
      defaultModel: "gpt-4o-mini",
      responseFormatPolicy: "auto",
    });
  });

  it("normalizes unknown provider metadata safely", () => {
    expect(normalizeAiProviderPresetId("deepseek")).toBe("deepseek");
    expect(normalizeAiProviderPresetId("r-api")).toBe("r-api");
    expect(normalizeAiProviderPresetId("unknown")).toBe("custom");
    expect(normalizeAiResponseFormatPolicy("jsonObjectFirst")).toBe(
      "jsonObjectFirst",
    );
    expect(normalizeAiResponseFormatPolicy("strict-json")).toBe("auto");
  });
});
