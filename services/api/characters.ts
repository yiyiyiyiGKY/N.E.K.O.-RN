/**
 * Characters API Service for React Native
 *
 * Handles character management API calls.
 * Backend router: main_routers/characters_router.py
 */

import { createRequestClient, type TokenStorage } from '@project_neko/request';

// ==================== Types ====================

export interface MasterProfile {
  档案名: string;
  昵称?: string;
  性别?: string;
  年龄?: string;
  性格?: string;
}

export interface CatgirlProfile {
  档案名?: string;
  昵称?: string;
  性别?: string;
  年龄?: string;
  性格?: string;
  背景故事?: string;
  system_prompt?: string;
  live2d?: string;
  live2d_item_id?: string;
  model_type?: 'live2d' | 'vrm';
  vrm?: string;
  vrm_animation?: string;
  voice_id?: string;
}

export interface CharactersData {
  主人: MasterProfile;
  猫娘: Record<string, CatgirlProfile>;
  当前猫娘?: string;
  当前麦克风?: string;
}

export interface ApiResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export interface CurrentCatgirlResponse {
  current_catgirl: string;
}

// ==================== Client Factory ====================

// Noop token storage for unauthenticated requests
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
 * Create characters API client
 */
export function createCharactersApiClient(apiBase: string) {
  const client = createRequestClient({
    baseURL: apiBase,
    storage: noopStorage,
    refreshApi: failedRefresh,
    returnDataOnly: true,
  });

  return {
    /**
     * Get all characters data (master + catgirls)
     * GET /api/characters/
     */
    async getCharacters(language?: string): Promise<CharactersData> {
      const params = language ? { language } : {};
      return client.get('/characters/', { params });
    },

    /**
     * Update master profile
     * POST /api/characters/master
     */
    async updateMaster(profile: MasterProfile): Promise<ApiResponse> {
      return client.post('/characters/master', profile);
    },

    /**
     * Add new catgirl
     * POST /api/characters/catgirl
     */
    async addCatgirl(profile: CatgirlProfile): Promise<ApiResponse> {
      return client.post('/characters/catgirl', profile);
    },

    /**
     * Update catgirl profile
     * PUT /api/characters/catgirl/:name
     */
    async updateCatgirl(name: string, profile: Partial<CatgirlProfile>): Promise<ApiResponse> {
      return client.put(`/characters/catgirl/${encodeURIComponent(name)}`, profile);
    },

    /**
     * Delete catgirl
     * DELETE /api/characters/catgirl/:name
     */
    async deleteCatgirl(name: string): Promise<ApiResponse> {
      return client.delete(`/characters/catgirl/${encodeURIComponent(name)}`);
    },

    /**
     * Rename catgirl
     * POST /api/characters/catgirl/:old_name/rename
     */
    async renameCatgirl(oldName: string, newName: string): Promise<ApiResponse> {
      return client.post(`/characters/catgirl/${encodeURIComponent(oldName)}/rename`, {
        new_name: newName,
      });
    },

    /**
     * Get current catgirl name
     * GET /api/characters/current_catgirl
     */
    async getCurrentCatgirl(): Promise<CurrentCatgirlResponse> {
      return client.get('/characters/current_catgirl');
    },

    /**
     * Set current catgirl
     * POST /api/characters/current_catgirl
     */
    async setCurrentCatgirl(catgirlName: string): Promise<ApiResponse> {
      return client.post('/characters/current_catgirl', { catgirl_name: catgirlName });
    },
  };
}

// ==================== Helper Functions ====================

// Frontend character interface (for UI state)
export interface Character {
  id: string;
  name: string;
  nickname?: string;
  gender?: string;
  age?: string;
  personality?: string;
  backstory?: string;
  systemPrompt?: string;
  live2dModel?: string;
  voiceId?: string;
}

// Convert backend CatgirlProfile to frontend Character
export function catgirlToCharacter(name: string, profile: CatgirlProfile): Character {
  return {
    id: name,
    name: name,
    nickname: profile.昵称,
    gender: profile.性别,
    age: profile.年龄,
    personality: profile.性格,
    backstory: profile.背景故事,
    systemPrompt: profile.system_prompt,
    live2dModel: profile.live2d,
    voiceId: profile.voice_id,
  };
}

// Convert frontend Character to backend CatgirlProfile
export function characterToCatgirl(character: Character): CatgirlProfile {
  const profile: CatgirlProfile = {
    档案名: character.name,
  };
  if (character.nickname) profile.昵称 = character.nickname;
  if (character.gender) profile.性别 = character.gender;
  if (character.age) profile.年龄 = character.age;
  if (character.personality) profile.性格 = character.personality;
  if (character.backstory) profile.背景故事 = character.backstory;
  if (character.systemPrompt) profile.system_prompt = character.systemPrompt;
  if (character.live2dModel) profile.live2d = character.live2dModel;
  if (character.voiceId) profile.voice_id = character.voiceId;
  return profile;
}

// Convert backend MasterProfile to frontend state
export function masterToState(profile: MasterProfile): { name: string; nickname?: string; gender?: string } {
  return {
    name: profile.档案名 || '',
    nickname: profile.昵称,
    gender: profile.性别,
  };
}
