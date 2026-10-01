import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

type Selection = { id: string; modelId: string };
export class ModelSettings {
  constructor(
    private readonly db: Store,
    private readonly config: Config,
  ) {}
  async restore() {
    const selection = await this.db.get<Selection>("local-user", "model-settings", "active");
    if (!selection) return;
    if (!this.config.modelGatewayUrl || !this.config.modelGatewayKey)
      throw new Error(
        "The saved model requires the configured model gateway. No direct-provider fallback is allowed.",
      );
    this.config.model = `openai/${selection.modelId}`;
  }
  async catalog() {
    const { modelGatewayUrl, modelGatewayKey, model } = this.config;
    if (!modelGatewayUrl || !modelGatewayKey)
      return { configured: false, activeModel: null, models: [] };
    const url = new URL(`${modelGatewayUrl.replace(/\/$/, "")}/models`);
    if (!["http:", "https:"].includes(url.protocol))
      throw new AppError("Invalid model gateway URL", 503);
    let payload: unknown;
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${modelGatewayKey}` },
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      });
      if (!response.ok) throw new Error("Gateway unavailable");
      payload = await response.json();
    } catch {
      throw new AppError(
        "Cannot load the OmniRoute model catalog. Check the server's gateway connection.",
        503,
      );
    }
    if (
      !payload ||
      typeof payload !== "object" ||
      !("data" in payload) ||
      !Array.isArray(payload.data)
    )
      throw new AppError("The model gateway returned an invalid catalog", 503);
    const models = [
      ...new Set(
        payload.data.flatMap((entry: unknown) => {
          if (
            !entry ||
            typeof entry !== "object" ||
            !("id" in entry) ||
            typeof entry.id !== "string"
          )
            return [];
          return entry.id.length > 0 &&
            entry.id.length <= 512 &&
            !Array.from(entry.id).some(
              (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
            )
            ? [entry.id]
            : [];
        }),
      ),
    ].sort();
    return {
      configured: true,
      activeModel: model?.startsWith("openai/") ? model.slice(7) : null,
      models,
    };
  }
  async select(modelId: string) {
    const catalog = await this.catalog();
    if (!catalog.configured)
      throw new AppError("Configure the OmniRoute connection on the server first", 503);
    if (!catalog.models.includes(modelId))
      throw new AppError("Choose a model from the current OmniRoute catalog", 422);
    await this.db.put("local-user", "model-settings", { id: "active", modelId });
    this.config.model = `openai/${modelId}`;
    return { activeModel: modelId };
  }
}
