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
import { EMAIL_APP_URL, EMAIL_LOGO_URL } from '../email-config.ts'

const PORTAL_URL = EMAIL_APP_URL

interface MigrationNoticeProps {
  name?: string
  email?: string
  company?: string
}

const MigrationNoticeEmail = ({ name, email, company }: MigrationNoticeProps) => {
  const firstName = name ? name.split(' ')[0] : null
  return (
    <Html lang="pt-BR" dir="ltr">
      <Head>
        <meta name="color-scheme" content="light only" />
        <meta name="supported-color-schemes" content="light only" />
      </Head>
      <Preview>
        Atualizamos o Portal AcelerIQ. Seu acesso continua o mesmo, basta entrar de novo.
      </Preview>
      <Body style={body}>
        <Container style={outer}>
          {/* Header */}
          <Section style={header}>
            <Img src={EMAIL_LOGO_URL} alt="AcelerIQ" width="140" style={logo} />
          </Section>

          {/* Card */}
          <Section style={card}>
            <Text style={eyebrow}>ATUALIZACAO DO PORTAL</Text>
            <Heading style={h1}>
              {firstName ? `Olá, ${firstName}.` : 'Olá!'}
            </Heading>
            <Text style={lead}>
              Passamos o Portal AcelerIQ para uma infraestrutura própria e mais robusta.
              {company
                ? ` Para ${company}, isso significa mais velocidade, mais estabilidade e uma camada extra de segurança dos seus dados.`
                : ' Isso traz mais velocidade, mais estabilidade e uma camada extra de segurança dos seus dados.'}
            </Text>

            <Section style={credBox}>
              <Text style={credLabel}>O que muda para você</Text>
              <Text style={credValue}>Nada nos seus dados.</Text>
              <Hr style={credDivider} />
              <Text style={firstAccessNote}>
                Seus projetos, arquivos, aprovações e métricas continuam exatamente onde estavam.
                Só pedimos que você entre no portal de novo, com o mesmo e-mail e a mesma senha de sempre.
              </Text>
            </Section>

            <Section style={ctaWrap}>
              <Button style={button} href={PORTAL_URL}>
                Entrar no portal
              </Button>
            </Section>

            <Text style={hint}>
              Se você entrar e o portal pedir a senha de novo, é esperado.
              Se a tela parecer desatualizada, atualize a página (no celular, puxe de cima para baixo para recarregar) e entre novamente.
              {email ? ` Seu e-mail de acesso é ${email}.` : ''} Caso não lembre a senha,
              use a opção "Esqueci minha senha" na tela de entrada.
            </Text>

            <Hr style={sectionDivider} />

            <Text style={nextTitle}>Por que fizemos isso</Text>
            <Text style={bullet}>
              <span style={dot}>●</span> Mais segurança e controle dos seus dados
            </Text>
            <Text style={bullet}>
              <span style={dot}>●</span> Portal mais rápido no dia a dia
            </Text>
            <Text style={bullet}>
              <span style={dot}>●</span> Base mais estável para as próximas novidades
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
                {new URL(PORTAL_URL).hostname}
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
  component: MigrationNoticeEmail,
  subject: (data: Record<string, any>) =>
    data?.name
      ? `${String(data.name).split(' ')[0]}, atualizamos o Portal AcelerIQ`
      : 'Atualizamos o Portal AcelerIQ',
  displayName: 'Aviso de migração',
  previewData: {
    name: 'André Weglandala',
    company: 'Stop Informática',
    email: 'andre@stopinformatica.com.br',
  },
} satisfies TemplateEntry

export default MigrationNoticeEmail

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
  fontSize: '16px',
  fontWeight: 700 as const,
  color: '#00FF66',
  margin: '0 0 4px',
}
const credDivider = { borderColor: '#262626', margin: '16px 0' }
const firstAccessNote = {
  fontSize: '14px',
  color: '#cfcfcf',
  margin: '0',
  lineHeight: '1.5',
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
