/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <Html lang="pt-BR" dir="ltr">
    <Head />
    <Preview>Seu código de verificação AcelerIQ</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brand}>ACELER<span style={brandAccent}>IQ</span></Text>
        <Heading style={h1}>Confirme sua identidade</Heading>
        <Text style={text}>Use o código abaixo para confirmar sua identidade:</Text>
        <Text style={codeStyle}>{token}</Text>
        <Text style={footer}>
          Este código expira em alguns minutos. Se você não solicitou, pode
          ignorar este e-mail com segurança.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default ReauthenticationEmail

const main = { backgroundColor: '#ffffff', fontFamily: 'Outfit, -apple-system, Segoe UI, Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px' }
const brand = { fontSize: '14px', fontWeight: 'bold' as const, letterSpacing: '0.18em', color: '#0D0D0D', margin: '0 0 28px' }
const brandAccent = { color: '#00B84A' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#0D0D0D', margin: '0 0 20px' }
const text = { fontSize: '15px', color: '#3a3a3a', lineHeight: '1.6', margin: '0 0 24px' }
const codeStyle = {
  fontFamily: 'JetBrains Mono, Courier, monospace',
  fontSize: '28px',
  fontWeight: 'bold' as const,
  letterSpacing: '0.3em',
  color: '#0D0D0D',
  backgroundColor: '#F4F4F4',
  padding: '16px 20px',
  borderRadius: '12px',
  display: 'inline-block',
  margin: '0 0 30px',
}
const footer = { fontSize: '12px', color: '#8a8a8a', margin: '32px 0 0', lineHeight: '1.5' }
