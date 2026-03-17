import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { I18nManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// 导入语言包
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import en from './locales/en.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import ru from './locales/ru.json';

const LANGUAGE_STORAGE_KEY = 'neko_language';

// 支持的语言列表
export const SUPPORTED_LANGUAGES = [
  { code: 'zh-CN', name: '简体中文' },
  { code: 'zh-TW', name: '繁体中文' },
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'ru', name: 'Русский' },
] as const;

export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number]['code'];

// 获取系统语言
export function getSystemLanguage(): string {
  let deviceLanguage = 'zh';
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    deviceLanguage = locale.split('-')[0];
  } catch {
    // fallback to zh-CN
  }

  // 映射系统语言到支持的语言
  const langMap: Record<string, string> = {
    'zh': 'zh-CN',
    'en': 'en',
    'ja': 'ja',
    'ko': 'ko',
    'ru': 'ru',
  };

  return langMap[deviceLanguage] || 'zh-CN';
}

// 从存储获取语言
export async function getStoredLanguage(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

// 保存语言设置
export async function setStoredLanguage(language: string): Promise<void> {
  try {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch (e) {
    console.error('Failed to save language:', e);
  }
}

// 获取初始语言
export async function getInitialLanguage(): Promise<string> {
  const stored = await getStoredLanguage();
  if (stored && SUPPORTED_LANGUAGES.some(l => l.code === stored)) {
    return stored;
  }
  return getSystemLanguage();
}

// i18n 配置
export const i18nConfig = {
  resources: {
    'zh-CN': { translation: zhCN },
    'zh-TW': { translation: zhTW },
    'en': { translation: en },
    'ja': { translation: ja },
    'ko': { translation: ko },
    'ru': { translation: ru },
  },
  fallbackLng: 'zh-CN',
  interpolation: {
    escapeValue: false,
  },
  react: {
    useSuspense: false,
  },
};

// 初始化 i18n
export async function initI18n(): Promise<void> {
  const initialLanguage = await getInitialLanguage();

  await i18n
    .use(initReactI18next)
    .init({
      ...i18nConfig,
      lng: initialLanguage,
    });

  // 设置 RTL（如果需要）
  I18nManager.allowRTL(false);
}

// 切换语言
export async function changeLanguage(language: SupportedLanguage): Promise<void> {
  await i18n.changeLanguage(language);
  await setStoredLanguage(language);

  // 对于 RTL 语言可能需要重启应用
  // const isRTL = language === 'ar' || language === 'he';
  // if (I18nManager.isRTL !== isRTL) {
  //   RNRestart.Restart();
  // }
}

// 导出 i18n 实例
export default i18n;