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
const FINANCE_URL = 'https://aceleriq.online/financeiro'

type BillingStatus = 'upcoming' | 'today' | 'overdue'

interface BillingReminderProps {
  name?: string
  company?: string
  planName?: string
  amount?: string
  dueDate?: string
  daysUntil?: number
  daysOverdue?: number
  status?: BillingStatus
}

const STATUS_THEME: Record<
  BillingStatus,
  { accent: string; soft: string; eyebrow: string }
> = {
  upcoming: { accent: '#00B84A', soft: '#0D0D0D', eyebrow: 'LEMBRETE DE VENCIMENTO' },
  today: { accent: '#E8A400', soft: '#0D0D0D', eyebrow: 'VENCE HOJE' },
  overdue: { accent: '#E5484D', soft: '#0D0D0D', eyebrow: 'PAGAMENTO EM ATRASO' },
}

const BillingReminderEmail = ({
  name,
  company,
  planName,
  amount,
  dueDate,
  daysUntil,
  daysOverdue,
  status = 'upcoming',
}: BillingReminderProps) => {
  const firstName = name ? name.split(' ')[0] : null
  const theme = STATUS_THEME[status] ?? STATUS_THEME.upcoming

  const headline =
    status === 'overdue'
      ? 'Sua mensalidade está em aberto'
      : status === 'today'
      ? 'Sua mensalidade vence hoje'
      : 'Sua mensalidade está chegando'

  const lead =
    status === 'overdue'
      ? `Identificamos que a mensalidade${
          daysOverdue ? ` está vencida há ${daysOverdue} dia(s)` : ' está em aberto'
        }. Regularize para manter seus projetos e entregas em pleno andamento.`
      : status === 'today'
      ? 'Hoje é o dia do vencimento da sua mensalidade. Garanta a continuidade dos seus serviços efetuando o pagamento.'
      : `Faltam ${daysUntil ?? 'poucos'} dia(s) para o vencimento da sua mensalidade. Deixamos tudo pronto para você se organizar com antecedência.`

  return (
    <Html lang="pt-BR" dir="ltr">
      <Head>
        <meta name="color-scheme" content="light only" />
        <meta name="supported-color-schemes" content="light only" />
      </Head>
      <Preview>{headline} — AcelerIQ</Preview>
      <Body style={body}>
        <Container style={outer}>
          {/* Header */}
          <Section style={{ ...header, borderBottom: `2px solid ${theme.accent}` }}>
            <Img src={LOGO_URL} alt="AcelerIQ" width="140" style={logo} />
          </Section>

          {/* Card */}
          <Section style={card}>
            <Text style={{ ...eyebrow, color: theme.accent }}>{theme.eyebrow}</Text>
            <Heading style={h1}>
              {firstName ? `Olá, ${firstName}.` : 'Olá!'}
            </Heading>
            <Text style={leadStyle}>
              {company ? <strong>{company}</strong> : null}
              {company ? ' — ' : ''}
              {lead}
            </Text>

            {/* Invoice box */}
            <Section style={invoiceBox}>
              <Text style={invoiceLabel}>Plano</Text>
              <Text style={invoicePlan}>{planName ?? 'Plano de Recorrência'}</Text>

              <Hr style={invoiceDivider} />

              <table style={invoiceTable} cellPadding="0" cellSpacing="0">
                <tbody>
                  <tr>
                    <td style={invoiceCellLabel}>Vencimento</td>
                    <td style={invoiceCellValue}>{dueDate ?? '—'}</td>
                  </tr>
                  <tr>
                    <td style={invoiceCellLabel}>Valor</td>
                    <td style={{ ...invoiceCellAmount, color: theme.accent }}>
                      {amount ?? '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </Section>

            <Section style={ctaWrap}>
              <Button
                style={{ ...button, backgroundColor: theme.accent }}
                href={FINANCE_URL}
              >
                Ver detalhes e pagar
              </Button>
            </Section>

            <Text style={hint}>
              Já realizou o pagamento? Desconsidere este aviso — a compensação
              pode levar até 1 dia útil para ser registrada.
            </Text>

            <Hr style={sectionDivider} />

            <Text style={supportText}>
              Dúvidas sobre sua cobrança? Fale com a gente em{' '}
              <Link href="mailto:contato@aceleriq.com.br" style={supportLink}>
                contato@aceleriq.com.br
              </Link>
              .
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
  component: BillingReminderEmail,
  subject: (data: Record<string, any>) => {
    const status = data?.status as BillingStatus
    const company = data?.company ? ` · ${data.company}` : ''
    if (status === 'overdue') return `Pagamento em aberto — AcelerIQ${company}`
    if (status === 'today') return `Sua mensalidade vence hoje — AcelerIQ${company}`
    return `Lembrete: sua mensalidade está chegando — AcelerIQ${company}`
  },
  displayName: 'Cobrança / Vencimento',
  previewData: {
    name: 'André Weglandala',
    company: 'Stop Informática',
    planName: 'AcelerIQ Performance — Mensal',
    amount: 'R$ 2.500,00',
    dueDate: '15/06/2026',
    daysUntil: 3,
    status: 'upcoming',
  },
} satisfies TemplateEntry

export default BillingReminderEmail

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
const leadStyle = {
  fontSize: '15px',
  color: '#3a3a3a',
  lineHeight: '1.65',
  margin: '0 0 28px',
}
const invoiceBox = {
  backgroundColor: '#0D0D0D',
  borderRadius: '12px',
  padding: '24px 26px',
  margin: '0 0 28px',
}
const invoiceLabel = {
  fontSize: '11px',
  fontWeight: 700 as const,
  letterSpacing: '0.2em',
  color: '#8a8a8a',
  margin: '0 0 6px',
  textTransform: 'uppercase' as const,
}
const invoicePlan = {
  fontSize: '17px',
  fontWeight: 600 as const,
  color: '#ffffff',
  margin: '0',
}
const invoiceDivider = { borderColor: '#262626', margin: '16px 0' }
const invoiceTable = { width: '100%' as const, borderCollapse: 'collapse' as const }
const invoiceCellLabel = {
  fontSize: '11px',
  fontWeight: 700 as const,
  letterSpacing: '0.16em',
  color: '#8a8a8a',
  textTransform: 'uppercase' as const,
  padding: '6px 0',
}
const invoiceCellValue = {
  fontFamily: 'JetBrains Mono, Courier, monospace',
  fontSize: '15px',
  color: '#ffffff',
  textAlign: 'right' as const,
  padding: '6px 0',
}
const invoiceCellAmount = {
  fontFamily: 'JetBrains Mono, Courier, monospace',
  fontSize: '22px',
  fontWeight: 700 as const,
  letterSpacing: '0.02em',
  textAlign: 'right' as const,
  padding: '6px 0',
}
const ctaWrap = { textAlign: 'left' as const, margin: '0 0 16px' }
const button = {
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
const supportText = {
  fontSize: '13px',
  color: '#6b6b6b',
  margin: '0',
  lineHeight: '1.6',
}
const supportLink = { color: '#00B84A', textDecoration: 'none', fontWeight: 600 as const }
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
