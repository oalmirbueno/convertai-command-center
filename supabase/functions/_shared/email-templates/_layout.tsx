/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'

const LOGO_URL =
  'https://gicbrgagstyvbaaumprj.supabase.co/storage/v1/object/public/email-assets/logo-aceleriq.png'

interface EmailLayoutProps {
  preview: string
  children: React.ReactNode
}

export const EmailLayout = ({ preview, children }: EmailLayoutProps) => (
  <Html lang="pt-BR" dir="ltr">
    <Head>
      <meta name="color-scheme" content="light only" />
      <meta name="supported-color-schemes" content="light only" />
    </Head>
    <Preview>{preview}</Preview>
    <Body style={body}>
      <Container style={outer}>
        {/* Header */}
        <Section style={header}>
          <Img
            src={LOGO_URL}
            alt="AcelerIQ"
            width="140"
            style={logo}
          />
        </Section>

        {/* Card */}
        <Section style={card}>{children}</Section>

        {/* Footer */}
        <Section style={footerSection}>
          <Hr style={hr} />
          <Text style={footerBrand}>
            ACELER<span style={footerAccent}>IQ</span>
          </Text>
          <Text style={footerText}>
            Performance OS para times que entregam.
          </Text>
          <Text style={footerMeta}>
            <Link href="https://aceleriq.online" style={footerLink}>
              aceleriq.online
            </Link>
            {' · '}
            <Link href="mailto:contato@aceleriq.com.br" style={footerLink}>
              contato@aceleriq.com.br
            </Link>
          </Text>
          <Text style={footerLegal}>
            © {new Date().getFullYear()} AcelerIQ. Todos os direitos reservados.
          </Text>
        </Section>
      </Container>
    </Body>
  </Html>
)

// Shared styles used by templates
export const styles = {
  h1: {
    fontSize: '26px',
    fontWeight: 700 as const,
    color: '#0D0D0D',
    margin: '0 0 18px',
    lineHeight: '1.25',
    letterSpacing: '-0.01em',
  },
  text: {
    fontSize: '15px',
    color: '#3a3a3a',
    lineHeight: '1.65',
    margin: '0 0 22px',
  },
  link: { color: '#0D0D0D', textDecoration: 'underline' },
  button: {
    backgroundColor: '#0D0D0D',
    color: '#00FF66',
    fontSize: '14px',
    fontWeight: 700 as const,
    borderRadius: '10px',
    padding: '14px 28px',
    textDecoration: 'none',
    display: 'inline-block',
    letterSpacing: '0.02em',
  },
  hint: {
    fontSize: '13px',
    color: '#8a8a8a',
    margin: '28px 0 0',
    lineHeight: '1.6',
  },
  code: {
    fontFamily: 'JetBrains Mono, Courier, monospace',
    fontSize: '28px',
    fontWeight: 700 as const,
    letterSpacing: '0.3em',
    color: '#0D0D0D',
    backgroundColor: '#F4F4F4',
    padding: '18px 22px',
    borderRadius: '10px',
    display: 'inline-block',
    margin: '0 0 24px',
  },
}

// Layout styles
const body = {
  backgroundColor: '#F4F4F4',
  fontFamily:
    'Outfit, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
  margin: 0,
  padding: '32px 16px',
}
const outer = { maxWidth: '600px', margin: '0 auto' }
const header = {
  padding: '8px 4px 20px',
  textAlign: 'left' as const,
}
const logo = { display: 'block', height: 'auto' }
const card = {
  backgroundColor: '#ffffff',
  borderRadius: '16px',
  padding: '40px 36px',
  border: '1px solid #ECECEC',
  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
}
const footerSection = { padding: '24px 8px 8px', textAlign: 'left' as const }
const hr = { borderColor: '#E5E5E5', margin: '0 0 20px' }
const footerBrand = {
  fontSize: '12px',
  fontWeight: 700 as const,
  letterSpacing: '0.22em',
  color: '#0D0D0D',
  margin: '0 0 6px',
}
const footerAccent = { color: '#00B84A' }
const footerText = {
  fontSize: '12px',
  color: '#6b6b6b',
  margin: '0 0 10px',
  lineHeight: '1.5',
}
const footerMeta = { fontSize: '12px', color: '#6b6b6b', margin: '0 0 8px' }
const footerLink = { color: '#0D0D0D', textDecoration: 'none' }
const footerLegal = { fontSize: '11px', color: '#9a9a9a', margin: '8px 0 0' }
