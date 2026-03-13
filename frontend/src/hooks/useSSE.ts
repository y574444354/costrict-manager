import { useEffect, useRef, useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useCoStrictClient } from './useClient'
import type { SSEEvent, MessageWithParts } from '@/api/types'
import { showToast } from '@/lib/toast'
import { settingsApi } from '@/api/settings'
import { useSessionStatus } from '@/stores/sessionStatusStore'
import { useSessionTodos } from '@/stores/sessionTodosStore'
import { sseManager, subscribeToSSE, reconnectSSE, addSSEDirectory } from '@/lib/sseManager'
import { parseCoStrictError } from '@/lib/errors'
import { createPartsBatcher } from '@/lib/partsBatcher'

const handleRestartServer = async () => {
  showToast.loading('Reloading CoStrict configuration...', {
    id: 'restart-server',
  })

  try {
    const result = await settingsApi.reloadCoStrictConfig()
    if (result.success) {
      showToast.success(result.message || 'CoStrict configuration reloaded successfully', {
        id: 'restart-server',
        duration: 3000,
      })
      setTimeout(() => {
        window.location.reload()
      }, 2000)
    } else {
      showToast.error(result.message || 'Failed to reload CoStrict configuration', {
        id: 'restart-server',
        duration: 5000,
      })
    }
  } catch (error) {
    showToast.error(error instanceof Error ? error.message : 'Failed to reload CoStrict configuration', {
      id: 'restart-server',
      duration: 5000,
    })
  }
}


