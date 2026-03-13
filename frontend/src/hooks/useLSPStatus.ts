import { useQuery } from '@tanstack/react-query'
import { useCoStrictClient } from './useClient'

export function useLSPStatus(opcodeUrl: string | null | undefined, directory?: string) {
  const client = useCoStrictClient(opcodeUrl, directory)

  return useQuery({
    queryKey: ['costrict', 'lsp', opcodeUrl, directory],
    queryFn: () => client!.getLSPStatus(),
    enabled: !!client,
    refetchInterval: 30000,
    staleTime: 10000,
    refetchOnWindowFocus: true,
  })
}
