/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'

export interface TemplateEntry {
  component: React.ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  to?: string
  displayName?: string
  previewData?: Record<string, any>
}

import { template as clientWelcome } from './client-welcome.tsx'
import { template as billingReminder } from './billing-reminder.tsx'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'client-welcome': clientWelcome,
  'billing-reminder': billingReminder,
}
