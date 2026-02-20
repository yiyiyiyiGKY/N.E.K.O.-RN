/**
 * Settings Screen
 *
 * Configure API keys and preferences.
 * Similar to Web's ApiKeySettings.tsx
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useDevConnectionConfig } from '@/hooks/useDevConnectionConfig';
import { createConfigApiClient, type CoreConfig, type ApiProvider } from '@/services/api/config';

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

export default function SettingsScreen() {
  const router = useRouter();
  const { config } = useDevConnectionConfig();
  const apiBase = `http://${config.host}:${config.port}`;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Config state
  const [coreConfig, setCoreConfig] = useState<CoreConfig>({});
  const [coreProviders, setCoreProviders] = useState<ApiProvider[]>([]);
  const [assistProviders, setAssistProviders] = useState<ApiProvider[]>([]);

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
  }, [loadConfig]);

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

  // Find provider name by id
  const getProviderName = (id: string | undefined, providers: ApiProvider[]) => {
    if (!id) return 'Unknown';
    const provider = providers.find(p => p.id === id);
    return provider?.name || id;
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading settings...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backButtonText}>{Icons.back}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>API Settings</Text>
          <TouchableOpacity onPress={loadConfig} style={styles.refreshButton}>
            <Text style={styles.refreshButtonText}>{Icons.refresh}</Text>
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
              <Text style={styles.sectionTitle}>Core API</Text>
            </View>
            <View style={styles.card}>
              <View style={styles.field}>
                <Text style={styles.label}>API Provider</Text>
                <View style={styles.pickerContainer}>
                  {coreProviders.map(provider => (
                    <TouchableOpacity
                      key={provider.id}
                      style={[
                        styles.pickerOption,
                        coreConfig.coreApi === provider.id && styles.pickerOptionSelected,
                      ]}
                      onPress={() => updateField('coreApi', provider.id)}
                    >
                      <Text
                        style={[
                          styles.pickerOptionText,
                          coreConfig.coreApi === provider.id && styles.pickerOptionTextSelected,
                        ]}
                      >
                        {provider.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>API Key</Text>
                <TextInput
                  style={styles.input}
                  value={coreConfig.api_key || ''}
                  onChangeText={(text) => updateField('api_key', text)}
                  placeholder="Enter API key"
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
              <Text style={styles.sectionTitle}>Assist API (Memory/Voice)</Text>
            </View>
            <View style={styles.card}>
              <View style={styles.field}>
                <Text style={styles.label}>Assist API Provider</Text>
                <View style={styles.pickerContainer}>
                  {assistProviders.map(provider => (
                    <TouchableOpacity
                      key={provider.id}
                      style={[
                        styles.pickerOption,
                        coreConfig.assistApi === provider.id && styles.pickerOptionSelected,
                      ]}
                      onPress={() => updateField('assistApi', provider.id)}
                    >
                      <Text
                        style={[
                          styles.pickerOptionText,
                          coreConfig.assistApi === provider.id && styles.pickerOptionTextSelected,
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
              <Text style={styles.sectionTitle}>Provider API Keys</Text>
            </View>
            <View style={styles.card}>
              <View style={styles.field}>
                <Text style={styles.label}>Qwen (Alibaba Cloud)</Text>
                <TextInput
                  style={styles.input}
                  value={coreConfig.assistApiKeyQwen || ''}
                  onChangeText={(text) => updateField('assistApiKeyQwen', text)}
                  placeholder="sk-..."
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>OpenAI</Text>
                <TextInput
                  style={styles.input}
                  value={coreConfig.assistApiKeyOpenai || ''}
                  onChangeText={(text) => updateField('assistApiKeyOpenai', text)}
                  placeholder="sk-..."
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>GLM (Zhipu)</Text>
                <TextInput
                  style={styles.input}
                  value={coreConfig.assistApiKeyGlm || ''}
                  onChangeText={(text) => updateField('assistApiKeyGlm', text)}
                  placeholder="..."
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Step (阶跃星辰)</Text>
                <TextInput
                  style={styles.input}
                  value={coreConfig.assistApiKeyStep || ''}
                  onChangeText={(text) => updateField('assistApiKeyStep', text)}
                  placeholder="..."
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Silicon Flow (硅基流动)</Text>
                <TextInput
                  style={styles.input}
                  value={coreConfig.assistApiKeySilicon || ''}
                  onChangeText={(text) => updateField('assistApiKeySilicon', text)}
                  placeholder="..."
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            </View>
          </View>

          {/* MCP Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionIcon}>{Icons.settings}</Text>
              <Text style={styles.sectionTitle}>MCP Token</Text>
            </View>
            <View style={styles.card}>
              <View style={styles.field}>
                <Text style={styles.label}>MCP Router Token</Text>
                <TextInput
                  style={styles.input}
                  value={coreConfig.mcpToken || ''}
                  onChangeText={(text) => updateField('mcpToken', text)}
                  placeholder="Optional"
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
              <Text style={styles.sectionTitle}>Server Info</Text>
            </View>
            <View style={styles.card}>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Host</Text>
                <Text style={styles.infoValue}>{config.host}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Port</Text>
                <Text style={styles.infoValue}>{config.port}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Character</Text>
                <Text style={styles.infoValue}>{config.characterName}</Text>
              </View>
            </View>
          </View>

          {/* Save Button */}
          <View style={styles.saveContainer}>
            <TouchableOpacity
              style={[styles.saveButton, saving && styles.saveButtonDisabled]}
              onPress={handleSave}
              disabled={saving}
            >
              <Text style={styles.saveButtonText}>
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
    backgroundColor: '#1a1a2e',
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
    color: '#fff',
    fontSize: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  backButton: {
    padding: 8,
  },
  backButtonText: {
    color: '#00d9ff',
    fontSize: 24,
  },
  headerTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  refreshButton: {
    padding: 8,
  },
  refreshButtonText: {
    color: '#00d9ff',
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
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 16,
  },
  field: {
    marginBottom: 16,
  },
  label: {
    color: '#aaa',
    fontSize: 12,
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#1a1a2e',
    borderRadius: 8,
    padding: 12,
    color: '#fff',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  pickerContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pickerOption: {
    backgroundColor: '#1a1a2e',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  pickerOptionSelected: {
    backgroundColor: '#00d9ff',
    borderColor: '#00d9ff',
  },
  pickerOptionText: {
    color: '#fff',
    fontSize: 14,
  },
  pickerOptionTextSelected: {
    color: '#1a1a2e',
    fontWeight: 'bold',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  infoLabel: {
    color: '#888',
    fontSize: 14,
  },
  infoValue: {
    color: '#fff',
    fontSize: 14,
  },
  saveContainer: {
    paddingVertical: 20,
    paddingBottom: 40,
  },
  saveButton: {
    backgroundColor: '#00d9ff',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    color: '#1a1a2e',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
