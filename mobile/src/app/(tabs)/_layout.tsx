import { Ionicons } from '@expo/vector-icons'
import { Tabs } from 'expo-router'
import { Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useThreadsRealtime, useUnreadThreadCount } from '@/data/threads'
import { useLeadsRealtime } from '@/data/leads'
import { colors } from '@/theme/tokens'

// Room for a 24px icon above an 11px label, and a comfortable touch target.
// The system gesture bar / navigation bar is added on top of this: under
// edge-to-edge (mandatory on Android from SDK 54) the tab bar is drawn behind
// the system bar, and expo-router takes a numeric `height` literally instead of
// adding the inset itself. A fixed height therefore left the tabs squeezed into
// whatever the navigation bar did not cover — and unreliable to tap.
const TAB_BAR_CONTENT_HEIGHT = 56
const TAB_BAR_PADDING_TOP = 6

export default function TabsLayout() {
  // Realtime subscriptions live at the tab root so every tab stays fresh.
  useThreadsRealtime()
  useLeadsRealtime()
  const insets = useSafeAreaInsets()
  const unreadCount = useUnreadThreadCount().data ?? 0

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        // Android keeps the tab bar above the keyboard otherwise, stealing a
        // row of space from an already cramped screen.
        tabBarHideOnKeyboard: Platform.OS === 'android',
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          height: TAB_BAR_CONTENT_HEIGHT + insets.bottom,
          paddingTop: TAB_BAR_PADDING_TOP,
          paddingBottom: insets.bottom,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        sceneStyle: { backgroundColor: colors.page },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Chats',
          tabBarBadge: unreadCount > 0 ? (unreadCount > 99 ? '99+' : unreadCount) : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.accent, fontSize: 10 },
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'chatbubbles' : 'chatbubbles-outline'} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="leads"
        options={{
          title: 'Leads',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'people' : 'people-outline'} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="projects"
        options={{
          title: 'Projects',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'grid' : 'grid-outline'} size={23} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="me"
        options={{
          title: 'Me',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'person-circle' : 'person-circle-outline'} size={25} color={color} />
          ),
        }}
      />
    </Tabs>
  )
}
