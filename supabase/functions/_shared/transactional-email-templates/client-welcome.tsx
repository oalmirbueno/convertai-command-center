/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const LOGO_URL =
  'https://gicbrgagstyvbaaumprj.supabase.co/storage/v1/object/public/email-assets/logo-aceleriq.png'
const PORTAL_URL = 'https://aceleriq.online'

interface ClientWelcomeProps {
  name?: string
  email?: string
  password?: string
  company?: string
  firstAccessUrl?: string
}

const ClientWelcomeEmail = ({
  name,
  email,
  password,
  company,
  firstAccessUrl,
}: ClientWelcomeProps) => {
  const firstName = name ? name.split(' ')[0] : 'seja muito bem-vindo'
  return (
    <Html lang="pt-BR" dir="ltr">
      <Head>
        <meta name="color-scheme" content="light only" />
        <meta name="supported-color-schemes" content="light only" />
      </Head>
      <Preview>
        Bem-vindo à AcelerIQ — suas credenciais de acesso ao portal
      </Preview>
      <Body style={body}>
        <Container style={outer}>
          {/* Header */}
          <Section style={header}>
            <Img src={LOGO_URL} alt="AcelerIQ" width="140" style={logo} />
          </Section>

          {/* Card */}
          <Section style={card}>
            <Text style={eyebrow}>BEM-VINDO À ACELERIQ</Text>
            <Heading style={h1}>
              {name ? `Olá, ${firstName}.` : 'Olá!'}
            </Heading>
            <Text style={lead}>
              Seu acesso ao <strong>Portal AcelerIQ</strong> está pronto.
              {company ? ` A partir de agora, ${company} acompanha entregas, projetos, aprovações e métricas em um só lugar.` : ' A partir de agora, você acompanha entregas, projetos, aprovações e métricas em um só lugar.'}
            </Text>

            {firstAccessUrl ? (
              <>
                <Section style={credBox}>
                  <Text style={credLabel}>E-mail de acesso</Text>
                  <Text style={credValue}>{email ?? '—'}</Text>
                  <Hr style={credDivider} />
                  <Text style={credLabel}>Primeiro acesso</Text>
                  <Text style={firstAccessNote}>
                    Clique no botão abaixo para criar a sua própria senha de acesso.
                  </Text>
                </Section>

                <Section style={ctaWrap}>
                  <Button style={button} href={firstAccessUrl}>
                    Criar minha senha
                  </Button>
                </Section>

                <Text style={hint}>
                  Você escolhe uma senha pessoal e já entra no portal. O link é de uso
                  único — guarde sua senha em local seguro.
                </Text>
              </>
            ) : (
              <>
                <Section style={credBox}>
                  <Text style={credLabel}>E-mail de acesso</Text>
                  <Text style={credValue}>{email ?? '—'}</Text>
                  <Hr style={credDivider} />
                  <Text style={credLabel}>Senha temporária</Text>
                  <Text style={credPassword}>{password ?? '—'}</Text>
                </Section>

                <Section style={ctaWrap}>
                  <Button style={button} href={PORTAL_URL}>
                    Acessar o portal
                  </Button>
                </Section>

                <Text style={hint}>
                  Por segurança, recomendamos alterar a senha no primeiro acesso em{' '}
                  <strong>Perfil → Segurança</strong>.
                </Text>
              </>
            )}

            <Hr style={sectionDivider} />

            <Text style={nextTitle}>O que você encontra no portal</Text>
            <Text style={bullet}>
              <span style={dot}>●</span> Kanban e timeline dos seus projetos
            </Text>
            <Text style={bullet}>
              <span style={dot}>●</span> Aprovações de entregas e arquivos
            </Text>
            <Text style={bullet}>
              <span style={dot}>●</span> Relatórios de performance e métricas
            </Text>
            <Text style={bullet}>
              <span style={dot}>●</span> Solicitações e canal direto com o time
            </Text>
          </Section>

          {/* Footer */}
          <Section style={footerSection}>
            <Hr style={footerHr} />
            <Text style={footerBrand}>
              ACELER<span style={footerAccent}>IQ</span>
            </Text>
            <Text style={footerText}>Performance OS para times que entregam.</Text>
            <Text style={footerMeta}>
              <Link href={PORTAL_URL} style={footerLink}>
                aceleriq.online
              </Link>
              {' · '}
              <Link href="mailto:contato@aceleriq.com.br" style={footerLink}>
                contato@aceleriq.com.br
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: ClientWelcomeEmail,
  subject: (data: Record<string, any>) =>
    data?.name
      ? `Bem-vindo à AcelerIQ, ${String(data.name).split(' ')[0]} — seu acesso está pronto`
      : 'Bem-vindo à AcelerIQ — seu acesso está pronto',
  displayName: 'Boas-vindas ao cliente',
  previewData: {
    name: 'André Weglandala',
    company: 'Stop Informática',
    email: 'andre@stopinformatica.com.br',
    firstAccessUrl: 'https://aceleriq.online/primeiro-acesso?token=exemplo',
  },
} satisfies TemplateEntry

export default ClientWelcomeEmail

// Styles
const body = {
  backgroundColor: '#ffffff',
  fontFamily:
    'Outfit, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
  margin: 0,
  padding: '32px 16px',
}
const outer = { maxWidth: '600px', margin: '0 auto' }
const header = {
  backgroundColor: '#0D0D0D',
  padding: '28px 32px',
  borderRadius: '16px 16px 0 0',
  borderBottom: '2px solid #00FF66',
}
const logo = { display: 'block', height: 'auto' }
const card = {
  backgroundColor: '#ffffff',
  borderRadius: '0 0 16px 16px',
  padding: '40px 36px',
  border: '1px solid #ECECEC',
  borderTop: 'none',
}
const eyebrow = {
  fontSize: '11px',
  fontWeight: 700 as const,
  letterSpacing: '0.22em',
  color: '#00B84A',
  margin: '0 0 12px',
}
const h1 = {
  fontSize: '28px',
  fontWeight: 700 as const,
  color: '#0D0D0D',
  margin: '0 0 16px',
  letterSpacing: '-0.01em',
  lineHeight: '1.2',
}
const lead = {
  fontSize: '15px',
  color: '#3a3a3a',
  lineHeight: '1.65',
  margin: '0 0 28px',
}
const credBox = {
  backgroundColor: '#0D0D0D',
  borderRadius: '12px',
  padding: '24px 26px',
  margin: '0 0 28px',
}
const credLabel = {
  fontSize: '11px',
  fontWeight: 700 as const,
  letterSpacing: '0.2em',
  color: '#8a8a8a',
  margin: '0 0 6px',
  textTransform: 'uppercase' as const,
}
const credValue = {
  fontFamily: 'JetBrains Mono, Courier, monospace',
  fontSize: '15px',
  color: '#ffffff',
  margin: '0 0 4px',
  wordBreak: 'break-all' as const,
}
const credDivider = { borderColor: '#262626', margin: '16px 0' }
const firstAccessNote = {
  fontSize: '14px',
  color: '#cfcfcf',
  margin: '0',
  lineHeight: '1.5',
}
const credPassword = {
  fontFamily: 'JetBrains Mono, Courier, monospace',
  fontSize: '20px',
  fontWeight: 700 as const,
  letterSpacing: '0.08em',
  color: '#00FF66',
  margin: '0',
  wordBreak: 'break-all' as const,
}
const ctaWrap = { textAlign: 'left' as const, margin: '0 0 16px' }
const button = {
  backgroundColor: '#00FF66',
  color: '#0D0D0D',
  fontSize: '14px',
  fontWeight: 700 as const,
  borderRadius: '10px',
  padding: '14px 28px',
  textDecoration: 'none',
  display: 'inline-block',
  letterSpacing: '0.02em',
}
const hint = {
  fontSize: '13px',
  color: '#6b6b6b',
  margin: '4px 0 0',
  lineHeight: '1.6',
}
const sectionDivider = { borderColor: '#ECECEC', margin: '32px 0 24px' }
const nextTitle = {
  fontSize: '13px',
  fontWeight: 700 as const,
  color: '#0D0D0D',
  letterSpacing: '0.04em',
  textTransform: 'uppercase' as const,
  margin: '0 0 14px',
}
const bullet = {
  fontSize: '14px',
  color: '#3a3a3a',
  margin: '0 0 8px',
  lineHeight: '1.5',
}
const dot = { color: '#00B84A', marginRight: '8px' }
const footerSection = { padding: '24px 8px 8px', textAlign: 'left' as const }
const footerHr = { borderColor: '#E5E5E5', margin: '0 0 20px' }
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
