import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

type VoicePrepareStatus = 'preparing' | 'ready' | null;

interface VoicePrepareOverlayProps {
  status: VoicePrepareStatus;
}

/**
 * 语音模式准备状态遮罩
 * - preparing: 脉冲动画 + "语音系统准备中..."
 * - ready: 绿色对勾 + "语音已就绪"
 */
export const VoicePrepareOverlay: React.FC<VoicePrepareOverlayProps> = ({ status }) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0.6)).current;

  // 淡入淡出
  useEffect(() => {
    if (status) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [status, fadeAnim]);

  // 脉冲动画（仅 preparing 阶段）
  useEffect(() => {
    if (status !== 'preparing') {
      pulseAnim.setValue(1);
      pulseOpacity.setValue(0.6);
      return;
    }

    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.8,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(pulseOpacity, {
            toValue: 0,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseOpacity, {
            toValue: 0.6,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [status, pulseAnim, pulseOpacity]);

  if (!status) return null;

  const isPreparing = status === 'preparing';

  return (
    <Animated.View style={[styles.overlay, { opacity: fadeAnim }]} pointerEvents="none">
      <View style={styles.content}>
        {/* 圆圈区域（固定尺寸，波纹从这里散出） */}
        <View style={styles.circleArea}>
          {/* 脉冲圆环（preparing 时显示） */}
          {isPreparing && (
            <Animated.View
              style={[
                styles.pulseRing,
                {
                  transform: [{ scale: pulseAnim }],
                  opacity: pulseOpacity,
                },
              ]}
            />
          )}

          {/* 中心圆 */}
          <View
            style={[
              styles.centerCircle,
              isPreparing ? styles.centerCirclePreparing : styles.centerCircleReady,
            ]}
          >
            <Text style={styles.iconText}>{isPreparing ? '🎤' : '✓'}</Text>
          </View>
        </View>

        {/* 状态文字 */}
        <Text style={styles.statusText}>
          {isPreparing ? '语音系统准备中...' : '语音已就绪'}
        </Text>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2000,
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleArea: {
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
    borderColor: '#5CE6FF',
    backgroundColor: 'rgba(64, 197, 241, 0.15)',
  },
  centerCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerCirclePreparing: {
    backgroundColor: 'rgba(64, 197, 241, 0.45)',
    borderWidth: 2,
    borderColor: '#5CE6FF',
  },
  centerCircleReady: {
    backgroundColor: 'rgba(82, 196, 26, 0.5)',
    borderWidth: 2,
    borderColor: '#73d13d',
  },
  iconText: {
    fontSize: 32,
  },
  statusText: {
    color: '#fff',
    fontSize: 16,
    marginTop: 16,
    fontWeight: '600',
    textShadowColor: 'rgba(64, 197, 241, 0.6)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
});
