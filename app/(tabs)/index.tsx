import { StyleSheet, View, TouchableOpacity, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useDevConnectionConfig } from '@/hooks/useDevConnectionConfig';
import { hasUserStoredConfig } from '@/services/DevConnectionStorage';
import { sessionStore } from '@/utils/sessionStore';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { changeLanguage, SUPPORTED_LANGUAGES } from '@/i18n';

type ConnectionStatus = 'online' | 'offline';

// Status map will be populated by translation
const STATUS_COLORS: Record<ConnectionStatus, string> = {
  online:  '#40c5f1',
  offline: '#ff4d4d',
};

// 亮色/暗色主题色板（参照主项目 theme.css 与 dark-mode.css）
const LIGHT = {
  container:       '#e3f4ff',
  card:            '#f0f8ff',
  cardBorder:      '#b3e5fc',
  actionBtn:       '#f0f8ff',
  actionBorder:    '#b3e5fc',
  configBtn:       '#f0f8ff',
  configBtnBorder: '#b3e5fc',
  textPrimary:     '#1a1a2e',
  textSub:         '#555',
  textMuted:       '#888',
  textOffline:     '#999',
  titleColor:      '#40c5f1',
  sectionTitle:    '#40c5f1',
  configBtnText:   '#40c5f1',
};

const DARK = {
  container:       '#000',
  card:            'rgba(30, 30, 30, 0.6)',
  cardBorder:      'rgba(255, 255, 255, 0.1)',
  actionBtn:       'rgba(64, 197, 241, 0.1)',
  actionBorder:    'rgba(64, 197, 241, 0.3)',
  configBtn:       'rgba(64, 197, 241, 0.08)',
  configBtnBorder: 'rgba(64, 197, 241, 0.2)',
  textPrimary:     '#fff',
  textSub:         '#888',
  textMuted:       '#666',
  textOffline:     '#555',
  titleColor:      '#40c5f1',
  sectionTitle:    '#40c5f1',
  configBtnText:   '#40c5f1',
};

export default function HomeScreen() {
  const router = useRouter();
  const { config, isLoaded, reload } = useDevConnectionConfig();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = isDark ? DARK : LIGHT;
  const { t, i18n } = useTranslation();

  const isFocused = useIsFocused();
  const [isConnected, setIsConnected] = useState(sessionStore.isConnected);
  const [isUserConfigured, setIsUserConfigured] = useState(false);

  // 订阅 WebSocket 连接状态变化
  useEffect(() => sessionStore.subscribe(setIsConnected), []);

  // 每次页面获得焦点时同步配置状态（扫码/手动配置后返回首页可立即更新）
  useEffect(() => {
    if (!isLoaded || !isFocused) return;
    hasUserStoredConfig().then(setIsUserConfigured);
    reload();
  }, [isLoaded, isFocused, reload]);

  const status: ConnectionStatus = isConnected ? 'online' : 'offline';
  const statusColor = STATUS_COLORS[status];
  const statusText = status === 'online' ? t('home.status.online') : t('home.status.offline');
  const showIp = isUserConfigured && isConnected;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.container }]}>
      <View style={styles.content}>
        {/* 标题区域 */}
        <View style={styles.header}>
           <Text style={[styles.title, { color: theme.titleColor }]}>{t('home.title')}</Text>
        </View>

        {/* 快捷功能 */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.sectionTitle }]}>{t('home.shortcuts')}</Text>
          <View style={styles.quickActions}>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: theme.actionBtn, borderColor: theme.actionBorder }]}
              onPress={() => router.push('/settings')}
              activeOpacity={0.8}
            >
              <Text style={styles.actionIcon}>🔑</Text>
              <Text style={[styles.actionText, { color: theme.textPrimary }]}>{t('home.apiSettings')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: theme.actionBtn, borderColor: theme.actionBorder }]}
              onPress={() => router.push('/character-manager')}
              activeOpacity={0.8}
            >
              <Text style={styles.actionIcon}>🐱</Text>
              <Text style={[styles.actionText, { color: theme.textPrimary }]}>{t('home.characterManager')}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 语言选择 */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.sectionTitle }]}>🌐 {t('settings.sections.language')}</Text>
          <View style={styles.langRow}>
            {SUPPORTED_LANGUAGES.map((lang) => (
              <TouchableOpacity
                key={lang.code}
                style={[
                  styles.langButton,
                  { backgroundColor: theme.actionBtn, borderColor: theme.actionBorder },
                  i18n.language === lang.code && { backgroundColor: theme.titleColor, borderColor: theme.titleColor },
                ]}
                onPress={() => changeLanguage(lang.code)}
                activeOpacity={0.8}
              >
                <Text style={[
                  styles.langText,
                  { color: theme.textPrimary },
                  i18n.language === lang.code && { color: '#fff', fontWeight: 'bold' },
                ]}>
                  {lang.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* 服务器配置 */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.sectionTitle }]}>{t('home.serverConnection')}</Text>

          <View style={[styles.configCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <View style={styles.configRow}>
              <Text style={[styles.configLabel, { color: theme.textSub }]}>{t('connection.status.connected')}</Text>
              <View style={styles.statusIndicator}>
                <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                <Text style={[styles.statusText, { color: statusColor }]}>{statusText}</Text>
              </View>
            </View>
            {showIp ? (
              <Text style={[styles.configValue, { color: theme.textPrimary }]}>
                {config.host}:{config.port}
              </Text>
            ) : isUserConfigured ? (
              <Text style={[styles.configValueOffline, { color: theme.textOffline }]}>{t('home.status.configured')}</Text>
            ) : (
              <Text style={[styles.configValueOffline, { color: theme.textOffline }]}>{t('home.status.unconfigured')}</Text>
            )}
            <Text style={[styles.configSubtext, { color: theme.textMuted }]}>{t('home.actions.currentRole')}: {config.characterName}</Text>
          </View>

          <View style={styles.configButtons}>
            <TouchableOpacity
              style={[styles.configButton, { backgroundColor: theme.configBtn, borderColor: theme.configBtnBorder }]}
              onPress={() => router.push('/server-config')}
              activeOpacity={0.8}
            >
              <Text style={styles.configButtonIcon}>⚙️</Text>
              <Text style={[styles.configButtonText, { color: theme.configBtnText }]}>{t('home.actions.manualConfig')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.configButton, { backgroundColor: theme.configBtn, borderColor: theme.configBtnBorder }]}
              onPress={() => router.push({ pathname: '/qr-scanner', params: { returnTo: '/main' } })}
              activeOpacity={0.8}
            >
              <Text style={styles.configButtonIcon}>📷</Text>
              <Text style={[styles.configButtonText, { color: theme.configBtnText }]}>{t('home.actions.qrConfig')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    // backgroundColor 由 t.container 动态注入
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    letterSpacing: 2,
  },
  section: {
    marginBottom: 28,
    paddingHorizontal: 20,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  quickActions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 24,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderWidth: 1,
  },
  actionIcon: {
    fontSize: 28,
  },
  actionText: {
    fontSize: 14,
    fontWeight: '600',
  },
  langRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  langButton: {
    width: '31%',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  langText: {
    fontSize: 13,
    textAlign: 'center',
  },
  configCard: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
  },
  configRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  configLabel: {
    fontSize: 12,
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  configValue: {
    fontSize: 20,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  configValueOffline: {
    fontSize: 14,
    fontStyle: 'italic',
  },
  configSubtext: {
    fontSize: 13,
    marginTop: 6,
  },
  configButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  configButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
  },
  configButtonIcon: {
    fontSize: 20,
  },
  configButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
