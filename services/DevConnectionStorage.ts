import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_DEV_CONNECTION_CONFIG, type DevConnectionConfig } from '@/utils/devConnectionConfig';

const STORAGE_KEY = 'NEKO_DEV_CONNECTION_CONFIG_V1';

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isValidPort(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 65536;
}

function sanitizePartial(input: any): Partial<DevConnectionConfig> {
  const out: Partial<DevConnectionConfig> = {};
  if (isNonEmptyString(input?.host)) out.host = input.host.trim();
  if (isValidPort(input?.port)) out.port = input.port;
  if (isNonEmptyString(input?.characterName)) out.characterName = input.characterName.trim();
  return out;
}

export async function getStoredDevConnectionConfig(): Promise<DevConnectionConfig> {
  // 环境变量优先：如果设置了任一环境变量，直接使用，忽略 AsyncStorage
  const envConfig: Partial<DevConnectionConfig> = {};
  if (process.env.EXPO_PUBLIC_DEV_HOST) envConfig.host = process.env.EXPO_PUBLIC_DEV_HOST;
  if (process.env.EXPO_PUBLIC_DEV_PORT) envConfig.port = Number(process.env.EXPO_PUBLIC_DEV_PORT);
  if (process.env.EXPO_PUBLIC_DEV_CHARACTER) envConfig.characterName = process.env.EXPO_PUBLIC_DEV_CHARACTER;

  if (Object.keys(envConfig).length > 0) {
    return { ...DEFAULT_DEV_CONNECTION_CONFIG, ...envConfig };
  }

  // 无环境变量时，从 AsyncStorage 读取
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_DEV_CONNECTION_CONFIG;
    const parsed = JSON.parse(raw);
    const partial = sanitizePartial(parsed);
    return { ...DEFAULT_DEV_CONNECTION_CONFIG, ...partial };
  } catch {
    return DEFAULT_DEV_CONNECTION_CONFIG;
  }
}

export async function setStoredDevConnectionConfig(
  next: Partial<DevConnectionConfig> | DevConnectionConfig
): Promise<DevConnectionConfig> {
  let current: DevConnectionConfig = DEFAULT_DEV_CONNECTION_CONFIG;
  try {
    current = await getStoredDevConnectionConfig();
    const merged: DevConnectionConfig = { ...current, ...sanitizePartial(next) };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    return merged;
  } catch (error) {
    console.error('[DevConnectionStorage] Failed to persist dev connection config', error);
    // Fallback: return the last known-good config so callers still get a DevConnectionConfig.
    return current;
  }
}

export async function clearStoredDevConnectionConfig(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error(`[DevConnectionStorage] Failed to clear dev connection config for key "${STORAGE_KEY}"`, error);
    // Swallow error: callers expect this to resolve to void.
  }
}

