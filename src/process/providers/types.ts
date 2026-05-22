export type ProviderId =
  | 'anthropic'
  | 'openai'
  | 'google-gemini'
  | 'aws-bedrock'
  | 'vertex'
  | 'openrouter'
  | 'groq'
  | 'xai'
  | 'mistral'
  | 'cohere'
  | 'perplexity'
  | 'together'
  | 'fireworks'
  | 'cerebras'
  | 'replicate'
  | 'huggingface'
  | 'nvidia'
  | 'anyscale'
  | 'deepseek'
  | 'moonshot'
  | 'qwen'
  | 'baichuan'
  | 'lingyiwanwu'
  | 'zhipu-glm'
  | 'minimax'
  | 'stability'
  | 'deepgram'
  | 'assemblyai'
  | 'elevenlabs'
  | 'azure'
  | 'openai-compatible';

export type ModelTier = 'flagship' | 'everyday' | 'fast' | 'reasoning' | 'legacy';

export type Capability = 'chat' | 'vision' | 'image' | 'audio' | 'embeddings' | 'reasoning';

export type ProviderModel = {
  id: string;
  displayName: string;
  userDisplayName?: string;
  tier: ModelTier;
  capabilities: Capability[];
  enabled: boolean;
  deprecated?: boolean;
  deprecatedAt?: number;
  contextWindow?: number;
  pricing?: { inUSDPerMillion?: number; outUSDPerMillion?: number };
};

export type DetectionResult =
  | { kind: 'unique'; provider: ProviderId; confidence: 'high' }
  | { kind: 'ambiguous-sk'; candidates: ProviderId[] }
  | { kind: 'structural'; provider: ProviderId; confidence: 'medium' }
  | { kind: 'multi-field'; provider: ProviderId; requiredFields: string[] }
  | { kind: 'unknown' };

// --- Models & Providers redesign (Wave 0 contract) ------------------------
// Two-tier model store: CatalogSources emit RawModel[]; those are enriched by
// the models.dev registry into persisted CatalogModel[]; a pure Curator
// derives a CuratedModel[] view (latest + one revision back per family).

export type ModelKind = 'text' | 'image' | 'audio' | 'embedding' | 'other';

/** Unenriched model identity straight off a CatalogSource. */
export type RawModel = { id: string; providerId: ProviderId; rawName?: string };

/** A model enriched by the models.dev registry and persisted to the catalog. */
export type CatalogModel = {
  id: string;
  providerId: ProviderId;
  displayName: string;
  family: string;
  kind: ModelKind;
  releaseDate?: string;
  contextWindow?: number;
  costInPerM?: number;
  costOutPerM?: number;
  status?: 'available' | 'preview' | 'deprecated';
  /** false = no models.dev match. */
  enriched: boolean;
};

/** A curated view of a CatalogModel for the chat model picker. */
export type CuratedModel = CatalogModel & {
  recommended: boolean;
  enabled: boolean;
  role?: 'flagship' | 'previous' | 'fast';
};

/** Live connection state of a provider in the model registry. */
export type ProviderConnState = 'connected' | 'testing' | 'error';

/** Classified failure reason from a connect / test-connection attempt. */
export type ConnectError = 'unauthorized' | 'no-credit' | 'offline' | 'unrecognized' | 'no-models' | 'unknown';
