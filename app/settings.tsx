/**
 * Settings Screen
 *
 * Configure API keys and preferences.
 * Similar to Web's ApiKeySettings.tsx
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { useDevConnectionConfig } from '@/hooks/useDevConnectionConfig';
import { createConfigApiClient, type CoreConfig, type ApiProvider } from '@/services/api/config';
import { useColorScheme } from '@/hooks/use-color-scheme';

// Icons as text
const Icons = {
  back: '←',
  check: '✓',
  close: '✕',
  key: '🔑',
  settings: '⚙️',
  info: 'ℹ️',
  refresh: '🔄',
};

// 亮色/暗色主题色板（参照主项目 theme.css 与 dark-mode.css）
const LIGHT = {
  container:          '#e3f4ff',
  header:             '#f0f8ff',
  headerBorder:       '#b3e5fc',
  card:               '#f0f8ff',
  input:              '#fff',
  inputBorder:        '#b3e5fc',
  textPrimary:        '#1a1a2e',
  textLabel:          '#555',
  textMuted:          '#777',
  sectionTitle:       '#0d6e92',
  accent:             '#40c5f1',
  accentText:         '#1a1a2e',
  pickerOptionBg:     '#f0f8ff',
  pickerOptionBorder: '#b3e5fc',
  infoSeparator:      '#b3e5fc',
  infoLabel:          '#555',
  infoValue:          '#1a1a2e',
  loadingText:        '#1a1a2e',
  inputText:          '#1a1a2e',
  placeholder:        '#999',
};

const DARK = {
  container:          '#1a1a2e',
  header:             '#1a1a2e',
  headerBorder:       '#333',
  card:               '#16213e',
  input:              '#1a1a2e',
  inputBorder:        '#333',
  textPrimary:        '#fff',
  textLabel:          '#aaa',
  textMuted:          '#888',
  sectionTitle:       '#fff',
  accent:             '#00d9ff',
  accentText:         '#1a1a2e',
  pickerOptionBg:     '#1a1a2e',
  pickerOptionBorder: '#333',
  infoSeparator:      '#333',
  infoLabel:          '#888',
  infoValue:          '#fff',
  loadingText:        '#fff',
  inputText:          '#fff',
  placeholder:        '#666',
};

export default function SettingsScreen() {
  const router = useRouter();
  const { config } = useDevConnectionConfig();
  const apiBase = `http://${config.host}:${config.port}`;

  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const t = isDark ? DARK : LIGHT;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Config state
  const [coreConfig, setCoreConfig] = useState<CoreConfig>({});
  const [coreProviders, setCoreProviders] = useState<ApiProvider[]>([]);
  const [assistProviders, setAssistProviders] = useState<ApiProvider[]>([]);
  const [p2pConfig, setP2pConfig] = useState<any>(null);

  // Load P2P config from server
  const loadP2PConfig = useCallback(async () => {
    try {
      const response = await fetch(`${apiBase}/p2p-info`);
      if (response.ok) {
        const data = await response.json();
        setP2pConfig(data);
      }
    } catch (err) {
      console.log('P2P info not available:', err);
    }
  }, [apiBase]);

  // Load config
  const loadConfig = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const client = createConfigApiClient(apiBase);
      const [configData, providersData] = await Promise.all([
        client.getCoreConfig(),
        client.getApiProviders(),
      ]);

      setCoreConfig(configData);
      setCoreProviders(providersData.core_api_providers || []);
      setAssistProviders(providersData.assist_api_providers || []);
    } catch (err: any) {
      console.error('Failed to load config:', err);
      setError(err.message || 'Failed to load configuration');
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    loadConfig();
    loadP2PConfig();
  }, [loadConfig, loadP2PConfig]);

  // Save config
  const handleSave = useCallback(async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const client = createConfigApiClient(apiBase);
      const result = await client.updateCoreConfig(coreConfig);

      if (result.success) {
        setSuccess('Settings saved successfully!');
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError(result.error || 'Failed to save');
      }
    } catch (err: any) {
      console.error('Failed to save config:', err);
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [apiBase, coreConfig]);

  // Update config field
  const updateField = (field: keyof CoreConfig, value: string | boolean) => {
    setCoreConfig(prev => ({ ...prev, [field]: value }));
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: t.container }]}>
        <View style={styles.loadingContainer}>
          <Text style={[styles.loadingText, { color: t.loadingText }]}>Loading settings...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: t.container }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        {/* Header */}
        <View style={[styles.header, { backgroundColor: t.header, borderBottomColor: t.headerBorder }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Text style={[styles.backButtonText, { color: t.accent }]}>{Icons.back}</Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: t.textPrimary }]}>API Settings</Text>
          <TouchableOpacity onPress={loadConfig} style={styles.refreshButton}>
            <Text style={[styles.refreshButtonText, { color: t.accent }]}>{Icons.refresh}</Text>
          </TouchableOpacity>
        </View>

        {/* Messages */}
        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>❌ {error}</Text>
            <TouchableOpacity onPress={() => setError(null)}>
              <Text style={styles.errorClose}>{Icons.close}</Text>
            </TouchableOpacity>
          </View>
        )}
        {success && (
          <View style={styles.successBox}>
            <Text style={styles.successText}>✅ {success}</Text>
          </View>
        )}

        <ScrollView
          style={styles.content}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={loadConfig} />}
        >
          {/* Core API Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionIcon}>{Icons.key}</Text>
              <Text style={[styles.sectionTitle, { color: t.sectionTitle }]}>Core API</Text>
            </View>
            <View style={[styles.card, { backgroundColor: t.card }]}>
              <View style={styles.field}>
                <Text style={[styles.label, { color: t.textLabel }]}>API Provider</Text>
                <View style={styles.pickerContainer}>
                  {coreProviders.map((provider, index) => (
                    <TouchableOpacity
                      key={provider.id || `core-${index}`}
                      style={[
                        styles.pickerOption,
                        { backgroundColor: t.pickerOptionBg, borderColor: t.pickerOptionBorder },
                        coreConfig.coreApi === provider.id && { backgroundColor: t.accent, borderColor: t.accent },
                      ]}
                      onPress={() => updateField('coreApi', provider.id)}
                    >
                      <Text
                        style={[
                          styles.pickerOptionText,
                          { color: t.textPrimary },
                          coreConfig.coreApi === provider.id && { color: t.accentText, fontWeight: 'bold' },
                        ]}
                      >
                        {provider.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.field}>
                <Text style={[styles.label, { color: t.textLabel }]}>API Key</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: t.input, borderColor: t.inputBorder, color: t.inputText }]}
                  value={coreConfig.api_key || ''}
                  onChangeText={(text) => updateField('api_key', text)}
                  placeholder="Enter API key"
                  placeholderTextColor={t.placeholder}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            </View>
          </View>

          {/* Assist API Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionIcon}>{Icons.settings}</Text>
              <Text style={[styles.sectionTitle, { color: t.sectionTitle }]}>Assist API (Memory/Voice)</Text>
            </View>
            <View style={[styles.card, { backgroundColor: t.card }]}>
              <View style={styles.field}>
                <Text style={[styles.label, { color: t.textLabel }]}>Assist API Provider</Text>
                <View style={styles.pickerContainer}>
                  {assistProviders.map((provider, index) => (
                    <TouchableOpacity
                      key={provider.id || `assist-${index}`}
                      style={[
                        styles.pickerOption,
                        { backgroundColor: t.pickerOptionBg, borderColor: t.pickerOptionBorder },
                        coreConfig.assistApi === provider.id && { backgroundColor: t.accent, borderColor: t.accent },
                      ]}
                      onPress={() => updateField('assistApi', provider.id)}
                    >
                      <Text
                        style={[
                          styles.pickerOptionText,
                          { color: t.textPrimary },
                          coreConfig.assistApi === provider.id && { color: t.accentText, fontWeight: 'bold' },
                        ]}
                      >
                        {provider.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
          </View>

          {/* Provider-specific API Keys */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionIcon}>{Icons.key}</Text>
              <Text style={[styles.sectionTitle, { color: t.sectionTitle }]}>Provider API Keys</Text>
            </View>
            <View style={[styles.card, { backgroundColor: t.card }]}>
              {[
                { label: 'Qwen (Alibaba Cloud)', field: 'assistApiKeyQwen' as keyof CoreConfig },
                { label: 'OpenAI',               field: 'assistApiKeyOpenai' as keyof CoreConfig },
                { label: 'Gemini (Google)',       field: 'assistApiKeyGemini' as keyof CoreConfig },
                { label: 'GLM (Zhipu)',           field: 'assistApiKeyGlm' as keyof CoreConfig },
                { label: 'Step (阶跃星辰)',        field: 'assistApiKeyStep' as keyof CoreConfig },
                { label: 'Silicon Flow (硅基流动)', field: 'assistApiKeySilicon' as keyof CoreConfig },
              ].map(({ label, field }) => (
                <View key={field} style={styles.field}>
                  <Text style={[styles.label, { color: t.textLabel }]}>{label}</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: t.input, borderColor: t.inputBorder, color: t.inputText }]}
                    value={(coreConfig[field] as string) || ''}
                    onChangeText={(text) => updateField(field, text)}
                    placeholder="sk-..."
                    placeholderTextColor={t.placeholder}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              ))}
            </View>
          </View>

          {/* MCP Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionIcon}>{Icons.settings}</Text>
              <Text style={[styles.sectionTitle, { color: t.sectionTitle }]}>MCP Token</Text>
            </View>
            <View style={[styles.card, { backgroundColor: t.card }]}>
              <View style={styles.field}>
                <Text style={[styles.label, { color: t.textLabel }]}>MCP Router Token</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: t.input, borderColor: t.inputBorder, color: t.inputText }]}
                  value={coreConfig.mcpToken || ''}
                  onChangeText={(text) => updateField('mcpToken', text)}
                  placeholder="Optional"
                  placeholderTextColor={t.placeholder}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            </View>
          </View>

          {/* Server Info */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionIcon}>{Icons.info}</Text>
              <Text style={[styles.sectionTitle, { color: t.sectionTitle }]}>Server Info</Text>
            </View>
            <View style={[styles.card, { backgroundColor: t.card }]}>
              {[
                { label: 'Host',      value: config.host },
                { label: 'Port',      value: String(config.port) },
                { label: 'Character', value: config.characterName },
              ].map(({ label, value }) => (
                <View key={label} style={[styles.infoRow, { borderBottomColor: t.infoSeparator }]}>
                  <Text style={[styles.infoLabel, { color: t.infoLabel }]}>{label}</Text>
                  <Text style={[styles.infoValue, { color: t.infoValue }]}>{value}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* P2P Connection QR Code */}
          {p2pConfig && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionIcon}>📱</Text>
                <Text style={[styles.sectionTitle, { color: t.sectionTitle }]}>P2P Connection</Text>
              </View>
              <View style={[styles.card, { backgroundColor: t.card, alignItems: 'center' }]}>
                <View style={styles.qrContainer}>
                  <QRCode
                    value={JSON.stringify(p2pConfig)}
                    size={200}
                    color={isDark ? '#fff' : '#000'}
                    backgroundColor={isDark ? '#1a1a2e' : '#f0f8ff'}
                  />
                </View>
                <Text style={[styles.qrHint, { color: t.textMuted }]}>
                  Scan with N.E.K.O. RN App to connect
                </Text>
                <View style={styles.p2pInfo}>
                  <Text style={[styles.p2pInfoText, { color: t.textMuted }]}>
                    UDP: {p2pConfig.port} | TCP: {p2pConfig.tcp_port}
                  </Text>
                </View>
              </View>
            </View>
          )}

          {/* Save Button */}
          <View style={styles.saveContainer}>
            <TouchableOpacity
              style={[styles.saveButton, { backgroundColor: t.accent }, saving && styles.saveButtonDisabled]}
              onPress={handleSave}
              disabled={saving}
            >
              <Text style={[styles.saveButtonText, { color: t.accentText }]}>
                {saving ? 'Saving...' : 'Save Settings'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backButton: {
    padding: 8,
  },
  backButtonText: {
    fontSize: 24,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  refreshButton: {
    padding: 8,
  },
  refreshButtonText: {
    fontSize: 20,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ff4444',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  errorText: {
    color: '#fff',
    flex: 1,
  },
  errorClose: {
    color: '#fff',
    fontSize: 18,
    padding: 4,
  },
  successBox: {
    backgroundColor: '#00c853',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  successText: {
    color: '#fff',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  section: {
    marginTop: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  sectionTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
  },
  card: {
    borderRadius: 12,
    padding: 16,
  },
  field: {
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
    marginBottom: 6,
  },
  input: {
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    borderWidth: 1,
  },
  pickerContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pickerOption: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  pickerOptionText: {
    fontSize: 14,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  infoLabel: {
    fontSize: 14,
  },
  infoValue: {
    fontSize: 14,
  },
  saveContainer: {
    paddingVertical: 20,
    paddingBottom: 40,
  },
  saveButton: {
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  qrContainer: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#fff',
    marginBottom: 12,
  },
  qrHint: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 8,
  },
  p2pInfo: {
    marginTop: 8,
  },
  p2pInfoText: {
    fontSize: 12,
    textAlign: 'center',
  },
});