export const useSSE = (costrictUrl: string | null | undefined, directory?: string, currentSessionId?: string) => {
  const client = useCoStrictClient(costrictUrl, directory)
  const queryClient = useQueryClient()
  const mountedRef = useRef(true)
  const sessionIdRef = useRef(currentSessionId)
  sessionIdRef.current = currentSessionId
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const setSessionStatus = useSessionStatus((state) => state.setStatus)
  const setSessionTodos = useSessionTodos((state) => state.setTodos)
  const batcherRef = useRef<ReturnType<typeof createPartsBatcher> | null>(null)

  useEffect(() => {
    if (!costrictUrl) {
      batcherRef.current?.destroy()
      batcherRef.current = null
      return
    }

    batcherRef.current = createPartsBatcher(queryClient, costrictUrl, directory)

    return () => {
      batcherRef.current?.destroy()
      batcherRef.current = null
    }
  }, [queryClient, costrictUrl, directory])

  const handleSSEEvent = useCallback((event: SSEEvent) => {
    switch (event.type) {
      case 'session.updated':
        queryClient.invalidateQueries({ queryKey: ['costrict', 'sessions', costrictUrl, directory] })
        if ('info' in event.properties) {
          queryClient.invalidateQueries({ 
            queryKey: ['costrict', 'session', costrictUrl, event.properties.info.id, directory] 
          })
        }
        break

      case 'session.deleted':
        queryClient.invalidateQueries({ queryKey: ['costrict', 'sessions', costrictUrl, directory] })
        if ('sessionID' in event.properties) {
          queryClient.invalidateQueries({ 
            queryKey: ['costrict', 'session', costrictUrl, event.properties.sessionID, directory] 
          })
        }
        break

      case 'session.status': {
        if (!('sessionID' in event.properties && 'status' in event.properties)) break
        const { sessionID, status } = event.properties
        setSessionStatus(sessionID, status)
        break
      }

      case 'message.part.updated':
      case 'messagev2.part.updated': {
        if (!('part' in event.properties)) break
        const { part } = event.properties
        batcherRef.current?.queuePartUpdate(part.sessionID, part)
        break
      }

      case 'message.updated':
      case 'messagev2.updated': {
        if (!('info' in event.properties)) break
        
        const { info } = event.properties
        const sessionID = info.sessionID
        
        if (info.role === 'assistant') {
          const isComplete = 'completed' in info.time && info.time.completed
          setSessionStatus(sessionID, isComplete ? { type: 'idle' } : { type: 'busy' })
        }
        
        const messagesQueryKey = ['costrict', 'messages', costrictUrl, sessionID, directory]
        const currentData = queryClient.getQueryData<MessageWithParts[]>(messagesQueryKey)
        if (!currentData) {
          queryClient.invalidateQueries({ queryKey: messagesQueryKey })
          return
        }
        
        const messageExists = currentData.some(msgWithParts => msgWithParts.info.id === info.id)
        
        if (!messageExists) {
          const filteredData = info.role === 'user' 
            ? currentData.filter(msgWithParts => !msgWithParts.info.id.startsWith('optimistic_'))
            : currentData
          queryClient.setQueryData(messagesQueryKey, [...filteredData, { info, parts: [] }])
          return
        }
        
        const updated = currentData.map(msgWithParts => {
          if (msgWithParts.info.id !== info.id) return msgWithParts
          return { ...msgWithParts, info: { ...info } }
        })
        
        queryClient.setQueryData(messagesQueryKey, updated)
        break
      }

      case 'message.removed':
      case 'messagev2.removed': {
        if (!('sessionID' in event.properties && 'messageID' in event.properties)) break
        
        const { sessionID, messageID } = event.properties
        
        queryClient.setQueryData<MessageWithParts[]>(
          ['costrict', 'messages', costrictUrl, sessionID, directory],
          (old) => {
            if (!old) return old
            return old.filter(msgWithParts => msgWithParts.info.id !== messageID)
          }
        )
        break
      }

      case 'message.part.removed':
      case 'messagev2.part.removed': {
        if (!('sessionID' in event.properties && 'messageID' in event.properties && 'partID' in event.properties)) break
        
        const { sessionID, messageID, partID } = event.properties
        
        batcherRef.current?.queuePartRemoval(sessionID, messageID, partID)
        break
      }

      case 'session.compacted': {
        if (!('sessionID' in event.properties)) break
        
        const { sessionID } = event.properties
        setSessionStatus(sessionID, { type: 'idle' })
        showToast.dismiss(`compact-${sessionID}`)
        showToast.success('Session compacted')
        queryClient.invalidateQueries({ 
          queryKey: ['costrict', 'messages', costrictUrl, sessionID, directory] 
        })
        break
      }

      case 'session.idle': {
        if (!('sessionID' in event.properties)) break
        
        const { sessionID } = event.properties
        
        setSessionStatus(sessionID, { type: 'idle' })
        
        batcherRef.current?.flush()
        
        const messagesQueryKey = ['costrict', 'messages', costrictUrl, sessionID, directory]
        const currentData = queryClient.getQueryData<MessageWithParts[]>(messagesQueryKey)
        if (!currentData) break
        
        const now = Date.now()
        const updated = currentData.map(msgWithParts => {
          const msg = msgWithParts.info
          if (msg.role !== 'assistant') return msgWithParts
          
          if ('completed' in msg.time && msg.time.completed) return msgWithParts
          
          const updatedParts = msgWithParts.parts.map(part => {
            if (part.type !== 'tool') return part
            if (part.state.status !== 'running' && part.state.status !== 'pending') return part
            return {
              ...part,
              state: {
                ...part.state,
                status: 'completed' as const,
                output: part.state.status === 'running' ? '[Session ended - output not captured]' : '[Tool was pending when session ended]',
                title: part.state.status === 'running' ? (part.state as { title?: string }).title || '' : '',
                metadata: (part.state as { metadata?: Record<string, unknown> }).metadata || {},
                time: {
                  start: (part.state as { time?: { start: number } }).time?.start || now,
                  end: now
                }
              }
            }
          })
          
          return {
            ...msgWithParts,
            info: {
              ...msg,
              time: { ...msg.time, completed: now }
            },
            parts: updatedParts
          }
        })
        
        queryClient.setQueryData(messagesQueryKey, updated)
        break
      }

      case 'todo.updated':
        if ('sessionID' in event.properties && 'todos' in event.properties) {
          const { sessionID, todos } = event.properties
          setSessionTodos(sessionID, todos)
          queryClient.invalidateQueries({ 
            queryKey: ['costrict', 'todos', costrictUrl, sessionID, directory] 
          })
        }
        break

      case 'installation.updated':
        if ('version' in event.properties) {
          showToast.success(`CoStrict updated to v${event.properties.version}`, {
            description: 'The server has been successfully upgraded.',
            duration: 5000,
          })
        }
        break

      case 'installation.update-available':
        if ('version' in event.properties) {
          showToast.info(`CoStrict v${event.properties.version} is available`, {
            description: 'A new version is ready to install.',
            action: {
              label: 'Reload to Update',
              onClick: handleRestartServer
            },
            duration: 10000,
          })
        }
        break

      case 'session.error': {
        if (!('error' in event.properties)) break
        if ('sessionID' in event.properties && event.properties.sessionID === currentSessionId) break
        
        const error = event.properties.error
        if (error?.name === 'MessageAbortedError') break
        
        const parsed = parseCoStrictError(error)
        if (parsed) {
          showToast.error(parsed.title, {
            description: parsed.message,
            duration: 2500,
          })
        }
        break
      }

      case 'question.replied':
      case 'question.rejected': {
        if (!('sessionID' in event.properties)) break
        const { sessionID } = event.properties
        queryClient.invalidateQueries({ 
          queryKey: ['costrict', 'messages', costrictUrl, sessionID, directory] 
        })
        break
      }

      default:
        break
    }
  }, [queryClient, costrictUrl, directory, setSessionStatus, setSessionTodos, currentSessionId])

  const fetchInitialData = useCallback(async () => {
    if (!client || !mountedRef.current) return
    
    try {
      const statuses = await client.getSessionStatuses()
      if (mountedRef.current && statuses) {
        Object.entries(statuses).forEach(([sessionID, status]) => {
          setSessionStatus(sessionID, status)
        })
      }
    } catch (err) {
      if (err instanceof Error && !err.message.includes('aborted')) {
        throw err
      }
    }
  }, [client, setSessionStatus])

  useEffect(() => {
    mountedRef.current = true
    
    if (!costrictUrl) {
      setIsConnected(false)
      return
    }

    const handleMessage = (data: unknown) => {
      if (data && typeof data === 'object' && 'type' in data) {
        handleSSEEvent(data as SSEEvent)
      }
    }

    const handleStatusChange = (connected: boolean) => {
      if (!mountedRef.current) return
      setIsConnected(connected)
      setIsReconnecting(!connected)
      
      if (connected) {
        setError(null)
        fetchInitialData()
        sseManager.reportVisibility(document.visibilityState === 'visible', sessionIdRef.current)
      } else {
        setError('Connection lost. Reconnecting...')
      }
    }

    const directoryCleanup = directory ? addSSEDirectory(directory) : undefined

    const unsubscribe = subscribeToSSE(handleMessage, handleStatusChange)

    const handleReconnect = () => {
      reconnectSSE()
    }

    const handleVisibilityChange = () => {
      sseManager.reportVisibility(document.visibilityState === 'visible', sessionIdRef.current)
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleReconnect)
    window.addEventListener('online', handleReconnect)

    return () => {
      mountedRef.current = false
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleReconnect)
      window.removeEventListener('online', handleReconnect)
      unsubscribe()
      directoryCleanup?.()
    }
  }, [costrictUrl, directory, handleSSEEvent, fetchInitialData])

  useEffect(() => {
    if (isConnected && document.visibilityState === 'visible') {
      sseManager.reportVisibility(true, currentSessionId)
    }
  }, [currentSessionId, isConnected])

  return { isConnected, error, isReconnecting }
}
