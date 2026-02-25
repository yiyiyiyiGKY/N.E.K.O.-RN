/**
 * Character Manager Screen
 *
 * Manage master profile and catgirl characters.
 * Similar to Web's CharacterManager.tsx
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
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
import { useDevConnectionConfig } from '@/hooks/useDevConnectionConfig';
import {
  createCharactersApiClient,
  catgirlToCharacter,
  characterToCatgirl,
  masterToState,
  type Character,
  type CharactersData,
  type MasterProfile,
} from '@/services/api/characters';

// Icons as text for simplicity (could use react-native-vector-icons later)
const Icons = {
  back: '←',
  add: '+',
  edit: '✏️',
  trash: '🗑️',
  check: '✓',
  close: '✕',
  user: '👤',
  cat: '🐱',
  current: '⭐',
};

export default function CharacterManagerScreen() {
  const router = useRouter();
  const { config } = useDevConnectionConfig();
  const apiBase = `http://${config.host}:${config.port}`;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Master profile state
  const [masterProfile, setMasterProfile] = useState<{ name: string; nickname?: string; gender?: string }>({
    name: '',
  });

  // Catgirls list
  const [catgirls, setCatgirls] = useState<Character[]>([]);
  const [currentCatgirl, setCurrentCatgirl] = useState<string | null>(null);

  // Edit modal state
  const [editingCharacter, setEditingCharacter] = useState<Character | null>(null);
  const [isNewCharacter, setIsNewCharacter] = useState(false);

  // Load characters data
  const loadCharacters = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const client = createCharactersApiClient(apiBase);
      const data: CharactersData = await client.getCharacters();

      // Set master profile
      setMasterProfile(masterToState(data.主人 || { 档案名: '' }));

      // Set catgirls
      const catgirlList: Character[] = [];
      if (data.猫娘) {
        for (const [name, profile] of Object.entries(data.猫娘)) {
          catgirlList.push(catgirlToCharacter(name, profile));
        }
      }
      setCatgirls(catgirlList);
      setCurrentCatgirl(data.当前猫娘 || null);
    } catch (err: any) {
      console.error('Failed to load characters:', err);
      setError(err.message || 'Failed to load character data');
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    loadCharacters();
  }, [loadCharacters]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadCharacters();
    setRefreshing(false);
  }, [loadCharacters]);

  // Save master profile
  const handleSaveMaster = useCallback(async () => {
    try {
      setSaving(true);
      setError(null);

      const client = createCharactersApiClient(apiBase);
      const profile: MasterProfile = { 档案名: masterProfile.name };
      if (masterProfile.nickname) profile.昵称 = masterProfile.nickname;
      if (masterProfile.gender) profile.性别 = masterProfile.gender;
  
      const result = await client.updateMaster(profile);

      if (result.success) {
        Alert.alert('Success', 'Master profile saved!');
      } else {
        setError(result.error || 'Failed to save');
      }
    } catch (err: any) {
      console.error('Failed to save master profile:', err);
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [apiBase, masterProfile]);

  // Add new catgirl
  const handleAddCatgirl = useCallback(() => {
    setIsNewCharacter(true);
    setEditingCharacter({ id: '', name: '', nickname: '' });
  }, []);

  // Edit catgirl
  const handleEditCatgirl = useCallback((character: Character) => {
    setIsNewCharacter(false);
    setEditingCharacter({ ...character });
  }, []);

  // Save catgirl
  const handleSaveCharacter = useCallback(async (character: Character) => {
    if (!character.name.trim()) {
      Alert.alert('Error', 'Name is required');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const client = createCharactersApiClient(apiBase);
      const profile = characterToCatgirl(character);

      let result;
      if (isNewCharacter) {
        result = await client.addCatgirl(profile);
      } else {
        result = await client.updateCatgirl(character.id, profile);
      }

      if (result.success) {
        await loadCharacters();
        setEditingCharacter(null);
        Alert.alert('Success', 'Character saved!');
      } else {
        setError(result.error || 'Failed to save');
      }
    } catch (err: any) {
      console.error('Failed to save character:', err);
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [apiBase, isNewCharacter, loadCharacters]);

  // Delete catgirl
  const handleDeleteCatgirl = useCallback((character: Character) => {
    Alert.alert(
      'Confirm Delete',
      `Are you sure you want to delete "${character.nickname || character.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setSaving(true);
              const client = createCharactersApiClient(apiBase);
              const result = await client.deleteCatgirl(character.id);

              if (result.success) {
                setCatgirls(catgirls.filter(c => c.id !== character.id));
                Alert.alert('Success', 'Character deleted!');
              } else {
                setError(result.error || 'Failed to delete');
              }
            } catch (err: any) {
              console.error('Failed to delete character:', err);
              setError(err.message || 'Failed to delete');
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  }, [apiBase, catgirls]);

  // Set as current catgirl
  const handleSetCurrent = useCallback(async (character: Character) => {
    try {
      setSaving(true);
      const client = createCharactersApiClient(apiBase);
      const result = await client.setCurrentCatgirl(character.name);

      if (result.success) {
        setCurrentCatgirl(character.name);
        Alert.alert('Success', `${character.nickname || character.name} is now the current character!`);
      } else {
        setError(result.error || 'Failed to set current');
      }
    } catch (err: any) {
      console.error('Failed to set current catgirl:', err);
      setError(err.message || 'Failed to set current');
    } finally {
      setSaving(false);
    }
  }, [apiBase]);

  // Render catgirl item
  const renderCatgirlItem = useCallback(({ item }: { item: Character }) => {
    const isCurrent = currentCatgirl === item.name;

    return (
      <View style={[styles.characterItem, isCurrent && styles.characterItemCurrent]}>
        <View style={styles.characterInfo}>
          <Text style={styles.characterIcon}>{Icons.cat}</Text>
          <View style={styles.characterDetails}>
            <View style={styles.characterNameRow}>
              <Text style={styles.characterName}>{item.nickname || item.name}</Text>
              {isCurrent && <Text style={styles.currentBadge}>{Icons.current}</Text>}
            </View>
            {item.personality && (
              <Text style={styles.characterMeta} numberOfLines={1}>{item.personality}</Text>
            )}
          </View>
        </View>
        <View style={styles.characterActions}>
          {!isCurrent && (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => handleSetCurrent(item)}
            >
              <Text style={styles.actionButtonText}>Set</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => handleEditCatgirl(item)}
          >
            <Text style={styles.actionButtonText}>{Icons.edit}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.deleteButton]}
            onPress={() => handleDeleteCatgirl(item)}
          >
            <Text style={styles.actionButtonText}>{Icons.trash}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }, [currentCatgirl, handleSetCurrent, handleEditCatgirl, handleDeleteCatgirl]);

  // Loading state
  if (loading && !refreshing) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading characters...</Text>
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
          <Text style={styles.headerTitle}>Character Manager</Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* Error Message */}
        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>❌ {error}</Text>
            <TouchableOpacity onPress={() => setError(null)}>
              <Text style={styles.errorClose}>{Icons.close}</Text>
            </TouchableOpacity>
          </View>
        )}

        <ScrollView
          style={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {/* Master Profile Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionIcon}>{Icons.user}</Text>
              <Text style={styles.sectionTitle}>Master Profile</Text>
            </View>
            <View style={styles.card}>
              <View style={styles.field}>
                <Text style={styles.label}>Name *</Text>
                <TextInput
                  style={styles.input}
                  value={masterProfile.name}
                  onChangeText={(text) => setMasterProfile({ ...masterProfile, name: text })}
                  placeholder="Required"
                  maxLength={20}
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Nickname</Text>
                <TextInput
                  style={styles.input}
                  value={masterProfile.nickname || ''}
                  onChangeText={(text) => setMasterProfile({ ...masterProfile, nickname: text })}
                  placeholder="Optional"
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>gender</Text>
                <TextInput
                  style={styles.input}
                  value={masterProfile.gender}
                  onChangeText={(text) => setMasterProfile({ ...masterProfile, gender: text })}
                  placeholder="Optional"
                />
              </View>
              <TouchableOpacity
                style={[styles.saveButton, saving && styles.saveButtonDisabled]}
                onPress={handleSaveMaster}
                disabled={saving}
              >
                <Text style={styles.saveButtonText}>
                  {saving ? 'Saving...' : 'Save Master'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Catgirls Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionIcon}>{Icons.cat}</Text>
              <Text style={styles.sectionTitle}>Characters</Text>
              <TouchableOpacity style={styles.addButton} onPress={handleAddCatgirl}>
                <Text style={styles.addButtonText}>{Icons.add}</Text>
              </TouchableOpacity>
            </View>

            <FlatList
              data={catgirls}
              renderItem={renderCatgirlItem}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>No characters yet</Text>
                  <Text style={styles.emptyHint}>Tap + to add a new character</Text>
                </View>
              }
            />
          </View>
        </ScrollView>

        {/* Edit Modal */}
        {editingCharacter && (
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>
                  {isNewCharacter ? 'Add Character' : 'Edit Character'}
                </Text>
                <TouchableOpacity onPress={() => setEditingCharacter(null)}>
                  <Text style={styles.modalClose}>{Icons.close}</Text>
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.modalBody}>
                <View style={styles.field}>
                  <Text style={styles.label}>Name *</Text>
                  <TextInput
                    style={styles.input}
                    value={editingCharacter.name}
                    onChangeText={(text) => setEditingCharacter({ ...editingCharacter, name: text })}
                    placeholder="Character name"
                    editable={isNewCharacter}
                  />
                </View>
                <View style={styles.field}>
                  <Text style={styles.label}>Nickname</Text>
                  <TextInput
                    style={styles.input}
                    value={editingCharacter.nickname || ''}
                    onChangeText={(text) => setEditingCharacter({ ...editingCharacter, nickname: text })}
                    placeholder="Display name"
                  />
                </View>
                <View style={styles.field}>
                  <Text style={styles.label}>Personality</Text>
                  <TextInput
                    style={styles.input}
                    value={editingCharacter.personality || ''}
                    onChangeText={(text) => setEditingCharacter({ ...editingCharacter, personality: text })}
                    placeholder="Character traits"
                  />
                </View>
                <View style={styles.field}>
                  <Text style={styles.label}>Backstory</Text>
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    value={editingCharacter.backstory || ''}
                    onChangeText={(text) => setEditingCharacter({ ...editingCharacter, backstory: text })}
                    placeholder="Character background"
                    multiline
                    numberOfLines={4}
                    textAlignVertical="top"
                  />
                </View>
              </ScrollView>

              <View style={styles.modalFooter}>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={() => setEditingCharacter(null)}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmButton, saving && styles.saveButtonDisabled]}
                  onPress={() => handleSaveCharacter(editingCharacter)}
                  disabled={saving}
                >
                  <Text style={styles.confirmButtonText}>
                    {saving ? 'Saving...' : 'Save'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
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
  headerSpacer: {
    width: 40,
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
  addButton: {
    backgroundColor: '#00d9ff',
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButtonText: {
    color: '#1a1a2e',
    fontSize: 20,
    fontWeight: 'bold',
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
  textArea: {
    minHeight: 100,
  },
  saveButton: {
    backgroundColor: '#00d9ff',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    color: '#1a1a2e',
    fontSize: 16,
    fontWeight: 'bold',
  },
  characterItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  characterItemCurrent: {
    borderWidth: 2,
    borderColor: '#00d9ff',
  },
  characterInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  characterIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  characterDetails: {
    flex: 1,
  },
  characterNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  characterName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  currentBadge: {
    marginLeft: 8,
    fontSize: 16,
  },
  characterMeta: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  characterActions: {
    flexDirection: 'row',
    marginLeft: 8,
  },
  actionButton: {
    backgroundColor: '#333',
    borderRadius: 8,
    padding: 8,
    marginLeft: 4,
  },
  deleteButton: {
    backgroundColor: '#ff4444',
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 14,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyText: {
    color: '#888',
    fontSize: 16,
  },
  emptyHint: {
    color: '#666',
    fontSize: 12,
    marginTop: 8,
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    width: '90%',
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  modalClose: {
    color: '#00d9ff',
    fontSize: 24,
  },
  modalBody: {
    padding: 16,
    maxHeight: 400,
  },
  modalFooter: {
    flexDirection: 'row',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  cancelButton: {
    flex: 1,
    backgroundColor: '#333',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginRight: 8,
  },
  cancelButtonText: {
    color: '#fff',
    fontSize: 16,
  },
  confirmButton: {
    flex: 1,
    backgroundColor: '#00d9ff',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginLeft: 8,
  },
  confirmButtonText: {
    color: '#1a1a2e',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
