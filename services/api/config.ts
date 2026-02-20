/**
 * Config API Service for React Native
 *
 * Handles configuration API calls.
 * Backend router: main_routers/config_router.py
 */

import { createRequestClient, type TokenStorage } from '@project_neko/request';

// ==================== Types ====================

export interface CoreConfig {
  api_key?: string;
  coreApi?: string;
  assistApi?: string;
  assistApiKeyQwen?: string;
  assistApiKeyOpenai?: string;
  assistApiKeyGlm?: string;
  assistApiKeyStep?: string;
  assistApiKeySilicon?: string;
  assistApiKeyGemini?: string;
  mcpToken?: string;
  enableCustomApi?: boolean;
  summaryModelProvider?: string;
  summaryModelUrl?: string;
  summaryModelId?: string;
  summaryModelApiKey?: string;
  correctionModelProvider?: string;
  correctionModelUrl?: string;
  correctionModelId?: string;
  correctionModelApiKey?: string;
  emotionModelProvider?: string;
  emotionModelUrl?: string;
  emotionModelId?: string;
  emotionModelApiKey?: string;
  visionModelProvider?: string;
  visionModelUrl?: string;
  visionModelId?: string;
  visionModelApiKey?: string;
  agentModelProvider?: string;
  agentModelUrl?: string;
  agentModelId?: string;
  agentModelApiKey?: string;
  omniModelProvider?: string;
  omniModelUrl?: string;
  omniModelId?: string;
  omniModelApiKey?: string;
  ttsModelProvider?: string;
  ttsModelUrl?: string;
  ttsModelId?: string;
  ttsModelApiKey?: string;
  ttsVoiceId?: string;
  [key: string]: any;
}

export interface ApiProvider {
  id: string;
  name: string;
}

export interface ApiProvidersResponse {
  success: boolean;
  core_api_providers?: ApiProvider[];
  assist_api_providers?: ApiProvider[];
}

export interface Preferences {
  theme?: string;
  language?: string;
  [key: string]: any;
}

export interface ApiResponse {
  success: boolean;
  message?: string;
  error?: string;
}

// ==================== Client Factory ====================

class NoopTokenStorage implements TokenStorage {
  async getAccessToken(): Promise<string | null> { return null; }
  async setAccessToken(_token: string): Promise<void> {}
  async getRefreshToken(): Promise<string | null> { return null; }
  async setRefreshToken(_token: string): Promise<void> {}
  async clearTokens(): Promise<void> {}
}

const noopStorage = new NoopTokenStorage();
const failedRefresh = async () => { throw new Error('No refresh token'); };

/**
 * Create config API client
 */
export function createConfigApiClient(apiBase: string) {
  const client = createRequestClient({
    baseURL: apiBase,
    storage: noopStorage,
    refreshApi: failedRefresh,
    returnDataOnly: true,
  });

  return {
    /**
     * Get core config
     * GET /api/config/core_api
     */
    async getCoreConfig(): Promise<CoreConfig> {
      return client.get('/config/core_api');
    },

    /**
     * Update core config
     * POST /api/config/core_api
     */
    async updateCoreConfig(data: Partial<CoreConfig>): Promise<ApiResponse> {
      return client.post('/config/core_api', data);
    },

    /**
     * Get API providers
     * GET /api/config/api_providers
     */
    async getApiProviders(): Promise<ApiProvidersResponse> {
      return client.get('/config/api_providers');
    },

    /**
     * Get preferences
     * GET /api/config/preferences
     */
    async getPreferences(): Promise<Preferences> {
      return client.get('/config/preferences');
    },

    /**
     * Save preferences
     * POST /api/config/preferences
     */
    async savePreferences(prefs: Partial<Preferences>): Promise<ApiResponse> {
      return client.post('/config/preferences', prefs);
    },
  };
}
