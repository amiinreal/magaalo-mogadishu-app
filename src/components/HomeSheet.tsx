import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, PanResponder, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../i18n';
import { styles } from './ui';

/** Drag only the handle: content remains scrollable and map gestures stay on the map. */
export function HomeSheet({ children, extra, onLayout }: {
  children: ReactNode; extra: ReactNode; onLayout: (height: number) => void;
}) {
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const compact = Math.min(286 + insets.bottom, windowHeight * 0.48);
  const expandedHeight = Math.max(compact, Math.min(530 + insets.bottom, windowHeight - insets.top - 130));
  const [expanded, setExpanded] = useState(false);
  const [height] = useState(() => new Animated.Value(compact));
  const current = useRef(compact);
  const start = useRef(compact);
  const target = expanded ? expandedHeight : compact;
  useEffect(() => {
    const id = height.addListener(({ value }) => { current.current = value; });
    return () => height.removeListener(id);
  }, [height]);
  useEffect(() => {
    onLayout(target);
    const animation = Animated.spring(height, { toValue: target, useNativeDriver: false, damping: 25, stiffness: 250, mass: 1 });
    animation.start();
    return () => animation.stop();
  }, [target, height, onLayout]);
  // PanResponder registers callbacks; these refs are read only during gestures.
  // eslint-disable-next-line react-hooks/refs
  const pan = PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 5,
    onPanResponderGrant: () => { height.stopAnimation(); start.current = current.current; },
    onPanResponderMove: (_, g) => height.setValue(Math.max(compact, Math.min(expandedHeight, start.current - g.dy))),
    onPanResponderRelease: (_, g) => {
      const open = Math.abs(g.vy) > 0.3 ? g.vy < 0 : current.current > (compact + expandedHeight) / 2;
      setExpanded(open);
      // Also settle a drag that returns to its existing snap point.
      Animated.spring(height, { toValue: open ? expandedHeight : compact, useNativeDriver: false, damping: 25, stiffness: 250 }).start();
    },
    onPanResponderTerminate: () => Animated.spring(height, { toValue: target, useNativeDriver: false }).start(),
  });
  return (
    <Animated.View style={[styles.sheet, { height, paddingTop: 0, overflow: 'hidden', paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View {...pan.panHandlers}>
        <Pressable accessibilityRole="button" accessibilityLabel={t(expanded ? 'explore.collapse' : 'explore.expand')}
          accessibilityState={{ expanded }} onPress={() => setExpanded(v => !v)}
          style={{ height: 32, alignItems: 'center', justifyContent: 'center' }}>
          <View style={[styles.handle, { marginBottom: 0 }]} />
        </Pressable>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 6 }}>
        {children}
        {expanded ? extra : null}
      </ScrollView>
    </Animated.View>
  );
}
