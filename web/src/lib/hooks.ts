import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { ApiError, fetchState, saveEntry, savePreferences } from '../api'
import { useToast } from '../components/Toast'
import type { Preferences, StatePayload } from '../types'

export function useRainlogState() {
  return useQuery({
    queryKey: ['state'],
    queryFn: fetchState,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
  })
}

export interface SetEntryVariables {
  date: string
  tenths: number | null
  etag?: string
  expectedPrevious?: number | null
}

export function useSetEntry() {
  const queryClient = useQueryClient()
  const { notify } = useToast()
  return useMutation({
    mutationFn: (variables: SetEntryVariables) =>
      saveEntry(variables.date, variables.tenths, {
        etag: variables.etag,
        expectedPrevious: variables.expectedPrevious,
      }),
    onSuccess: (state) => {
      queryClient.setQueryData(['state'], state)
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        if (error.status === 409) {
          if (error.body.state) queryClient.setQueryData(['state'], error.body.state)
          notify('The file changed elsewhere. Current readings were reloaded; please try again.', 'warn')
          return
        }
        if (error.status === 422) {
          notify('rainlog.json is not valid JSON. Use the Data page to inspect or recover it.', 'error')
          return
        }
        notify(error.message, 'error')
        return
      }
      notify('Could not save the reading.', 'error')
    },
  })
}

export function useSavePreferences() {
  const queryClient = useQueryClient()
  const { notify } = useToast()
  return useMutation({
    mutationFn: (prefs: Pick<Preferences, 'units' | 'customDays'>) => savePreferences(prefs),
    onSuccess: (prefs) => {
      queryClient.setQueryData<StatePayload>(['state'], (current) =>
        current ? { ...current, prefs } : current,
      )
    },
    onError: (error) => {
      notify(error instanceof ApiError ? error.message : 'Could not save settings.', 'error')
    },
  })
}

export function useEntryDraft(date: string, current: number | undefined) {
  const [draft, setDraft] = useState(current ? String(current) : '')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const dateRef = useRef(date)

  useEffect(() => {
    if (dateRef.current !== date) {
      dateRef.current = date
      setDraft(current ? String(current) : '')
      return
    }
    if (document.activeElement !== inputRef.current) setDraft(current ? String(current) : '')
  }, [date, current])

  return { draft, setDraft, inputRef }
}

export function apiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong.'
}
