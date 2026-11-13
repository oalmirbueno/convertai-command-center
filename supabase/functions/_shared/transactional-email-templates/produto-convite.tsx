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
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
import { EMAIL_LOGO_URL } from '../email-config.ts'

/**
 * Convite para a pessoa entrar na empresa dentro do CRM e E-mail da Aceleriq.
 * Um botão só: o link já cria o acesso de quem é novo, ou entra direto para
 * quem já tem login.
 */
interface ProdutoConviteProps {
  name?: string
  company?: string
  invitedBy?: string
  admin?: boolean
  link?: string
}

const ProdutoConviteEmail = ({ name, company, invitedBy, admin, link }: ProdutoConviteProps) => {
  const primeiroNome = name ? name.split(' ')[0] : null
  const empresa = company || 'sua empresa'
  return (
    <Html lang="pt-BR" dir="ltr">
      <Head />
      <Preview>{`Seu acesso ao CRM da ${empresa} está pronto.`}</Preview>
      <Body style={{ backgroundColor: '#0D0D0D', fontFamily: 'Helvetica, Arial, sans-serif', margin: 0, padding: '24px 0' }}>
        <Container style={{ backgroundColor: '#161616', borderRadius: 12, maxWidth: 520, margin: '0 auto', padding: '28px 28px 24px' }}>
          <Img src={EMAIL_LOGO_URL} alt="AcelerIQ" width="132" style={{ display: 'block', marginBottom: 20 }} />
          <Heading as="h1" style={{ color: '#FFFFFF', fontSize: 20, lineHeight: '28px', margin: '0 0 14px' }}>
            {primeiroNome ? `${primeiroNome}, seu acesso está pronto` : 'Seu acesso está pronto'}
          </Heading>
          <Text style={{ color: '#E6E6E6', fontSize: 15, lineHeight: '24px', margin: '0 0 8px' }}>
            {invitedBy ? `${invitedBy} colocou você` : 'Você foi colocado'} na equipe da {empresa} no CRM da Aceleriq
            {admin ? ', como administrador da conta.' : '.'}
          </Text>
          <Text style={{ color: '#E6E6E6', fontSize: 15, lineHeight: '24px', margin: '0 0 20px' }}>
            Toque no botão para entrar. Na primeira vez você escolhe a sua senha.
          </Text>
          <Section style={{ margin: '8px 0 22px' }}>
            <Button href={link} style={{ backgroundColor: '#00B84A', color: '#0D0D0D', borderRadius: 8, fontSize: 14, fontWeight: 700, padding: '12px 20px', textDecoration: 'none' }}>
              Entrar no CRM
            </Button>
          </Section>
          <Hr style={{ borderColor: '#2A2A2A', margin: '0 0 14px' }} />
          <Text style={{ color: '#6E6E6E', fontSize: 11, lineHeight: '17px', margin: 0 }}>
            O link é pessoal e vale por pouco tempo. Se ele expirar, peça para reenviarem o convite. Se você não esperava este e-mail, pode ignorar.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template: TemplateEntry = {
  component: ProdutoConviteEmail,
  subject: (data: Record<string, any>) => `Seu acesso ao CRM${data?.company ? ` da ${String(data.company).slice(0, 60)}` : ''}`,
  displayName: 'Convite para o CRM e E-mail',
  previewData: {
    name: 'Priscila Souza',
    company: 'Imobiliária Exemplo',
    invitedBy: 'Almir Bueno',
    admin: true,
    link: 'https://aceleriq.online/app',
  },
}
