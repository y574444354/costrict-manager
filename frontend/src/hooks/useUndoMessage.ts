import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createCoStrictClient } from '@/api/client'
import { showToast } from '@/lib/toast'
import type { MessageWithParts } from '@/api/types'

interface UseUndoMessageOptions {
  coststrictUrl: string | null
  sessionId: string
  directory?: string
  onSuccess?: (restoredPrompt: string) => void
}

interface UndoMessageContext {
  previousMessages?: MessageWithParts[]
}

export function useUndoMessage({ 
  coststrictUrl, 
  sessionId, 
  directory,
  onSuccess 
}: UseUndoMessageOptions) {
  const queryClient = useQueryClient()

  return useMutation<string, Error, { messageID: string; messageContent: string }, UndoMessageContext>({
    mutationFn: async ({ messageID, messageContent }: { messageID: string, messageContent: string }) => {
      if (!coststrictUrl) throw new Error('OpenCode URL not available')
      
      const client = createCoStrictClient(coststrictUrl, directory)
      await client.revertMessage(sessionId, { messageID })
      return messageContent
    },
    onMutate: async ({ messageID }) => {
      const queryKey = ['opencode', 'messages', coststrictUrl, sessionId, directory]
      
      await queryClient.cancelQueries({ queryKey })
      
      const previousMessages = queryClient.getQueryData<MessageWithParts[]>(queryKey)
      
      if (previousMessages) {
        const messageIndex = previousMessages.findIndex(m => m.info.id === messageID)
        if (messageIndex !== -1) {
          const newMessages = previousMessages.slice(0, messageIndex)
          queryClient.setQueryData(queryKey, newMessages)
        }
      }
      
      return { previousMessages }
    },
    onError: (_error, _variables, _context: UndoMessageContext | undefined) => {
      if (_context?.previousMessages) {
        queryClient.setQueryData(
          ['opencode', 'messages', coststrictUrl, sessionId, directory],
          _context.previousMessages
        )
      }
      
      showToast.error('Failed to undo message')
    },
    onSuccess: (restoredPrompt) => {
      queryClient.invalidateQueries({
        queryKey: ['opencode', 'messages', coststrictUrl, sessionId, directory]
      })
      queryClient.invalidateQueries({
        queryKey: ['opencode', 'session', coststrictUrl, sessionId, directory]
      })
      onSuccess?.(restoredPrompt)
    }
  })
}
