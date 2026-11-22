import type * as React from 'npm:react@18.3.1'
import { template as otpCode } from './otp-code.tsx'

export interface TemplateEntry {
  component: React.ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  displayName?: string
  previewData?: Record<string, any>
  to?: string
}

/** Every app email the project can send, by template name. */
export const TEMPLATES: Record<string, TemplateEntry> = {
  'otp-code': otpCode,
}
