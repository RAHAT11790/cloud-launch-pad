import * as React from 'npm:react@18.3.1'
import { Body, Container, Head, Heading, Html, Preview, Section, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

// Sign-up verification / password-reset code, requested by the recipient on the site.
// Code-only on purpose: no buttons, images or web addresses in the message body.
const BRAND = 'RS ANIME03'

interface Props {
  code?: string
  purpose?: 'register' | 'reset'
  name?: string
  otpMinutes?: number
}

const copy = (purpose?: string) =>
  purpose === 'reset'
    ? { title: 'Reset your password', label: 'Password reset code', intro: `Use this code to reset the password of your ${BRAND} account.` }
    : { title: 'Verify your email', label: 'Verification code', intro: `Use this code to verify your email and finish creating your ${BRAND} account.` }

const mins = (n: number) => `${n} minute${n === 1 ? '' : 's'}`

const OtpCodeEmail = ({ code = '000000', purpose = 'register', name, otpMinutes = 5 }: Props) => {
  const c = copy(purpose)
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{`Your ${c.label.toLowerCase()} is ${code}. It expires in ${mins(otpMinutes)}.`}</Preview>
      <Body style={main}>
        <Container style={card}>
          <Section style={header}>
            <Text style={brand}>
              RS ANIME<span style={gold}>03</span>
            </Text>
            <Text style={tagline}>Account Security &amp; Verification</Text>
          </Section>
          <Section style={inner}>
            <Heading style={h1}>{c.title}</Heading>
            <Text style={p}>{name ? `Hi ${name},` : 'Hi there,'}</Text>
            <Text style={p}>{c.intro}</Text>
            <Text style={label}>{c.label}</Text>
            <Section style={slab}>
              <Text style={codeText}>{code}</Text>
            </Section>
            <Text style={hint}>Press and hold the code to copy it.</Text>
            <Text style={expiry}>
              This code expires in <b>{mins(otpMinutes)}</b>.
            </Text>
            <Text style={note}>
              Never share this code with anyone. {BRAND} will never ask for it. If you didn't request it, you can ignore this email.
            </Text>
          </Section>
        </Container>
        <Text style={footer}>This is an automated message from {BRAND}. Please don't reply.</Text>
      </Body>
    </Html>
  )
}

export const template = {
  component: OtpCodeEmail,
  // "<kind> code: 123456" in the subject lets Gmail show its own "Copy code" chip.
  subject: (d: Record<string, any>) =>
    d?.purpose === 'reset'
      ? `Your ${BRAND} password reset code: ${d?.code ?? ''}`
      : `Your ${BRAND} verification code: ${d?.code ?? ''}`,
  displayName: 'Verification / reset code',
  previewData: { code: '482913', purpose: 'register', name: 'Rahat', otpMinutes: 5 },
} satisfies TemplateEntry

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif"
const MONO = "'SF Mono',SFMono-Regular,Menlo,Consolas,'Roboto Mono','Courier New',monospace"
const main = { backgroundColor: '#ffffff', fontFamily: FONT, margin: 0, padding: '24px 10px' }
const card = {
  maxWidth: '520px', margin: '0 auto', backgroundColor: '#0B1120', borderRadius: '20px',
  border: '1px solid #1C2740', borderBottom: '4px solid #020617', overflow: 'hidden',
}
const header = {
  backgroundColor: '#2563EB', backgroundImage: 'linear-gradient(160deg,#38BDF8 0%,#2563EB 55%,#1E3A8A 100%)',
  borderBottom: '3px solid #1E3A8A', padding: '26px 20px 22px', textAlign: 'center' as const,
}
const brand = {
  margin: 0, color: '#F8FAFC', fontSize: '24px', fontWeight: 800, letterSpacing: '5px',
  textShadow: '0 1px 0 #1D4ED8,0 2px 0 #1E40AF,0 3px 0 #1E3A8A,0 6px 12px rgba(2,6,23,.5)',
}
const gold = { color: '#F5C451' }
const tagline = { margin: '6px 0 0', color: '#E0F2FE', fontSize: '12px', letterSpacing: '2px', textTransform: 'uppercase' as const }
const inner = { padding: '28px 26px 26px' }
const h1 = { margin: '0 0 14px', color: '#F8FAFC', fontSize: '24px', lineHeight: '30px', fontWeight: 800 }
const p = { margin: '0 0 10px', color: '#B6C2D9', fontSize: '15px', lineHeight: '22px' }
const label = { margin: '18px 0 8px', color: '#38BDF8', fontSize: '12px', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase' as const }
const slab = {
  backgroundColor: '#0F172A', backgroundImage: 'linear-gradient(160deg,#1E293B 0%,#020617 100%)',
  borderRadius: '16px', borderTop: '1px solid #64748B', borderBottom: '4px solid #020617', padding: '6px 8px',
}
const codeText = {
  margin: 0, textAlign: 'center' as const, color: '#F8FAFC', fontFamily: MONO, fontSize: '40px', fontWeight: 800,
  letterSpacing: '10px', lineHeight: '64px', userSelect: 'all' as const,
  textShadow: '0 1px 0 #BAE6FD,0 2px 0 #7DD3FC,0 3px 0 #38BDF8,0 4px 0 #0EA5E9,0 8px 16px rgba(14,165,233,.45)',
}
const hint = { margin: '10px 0 0', color: '#8392AD', fontSize: '12px', textAlign: 'center' as const }
const expiry = { margin: '18px 0 0', color: '#F5C451', fontSize: '14px', textAlign: 'center' as const }
const note = { margin: '20px 0 0', paddingTop: '16px', borderTop: '1px solid #1C2740', color: '#8392AD', fontSize: '13px', lineHeight: '20px' }
const footer = { margin: '16px auto 0', maxWidth: '520px', color: '#5E6B85', fontSize: '12px', textAlign: 'center' as const }
