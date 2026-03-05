/**
 * ChatContainer - React Native 版本
 *
 * 使用 React Native 组件实现的聊天界面：
 * - TouchableOpacity 浮动按钮（缩小态）
 * - Modal 聊天面板（展开态）
 * - ScrollView 消息列表
 * - TextInput 输入框
 * - 连接状态指示器
 * - 相机拍照功能（移动端）
 *
 * 支持两种模式：
 * 1. 非受控模式（默认）：组件内部管理消息状态
 * 2. 受控模式：通过 props 传入 externalMessages 和 onSendMessage
 *
 * @platform Android/iOS - 原生实现
 * @see ChatContainer.tsx - Web 版本（HTML/CSS 实现）
 */

import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  TextInput,
  TouchableWithoutFeedback,
  Image,
  Alert,
  PermissionsAndroid,
  Platform,
  Keyboard,
} from 'react-native';
import type { ScrollView as ScrollViewType } from 'react-native';
import { useT, tOrDefault } from '../i18n';
import { useChatState, useSendMessage } from './hooks';
import type { ChatMessage, ExternalChatMessage, ChatContainerProps, ConnectionStatus } from './types';
import { styles } from './styles.native';

// 可选：如果安装了 react-native-camera 或 expo-camera，可以启用相机功能
// import { launchCamera } from 'react-native-image-picker';

const MAX_SCREENSHOTS = 5;

/**
 * 将外部消息类型转换为内部 ChatMessage 类型
 */
function convertExternalMessage(msg: ExternalChatMessage): ChatMessage {
  const roleMap: Record<ExternalChatMessage['sender'], ChatMessage['role']> = {
    user: 'user',
    gemini: 'assistant',
    system: 'system',
  };

  return {
    id: msg.id,
    role: roleMap[msg.sender],
    content: msg.text,
    createdAt: new Date(msg.timestamp).getTime() || Date.now(),
  };
}

/**
 * 获取连接状态指示器颜色
 */
function getStatusColor(status: ConnectionStatus): string {
  switch (status) {
    case 'open':
      return '#52c41a'; // green
    case 'connecting':
    case 'reconnecting':
    case 'closing':
      return '#faad14'; // yellow
    case 'closed':
      return '#ff4d4f'; // red
    default:
      return '#d9d9d9'; // gray
  }
}

/**
 * 获取连接状态文本
 */
function getStatusText(status: ConnectionStatus, customText?: string, t?: any): string {
  if (customText) return customText;
  switch (status) {
    case 'open':
      return tOrDefault(t, 'chat.status.connected', '已连接');
    case 'connecting':
      return tOrDefault(t, 'chat.status.connecting', '连接中...');
    case 'reconnecting':
      return tOrDefault(t, 'chat.status.reconnecting', '重连中...');
    case 'closing':
      return tOrDefault(t, 'chat.status.closing', '断开中...');
    case 'closed':
      return tOrDefault(t, 'chat.status.disconnected', '已断开');
    default:
      return tOrDefault(t, 'chat.status.idle', '待连接');
  }
}

