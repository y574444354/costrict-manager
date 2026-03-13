import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { RepoLspServerList } from './RepoLspServerList'
import { useLSPStatus } from '@/hooks/useLSPStatus'

interface RepoLspDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  coststrictUrl: string | null | undefined
  directory?: string
}

export function RepoLspDialog({ open, onOpenChange, coststrictUrl, directory }: RepoLspDialogProps) {
  const { isLoading, data } = useLSPStatus(coststrictUrl, directory)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] w-full">
        <DialogHeader>
          <DialogTitle>LSP Servers</DialogTitle>
        </DialogHeader>
        <RepoLspServerList isLoading={isLoading} data={data} />
      </DialogContent>
    </Dialog>
  )
}
