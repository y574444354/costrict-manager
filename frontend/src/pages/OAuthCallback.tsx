import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, CheckCircle, XCircle } from 'lucide-react'

export function OAuthCallback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing')
  const [message, setMessage] = useState('Processing authorization...')

  useEffect(() => {
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')
    const errorDescription = searchParams.get('error_description')

    if (error) {
      setStatus('error')
      setMessage(`Authorization failed: ${errorDescription || error}`)
      
      if (window.opener) {
        window.opener.postMessage({
          type: 'OAUTH_ERROR',
          error,
          errorDescription
        }, window.location.origin)
      }
      return
    }

    if (!code) {
      setStatus('error')
      setMessage('No authorization code received')
      
      if (window.opener) {
        window.opener.postMessage({
          type: 'OAUTH_ERROR',
          error: 'no_code',
          errorDescription: 'No authorization code received'
        }, window.location.origin)
      }
      return
    }

    setStatus('success')
    setMessage('Authorization successful! You can close this window.')

    if (window.opener) {
      window.opener.postMessage({
        type: 'OAUTH_CODE',
        code,
        state
      }, window.location.origin)
      
      setTimeout(() => {
        window.close()
      }, 1500)
    } else {
      setMessage('Authorization code received. Please return to the application.')
    }
  }, [searchParams])

  const handleClose = () => {
    window.close()
  }

  const handleGoHome = () => {
    navigate('/')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md bg-card border-border">
        <CardHeader className="text-center">
          <CardTitle className="text-foreground">
            {status === 'processing' && 'Processing Authorization'}
            {status === 'success' && 'Authorization Successful'}
            {status === 'error' && 'Authorization Failed'}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {message}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          {status === 'processing' && (
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
          )}
          {status === 'success' && (
            <CheckCircle className="h-12 w-12 text-green-500" />
          )}
          {status === 'error' && (
            <XCircle className="h-12 w-12 text-destructive" />
          )}

          <div className="flex gap-2">
            {window.opener && (
              <Button onClick={handleClose} variant="outline">
                Close Window
              </Button>
            )}
            {!window.opener && (
              <Button onClick={handleGoHome}>
                Go to Home
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
