/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({
  siteName,
  confirmationUrl,
}: RecoveryEmailProps) => (
  <Html lang="pt-BR" dir="ltr">
    <Head />
    <Preview>Redefina sua senha no {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brand}>ACELER<span style={brandAccent}>IQ</span></Text>
        <Heading style={h1}>Redefina sua senha</Heading>
        <Text style={text}>
          Recebemos um pedido para redefinir sua senha no {siteName}. Clique no
          botão abaixo para escolher uma nova senha.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Redefinir senha
        </Button>
        <Text style={footer}>
          Se você não solicitou esta redefinição, pode ignorar este e-mail com
          segurança. Sua senha continuará a mesma.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default RecoveryEmail

const main = { backgroundColor: '#ffffff', fontFamily: 'Outfit, -apple-system, Segoe UI, Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px' }
const brand = { fontSize: '14px', fontWeight: 'bold' as const, letterSpacing: '0.18em', color: '#0D0D0D', margin: '0 0 28px' }
const brandAccent = { color: '#00B84A' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#0D0D0D', margin: '0 0 20px' }
const text = { fontSize: '15px', color: '#3a3a3a', lineHeight: '1.6', margin: '0 0 24px' }
const button = {
  backgroundColor: '#00FF66',
  color: '#0D0D0D',
  fontSize: '14px',
  fontWeight: 'bold' as const,
  borderRadius: '12px',
  padding: '14px 24px',
  textDecoration: 'none',
  display: 'inline-block',
}
const footer = { fontSize: '12px', color: '#8a8a8a', margin: '32px 0 0', lineHeight: '1.5' }
