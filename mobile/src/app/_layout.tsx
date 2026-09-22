import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query'
import { Stack, useRouter, useSegments } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { BrandSplash } from '@/components/ui/brand-splash'
import { AuthProvider, useAuth } from '@/providers/auth'
import { PushProvider } from '@/providers/push'
import { colors } from '@/theme/tokens'

SplashScreen.preventAutoHideAsync().catch(() => {})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1, refetchOnReconnect: true },
  },
})

// Refetch stale queries when the app returns to the foreground.
AppState.addEventListener('change', (status: AppStateStatus) => {
  focusManager.setFocused(status === 'active')
})

function AuthGate() {
  const { isLoading, session, isReady } = useAuth()
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => {
    if (isLoading) return
    const inAuth = segments[0] === '(auth)'
    if (!session && !inAuth) router.replace('/(auth)/sign-in')
    else if (session && !isReady && segments[0] !== '(auth)') router.replace('/(auth)/blocked')
    else if (session && isReady && inAuth) router.replace('/(tabs)')
  }, [isLoading, session, isReady, segments, router])

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.page },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="chat/[threadId]" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="lead/[leadId]" options={{ presentation: 'card' }} />
      <Stack.Screen name="projects/[workspaceId]" />
      <Stack.Screen name="project/[projectId]" />
      <Stack.Screen name="saved-messages" options={{ presentation: 'modal' }} />
      <Stack.Screen name="saved-message/[id]" options={{ presentation: 'modal' }} />
      <Stack.Screen name="submissions" />
    </Stack>
  )
}

/** Keeps the brand splash mounted over the navigator until auth has resolved. */
function AppShell() {
  const { isLoading } = useAuth()

  return (
    <>
      <StatusBar style="dark" />
      <AuthGate />
      <BrandSplash appReady={!isLoading} />
    </>
  )
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <PushProvider>
              <AppShell />
            </PushProvider>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
