import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  BackHandler,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export const PRIVACY_AGREED_KEY = 'has_agreed_privacy';

interface Props {
  onAgree: () => void;
}

export default function PrivacyConsentModal({ onAgree }: Props) {
  const { t } = useTranslation();
  const [agreeing, setAgreeing] = useState(false);

  const handleAgree = async () => {
    setAgreeing(true);
    await AsyncStorage.setItem(PRIVACY_AGREED_KEY, 'true');
    onAgree();
  };

  const handleDisagree = () => {
    if (Platform.OS === 'android') {
      BackHandler.exitApp();
    } else {
      Alert.alert(
        t('privacy.disagreeTitle'),
        t('privacy.iosCannotExit'),
        [{ text: t('common.ok'), style: 'default' }]
      );
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('privacy.title')}</Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
      >
        <Text style={styles.content}>{t('privacy.content')}</Text>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.button, styles.disagreeButton]}
          onPress={handleDisagree}
          activeOpacity={0.7}
        >
          <Text style={styles.disagreeText}>{t('privacy.disagree')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.agreeButton, agreeing && styles.buttonDisabled]}
          onPress={handleAgree}
          disabled={agreeing}
          activeOpacity={0.7}
        >
          <Text style={styles.agreeText}>{t('privacy.agree')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a1a',
    textAlign: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  content: {
    fontSize: 14,
    lineHeight: 22,
    color: '#333',
  },
  footer: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e0e0e0',
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disagreeButton: {
    backgroundColor: '#f2f2f2',
  },
  agreeButton: {
    backgroundColor: '#4A90D9',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  disagreeText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#555',
  },
  agreeText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
});
