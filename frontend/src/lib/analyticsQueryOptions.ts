import type { UseQueryOptions } from '@tanstack/react-query'

export const ANALYTICS_STALE_TIME_MS = 30_000
export const ANALYTICS_REFETCH_INTERVAL_MS = 30_000
export const ANALYTICS_SLOW_STALE_TIME_MS = 60_000
export const ANALYTICS_SLOW_REFETCH_INTERVAL_MS = 60_000
export const ANALYTICS_AI_STALE_TIME_MS = 5 * 60_000
export const ANALYTICS_AI_REFETCH_INTERVAL_MS = 5 * 60_000

export function liveAnalyticsQueryOptions<TData>(
  options: Pick<UseQueryOptions<TData>, 'queryKey' | 'queryFn' | 'enabled'>
): UseQueryOptions<TData> {
  return {
    staleTime: ANALYTICS_STALE_TIME_MS,
    refetchInterval: ANALYTICS_REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: true,
    retry: 1,
    ...options,
  }
}

export function slowAnalyticsQueryOptions<TData>(
  options: Pick<UseQueryOptions<TData>, 'queryKey' | 'queryFn' | 'enabled'>
): UseQueryOptions<TData> {
  return {
    staleTime: ANALYTICS_SLOW_STALE_TIME_MS,
    refetchInterval: ANALYTICS_SLOW_REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: true,
    retry: 1,
    ...options,
  }
}

export function aiAnalyticsQueryOptions<TData>(
  options: Pick<UseQueryOptions<TData>, 'queryKey' | 'queryFn' | 'enabled'>
): UseQueryOptions<TData> {
  return {
    staleTime: ANALYTICS_AI_STALE_TIME_MS,
    refetchInterval: ANALYTICS_AI_REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: true,
    retry: false,
    ...options,
  }
}
