import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { GeneralSettings } from '@/components/settings/GeneralSettings'
import { GitSettings } from '@/components/settings/GitSettings'
import { KeyboardShortcuts } from '@/components/settings/KeyboardShortcuts'
import { ConfigManager } from '@/components/settings/ConfigManager'
import { ProviderSettings } from '@/components/settings/ProviderSettings'
import { AccountSettings } from '@/components/settings/AccountSettings'
import { VoiceSettings } from '@/components/settings/VoiceSettings'
import { NotificationSettings } from '@/components/settings/NotificationSettings'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Settings2, Keyboard, Code, ChevronLeft, Key, GitBranch, User, Volume2, Bell, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSwipeBack } from '@/hooks/useMobile'
import { useSettingsDialog } from '@/hooks/useSettingsDialog'

type SettingsView = 'menu' | 'general' | 'git' | 'shortcuts' | 'costrict' | 'providers' | 'account' | 'voice' | 'notifications'

export function SettingsDialog() {
  const { t } = useTranslation()
  const { isOpen, close, activeTab, setActiveTab } = useSettingsDialog()
  const [mobileView, setMobileView] = useState<SettingsView>('menu')
  const contentRef = useRef<HTMLDivElement>(null)

  const handleSwipeBack = useCallback(() => {
    if (mobileView === 'menu') {
      setMobileView('menu')
      close()
    } else {
      setMobileView('menu')
    }
  }, [mobileView, close])

  const { bind: bindSwipe, swipeStyles } = useSwipeBack(handleSwipeBack, {
    enabled: isOpen,
  })

  useEffect(() => {
    return bindSwipe(contentRef.current)
  }, [bindSwipe])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, close])

  const menuItems = [
    { id: 'account', icon: User, label: t('settings.account'), description: t('settings.account') },
    { id: 'general', icon: Settings2, label: t('settings.general'), description: t('settings.general') },
    { id: 'notifications', icon: Bell, label: t('settings.notifications'), description: t('settings.notifications') },
    { id: 'voice', icon: Volume2, label: t('settings.voice'), description: t('settings.voice') },
    { id: 'git', icon: GitBranch, label: t('settings.git'), description: t('settings.git') },
    { id: 'shortcuts', icon: Keyboard, label: t('settings.keyboard'), description: t('settings.keyboard') },
    { id: 'costrict', icon: Code, label: t('settings.configs'), description: t('settings.configs') },
    { id: 'providers', icon: Key, label: t('settings.providers'), description: t('settings.providers') },
  ]

  const handleTabChange = (tab: string) => {
    setActiveTab(tab as SettingsView)
  }

   return (
     <Dialog open={isOpen} modal={false}>
       <DialogContent 
         ref={contentRef}
         className="inset-0 w-full h-full max-w-none max-h-none p-0 rounded-none bg-gradient-to-br from-background via-background to-background border-border overflow-hidden !flex !flex-col"
         style={swipeStyles}
         fullscreen
       >
         <div className="hidden sm:flex sm:flex-col sm:h-full">
           <div className="sticky top-0 z-10 bg-gradient-to-b from-background via-background to-transparent border-b border-border backdrop-blur-sm px-6 py-4 flex-shrink-0 flex items-center justify-between">
             <h2 className="text-2xl font-semibold bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
               {t('settings.title')}
             </h2>
             <Button
               variant="ghost"
               size="icon"
               onClick={close}
               className="text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px]"
             >
               <X className="w-5 h-5" />
             </Button>
           </div>
          <Tabs defaultValue="account" value={activeTab} onValueChange={handleTabChange} className="w-full flex flex-col flex-1 min-h-0">
            <div className="px-6 pt-6 pb-4 flex-shrink-0">
              <TabsList className="grid w-full grid-cols-8 bg-card p-1">
                <TabsTrigger value="account" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-muted-foreground transition-all duration-200">
                  {t('settings.account')}
                </TabsTrigger>
                <TabsTrigger value="general" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-muted-foreground transition-all duration-200">
                  {t('settings.general')}
                </TabsTrigger>
                <TabsTrigger value="notifications" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-muted-foreground transition-all duration-200">
                  {t('settings.notifications')}
                </TabsTrigger>
                <TabsTrigger value="voice" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-muted-foreground transition-all duration-200">
                  {t('settings.voice')}
                </TabsTrigger>
                <TabsTrigger value="git" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-muted-foreground transition-all duration-200">
                  {t('settings.git')}
                </TabsTrigger>
                <TabsTrigger value="shortcuts" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-muted-foreground transition-all duration-200">
                  {t('settings.keyboard')}
                </TabsTrigger>
                <TabsTrigger value="costrict" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-muted-foreground transition-all duration-200">
                  CoStrict
                </TabsTrigger>
                <TabsTrigger value="providers" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-muted-foreground transition-all duration-200">
                  {t('settings.providers')}
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="px-6 pb-6">
                <TabsContent key="account" value="account" className="mt-0"><AccountSettings /></TabsContent>
                <TabsContent key="general" value="general" className="mt-0"><GeneralSettings /></TabsContent>
                <TabsContent key="notifications" value="notifications" className="mt-0"><NotificationSettings /></TabsContent>
                <TabsContent key="voice" value="voice" className="mt-0"><VoiceSettings /></TabsContent>
                <TabsContent key="git" value="git" className="mt-0"><GitSettings /></TabsContent>
                <TabsContent key="shortcuts" value="shortcuts" className="mt-0"><KeyboardShortcuts /></TabsContent>
                <TabsContent key="costrict" value="costrict" className="mt-0"><ConfigManager /></TabsContent>
                <TabsContent key="providers" value="providers" className="mt-0"><ProviderSettings /></TabsContent>
              </div>
            </div>
          </Tabs>
        </div>

        <div className="sm:hidden flex flex-col h-full min-h-0 pt-safe">
           <div className="flex-shrink-0 bg-gradient-to-b from-background via-background to-transparent border-b border-border backdrop-blur-sm px-4 py-4 flex items-center justify-between">
             <div className="flex items-center gap-2 flex-1">
               {mobileView !== 'menu' && (
                 <Button
                   variant="ghost"
                   size="icon"
                   onClick={() => setMobileView('menu')}
                   className="text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px]"
                 >
                   <ChevronLeft className="w-6 h-6" />
                 </Button>
               )}
               <h2 className="text-xl font-semibold bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
                 {mobileView === 'menu' ? 'Settings' : menuItems.find(item => item.id === mobileView)?.label}
               </h2>
             </div>
             <Button
               variant="ghost"
               size="icon"
               onClick={close}
               className="text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px] flex-shrink-0"
             >
               <X className="w-6 h-6" />
             </Button>
           </div>

           <div className="flex-1 min-h-0 overflow-y-auto p-4 pb-32">
             {mobileView === 'menu' && (
               <div className="space-y-3">
                 {menuItems.map((item) => (
                   <button
                     key={item.id}
                     onClick={() => {
                       setMobileView(item.id as SettingsView)
                       setActiveTab(item.id as SettingsView)
                     }}
                     className="w-full bg-gradient-to-br from-card to-card-hover border border-border rounded-xl p-4 hover:border-border transition-all duration-200 text-left"
                   >
                     <div className="flex items-center gap-4">
                       <div className="p-3 bg-accent rounded-lg">
                         <item.icon className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                       </div>
                       <div className="flex-1 min-w-0">
                         <h3 className="font-semibold text-foreground mb-1">{item.label}</h3>
                         <p className="text-sm text-muted-foreground">{item.description}</p>
                       </div>
                     </div>
                   </button>
                 ))}
               </div>
             )}

             {mobileView === 'account' && <div key="account"><AccountSettings /></div>}
             {mobileView === 'general' && <div key="general"><GeneralSettings /></div>}
             {mobileView === 'notifications' && <div key="notifications"><NotificationSettings /></div>}
             {mobileView === 'voice' && <div key="voice"><VoiceSettings /></div>}
             {mobileView === 'git' && <div key="git"><GitSettings /></div>}
             {mobileView === 'shortcuts' && <div key="shortcuts"><KeyboardShortcuts /></div>}
             {mobileView === 'costrict' && <div key="costrict"><ConfigManager /></div>}
             {mobileView === 'providers' && <div key="providers"><ProviderSettings /></div>}
           </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
