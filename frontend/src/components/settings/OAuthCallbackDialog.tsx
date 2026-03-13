import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, ExternalLink, CheckCircle, Copy, Check } from 'lucide-react'
import { oauthApi, type OAuthAuthorizeResponse } from '@/api/oauth'
import { mapOAuthError, OAuthMethod } from '@/lib/oauthErrors'

interface OAuthCallbackDialogProps {
  providerId: string
  providerName: string
  authResponse: OAuthAuthorizeResponse
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function OAuthCallbackDialog({ 
  providerId, 
  providerName, 
  authResponse,
  open, 
  onOpenChange, 
  onSuccess 
}: OAuthCallbackDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState('')
  const [authCode, setAuthCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [popupClosed, setPopupClosed] = useState(false)
  const [copied, setCopied] = useState(false)
  const popupRef = useRef<Window | null>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }, [])

  const closePopup = useCallback(() => {
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.close()
    }
    popupRef.current = null
  }, [])

  const resetState = useCallback(() => {
    setIsLoading(false)
    setLoadingMessage('')
    setAuthCode('')
    setError(null)
    setPopupClosed(false)
    setCopied(false)
    stopPolling()
    closePopup()
  }, [stopPolling, closePopup])

  useEffect(() => {
    if (!open) {
      resetState()
    }
  }, [open, resetState])

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return

      if (event.data?.type === 'OAUTH_CODE' && event.data.code) {
        setAuthCode(event.data.code)
        handleCodeCallback(event.data.code)
        closePopup()
      } else if (event.data?.type === 'OAUTH_ERROR') {
        setError(`Authorization failed: ${event.data.errorDescription || event.data.error}`)
        closePopup()
      }
    }

    window.addEventListener('message', handleMessage)
    return () => {
      window.removeEventListener('message', handleMessage)
    }
  }, [closePopup])

  useEffect(() => {
    return () => {
      stopPolling()
      closePopup()
    }
  }, [stopPolling, closePopup])

  const startPopupPolling = useCallback(() => {
    if (pollingRef.current) return

    pollingRef.current = setInterval(() => {
      const popup = popupRef.current
      if (!popup) return

      if (popup.closed) {
        stopPolling()
        setPopupClosed(true)
      }
    }, 500)
  }, [stopPolling])

  const handleOpenAuthPage = () => {
    setPopupClosed(false)
    const width = 600
    const height = 700
    const left = window.screenX + (window.outerWidth - width) / 2
    const top = window.screenY + (window.outerHeight - height) / 2
    
    popupRef.current = window.open(
      authResponse.url,
      'oauth-popup',
      `width=${width},height=${height},left=${left},top=${top},popup=yes,scrollbars=yes`
    )
    
    startPopupPolling()
  }

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(authResponse.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  const handleCodeCallback = async (code: string) => {
    if (!code.trim()) {
      setError('Please enter the authorization code')
      return
    }

    setIsLoading(true)
    setLoadingMessage('Completing authentication...')
    setError(null)

    try {
      setLoadingMessage('Restarting server with new credentials...')
      await oauthApi.callback(providerId, { method: OAuthMethod.CODE, code: code.trim() })
      onSuccess()
    } catch (err) {
      setError(mapOAuthError(err, 'callback'))
      console.error('OAuth callback error:', err)
    } finally {
      setIsLoading(false)
      setLoadingMessage('')
    }
  }

  const handleClose = () => {
    resetState()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-card border-border max-w-lg">
        <DialogHeader>
          <DialogTitle>Complete {providerName} Authentication</DialogTitle>
          <DialogDescription>
            Complete authorization in the popup window. If automatic capture fails, you can manually enter the code.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        <div className="space-y-4">
          <div className="space-y-3">
            <div className="bg-muted p-3 rounded-md space-y-3">
              <p className="text-sm">{authResponse.instructions}</p>
              
              <Button
                onClick={handleOpenAuthPage}
                variant="outline"
                size="sm"
                className="w-full"
                disabled={isLoading}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Open Authorization Page
              </Button>

              <Button
                onClick={handleCopyUrl}
                variant="ghost"
                size="sm"
                className="w-full"
                disabled={isLoading}
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    URL Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-2" />
                    Copy Authorization URL
                  </>
                )}
              </Button>
            </div>

            {popupClosed && !authCode && (
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-md p-3">
                <p className="text-sm text-yellow-500">
                  Popup closed without receiving authorization code. 
                  Please paste the code manually below.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="authCode">Authorization Code</Label>
              <Input
                id="authCode"
                value={authCode}
                onChange={(e) => setAuthCode(e.target.value)}
                placeholder="Paste authorization code here..."
                className="bg-background border-border"
                disabled={isLoading}
              />
            </div>

            <Button
              onClick={() => handleCodeCallback(authCode)}
              className="w-full"
              disabled={isLoading || !authCode.trim()}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {loadingMessage || 'Completing...'}
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Complete Authentication
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