export default function ChatContainer({
  externalMessages,
  onSendMessage,
  onSendText, // deprecated, for backward compatibility
  connectionStatus = 'idle',
  disabled = false,
  statusText,
  cameraEnabled = false,
  onPickImage,
  onTakePhoto: onTakePhotoProp,
  renderFloatingOverlay,
  forceCollapsed,
  externalPendingImages,
  onClearExternalPendingImages,
}: ChatContainerProps = {}) {
  const t = useT();

  // 判断是否为受控模式
  const isControlled = externalMessages !== undefined;

  // 使用 onSendMessage 或 deprecated 的 onSendText
  const sendHandler = onSendMessage || (onSendText ? (text: string) => onSendText(text) : undefined);

  // 使用共享的状态管理（非受控模式）
  const {
    collapsed,
    setCollapsed,
    messages: internalMessages,
    setMessages,
    addMessages,
    pendingScreenshots,
    setPendingScreenshots,
  } = useChatState();

  // 输入框状态
  const [inputValue, setInputValue] = React.useState('');

  // ScrollView ref 用于自动滚动
  const scrollViewRef = useRef<ScrollViewType>(null);

  // 滚动到底部
  const scrollToBottom = React.useCallback((animated = true) => {
    // 延迟执行确保布局完成
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated });
    }, 100);
  }, []);

  // 计算实际显示的消息列表
  const displayMessages: ChatMessage[] = React.useMemo(() => {
    if (isControlled && externalMessages) {
      return externalMessages.map(convertExternalMessage);
    }
    return internalMessages;
  }, [isControlled, externalMessages, internalMessages]);

  // 消息列表变化时自动滚动到底部
  useEffect(() => {
    if (displayMessages.length > 0 && !collapsed) {
      scrollToBottom();
    }
  }, [displayMessages.length, collapsed, scrollToBottom]);

  // 展开面板时滚动到底部
  useEffect(() => {
    if (!collapsed) {
      // 延迟稍长一点，确保 Modal 动画完成后再滚动
      setTimeout(() => {
        scrollToBottom(false);
      }, 300);
    }
  }, [collapsed, scrollToBottom]);

  // 键盘弹起时滚动到底部
  useEffect(() => {
    const keyboardDidShowListener = Keyboard.addListener('keyboardDidShow', () => {
      if (!collapsed) {
        scrollToBottom();
      }
    });

    return () => {
      keyboardDidShowListener.remove();
    };
  }, [collapsed, scrollToBottom]);

  // 远端强制折叠
  useEffect(() => {
    if (forceCollapsed) {
      setCollapsed(true);
    }
  }, [forceCollapsed, setCollapsed]);

  // 处理外部传入的待发送图片（如从相册选择的图片）
  useEffect(() => {
    if (externalPendingImages && externalPendingImages.length > 0) {
      setPendingScreenshots((prev) => {
        const combined = [...prev, ...externalPendingImages];
        // 限制最多 5 张
        return combined.slice(0, MAX_SCREENSHOTS);
      });
      // 清除外部图片（已添加到内部状态）
      onClearExternalPendingImages?.();
    }
  }, [externalPendingImages, onClearExternalPendingImages, setPendingScreenshots]);

  // 初始化欢迎消息（仅非受控模式）
  React.useEffect(() => {
    if (!isControlled && internalMessages.length === 0) {
      setMessages([
        {
          id: 'sys-1',
          role: 'system',
          content: tOrDefault(
            t,
            'chat.welcome',
            '欢迎来到 React 聊天系统（迁移 Demo）'
          ),
          createdAt: Date.now(),
        },
      ]);
    }
  }, [isControlled, internalMessages.length, setMessages, t]);

  // 发送消息逻辑（非受控模式）
  const { handleSendText: internalHandleSendText } = useSendMessage(
    addMessages,
    pendingScreenshots,
    () => setPendingScreenshots([])
  );

  // RN 发送处理（清空输入框）
  const handleSend = () => {
    if (disabled) return;

    const trimmed = inputValue.trim();
    const images = pendingScreenshots.map(p => p.base64);

    if (sendHandler) {
      // 受控模式：使用新的 onSendMessage 或旧的 onSendText
      if (trimmed.length === 0 && images.length === 0) return;

      if (onSendMessage) {
        // 新接口：支持图片
        onSendMessage(trimmed, images.length > 0 ? images : undefined);
      } else if (onSendText && trimmed.length > 0) {
        // 旧接口：只支持文本
        onSendText(trimmed);
      }

      setPendingScreenshots([]);
    } else {
      // 非受控模式：使用内部逻辑（支持截图）
      if (trimmed.length === 0 && pendingScreenshots.length === 0) return;
      internalHandleSendText(trimmed);
    }
    setInputValue('');
  };

  // RN 相机拍照功能
  const handleTakePhoto = async () => {
    if (disabled) return;

    // 相机功能未启用时，显示提示并返回（不请求权限）
    if (!cameraEnabled) {
      Alert.alert(
        tOrDefault(t, 'chat.camera.title', '相机功能'),
        tOrDefault(
          t,
          'chat.camera.not_implemented',
          '相机功能需要安装 react-native-image-picker 或 expo-image-picker。\n\n请参考文档进行集成。'
        ),
        [{ text: tOrDefault(t, 'chat.camera.ok', '确定') }]
      );
      return;
    }

    // 检查截图数量限制
    if (pendingScreenshots.length >= MAX_SCREENSHOTS) {
      Alert.alert(
        tOrDefault(t, 'chat.screenshot.title', '拍照'),
        tOrDefault(t, 'chat.screenshot.maxReached', `最多只能添加 ${MAX_SCREENSHOTS} 张照片`)
      );
      return;
    }

    // 如果提供了外部拍照回调，使用它
    if (onTakePhotoProp) {
      onTakePhotoProp();
      return;
    }

    // 相机功能已启用，检查相机权限（Android）
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.CAMERA,
          {
            title: tOrDefault(t, 'chat.camera.permission.title', '相机权限'),
            message: tOrDefault(t, 'chat.camera.permission.message', '需要相机权限来拍照'),
            buttonNeutral: tOrDefault(t, 'chat.camera.permission.later', '稍后'),
            buttonNegative: tOrDefault(t, 'chat.camera.permission.cancel', '取消'),
            buttonPositive: tOrDefault(t, 'chat.camera.permission.ok', '确定'),
          }
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          Alert.alert(
            tOrDefault(t, 'chat.camera.permission.denied.title', '权限被拒绝'),
            tOrDefault(t, 'chat.camera.permission.denied.message', '无法访问相机，请在设置中允许相机权限')
          );
          return;
        }
      } catch (err) {
        console.warn('[ChatContainer] Camera permission error:', err);
        return;
      }
    }

  };

  // 合并的图片操作按钮 - 弹出选项菜单
  const handleImageAction = () => {
    if (disabled) return;

    // 检查截图数量限制
    if (pendingScreenshots.length >= MAX_SCREENSHOTS) {
      Alert.alert(
        tOrDefault(t, 'chat.image.title', '图片'),
        tOrDefault(t, 'chat.image.maxReached', `最多只能添加 ${MAX_SCREENSHOTS} 张图片`)
      );
      return;
    }

    type AlertOption = { text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void };
    const options: AlertOption[] = [];
    if (onPickImage) {
      options.push({
        text: tOrDefault(t, 'chat.image.gallery', '从相册选择'),
        onPress: () => onPickImage(),
      });
    }
    if (onTakePhotoProp) {
      options.push({
        text: tOrDefault(t, 'chat.image.camera', '拍照'),
        onPress: () => handleTakePhoto(),
      });
    }
    options.push({
      text: tOrDefault(t, 'common.cancel', '取消'),
      style: 'cancel',
    });

    Alert.alert(
      tOrDefault(t, 'chat.image.title', '添加图片'),
      undefined,
      options
    );
  };

  // 渲染单个消息
  const renderMessage = (msg: ChatMessage) => {
    const isUser = msg.role === 'user';

    return (
      <View
        key={msg.id}
        style={[
          styles.messageBubble,
          isUser ? styles.messageBubbleUser : styles.messageBubbleOther,
        ]}
      >
        {msg.image && (
          <Image
            source={{ uri: msg.image }}
            style={styles.messageImage}
            resizeMode="cover"
          />
        )}
        {msg.content && (
          <Text style={styles.messageText}>{msg.content}</Text>
        )}
        {!msg.content && !msg.image && (
          <Text style={styles.messageTextEmpty}>
            {tOrDefault(t, 'chat.message.empty', '空消息')}
          </Text>
        )}
      </View>
    );
  };

  // ===== 缩小态：浮动按钮 =====
  if (collapsed) {
    return (
      <TouchableOpacity
        style={styles.floatingButton}
        onPress={() => setCollapsed(false)}
        activeOpacity={0.8}
      >
        <Text style={styles.floatingButtonEmoji}>💬</Text>
      </TouchableOpacity>
    );
  }

  // ===== 展开态：Modal 聊天面板 =====
  return (
    <Modal
      visible={!collapsed}
      transparent
      animationType="slide"
      onRequestClose={() => setCollapsed(true)}
    >
      <TouchableWithoutFeedback onPress={() => setCollapsed(true)}>
        <View style={styles.modalOverlay}>
          <TouchableWithoutFeedback>
            <View style={styles.chatPanel}>
              {/* Header */}
              <View style={styles.header}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={styles.headerTitle}>
                    {tOrDefault(t, 'chat.title', '💬 Chat')}
                  </Text>
                  {/* 连接状态指示器 - 仅在受控模式下显示 */}
                  {sendHandler && (
                    <View style={styles.headerStatusContainer}>
                      <View
                        style={[
                          styles.headerStatusDot,
                          { backgroundColor: getStatusColor(connectionStatus) },
                        ]}
                      />
                      <Text style={styles.headerStatusText}>
                        {getStatusText(connectionStatus, statusText, t)}
                      </Text>
                    </View>
                  )}
                </View>
                <TouchableOpacity
                  style={styles.minimizeButton}
                  onPress={() => setCollapsed(true)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.minimizeButtonText}>—</Text>
                </TouchableOpacity>
              </View>

              {/* 消息列表 */}
              <ScrollView
                ref={scrollViewRef}
                style={styles.messageList}
                contentContainerStyle={styles.messageListContent}
                showsVerticalScrollIndicator={true}
                keyboardShouldPersistTaps="handled"
                onContentSizeChange={() => {
                  // 内容变化时滚动到底部
                  scrollToBottom();
                }}
              >
                {displayMessages.map(renderMessage)}
              </ScrollView>

              {/* 待发送截图预览 */}
              {pendingScreenshots.length > 0 && (
                <View style={styles.pendingContainer}>
                  <View style={styles.pendingHeader}>
                    <Text style={styles.pendingTitle}>
                      {tOrDefault(
                        t,
                        'chat.screenshot.pending',
                        `📸 待发送照片 (${pendingScreenshots.length})`
                      )}
                    </Text>
                    <TouchableOpacity
                      style={styles.clearAllButton}
                      onPress={() => setPendingScreenshots([])}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.clearAllButtonText}>
                        {tOrDefault(t, 'chat.screenshot.clearAll', '清除全部')}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <ScrollView horizontal style={styles.pendingList}>
                    {pendingScreenshots.map((p) => (
                      <View key={p.id} style={styles.pendingItem}>
                        <Image
                          source={{ uri: p.base64 }}
                          style={styles.pendingImage}
                          resizeMode="cover"
                        />
                        <TouchableOpacity
                          style={styles.removeButton}
                          onPress={() =>
                            setPendingScreenshots((prev) =>
                              prev.filter((x) => x.id !== p.id)
                            )
                          }
                          activeOpacity={0.7}
                        >
                          <Text style={styles.removeButtonText}>×</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* 输入区域 */}
              <View style={styles.inputContainer}>
                <TextInput
                  style={[
                    styles.textInput,
                    disabled && styles.textInputDisabled,
                  ]}
                  value={inputValue}
                  onChangeText={setInputValue}
                  placeholder={tOrDefault(
                    t,
                    'chat.input.placeholder',
                    'Text chat mode...'
                  )}
                  placeholderTextColor="rgba(0, 0, 0, 0.4)"
                  multiline
                  blurOnSubmit={false}
                  editable={!disabled}
                />

                <View style={styles.buttonGroup}>
                  {/* 左侧：图片按钮（合并相册+拍照） */}
                  {(onPickImage || onTakePhotoProp) && (
                    <TouchableOpacity
                      style={[
                        styles.imageButton,
                        disabled && styles.imageButtonDisabled,
                      ]}
                      onPress={handleImageAction}
                      activeOpacity={0.7}
                      disabled={disabled}
                    >
                      <Text
                        style={[
                          styles.imageButtonText,
                          disabled && styles.imageButtonTextDisabled,
                        ]}
                      >
                        {tOrDefault(t, 'chat.image.button', '图片')}
                      </Text>
                    </TouchableOpacity>
                  )}

                  {/* 右侧：发送按钮 */}
                  <TouchableOpacity
                    style={[
                      styles.sendButton,
                      disabled && styles.sendButtonDisabled,
                    ]}
                    onPress={handleSend}
                    activeOpacity={0.7}
                    disabled={disabled}
                  >
                    <Text
                      style={[
                        styles.sendButtonText,
                        disabled && styles.sendButtonTextDisabled,
                      ]}
                    >
                      {tOrDefault(t, 'chat.send', '发送')}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </TouchableWithoutFeedback>

          {/* 浮动覆盖层插槽（如打断按钮）：绝对定位在 Modal 内，pointer-events 穿透空白区域 */}
          {renderFloatingOverlay && (
            <View
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
              pointerEvents="box-none"
            >
              {renderFloatingOverlay()}
            </View>
          )}
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}
