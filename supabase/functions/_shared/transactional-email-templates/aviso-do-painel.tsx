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

/**
 * O aviso do sino, por e-mail, para quem decide na casa.
 *
 * Nasceu do caso Verzelo: a cliente aprovou, o painel gravou o aviso no sino
 * e ninguem viu. Este e-mail e curto de proposito: o que aconteceu, quando,
 * e um botao que abre o lugar certo do painel.
 */
interface AvisoDoPainelProps {
  name?: string
  message?: string
  kind?: string
  link?: string
  when?: string
}

const ROTULO: Record<string, string> = {
  approval: 'Decisão de cliente',
  request: 'Pedido de cliente',
  aprovacao_necessaria: 'Aprovação necessária',
  central_review_pendente: 'Revisão do Ciclo esperando você',
  central_review_decidida: 'Revisão do Ciclo decidida',
  central_review_enviada: 'Mensagem enviada ao cliente',
  responsavel_designado: 'Responsável designado',
}

const AvisoDoPainelEmail = ({ name, message, kind, link, when }: AvisoDoPainelProps) => {
  const firstName = name ? name.split(' ')[0] : null
  const rotulo = ROTULO[kind ?? ''] ?? 'Aviso do painel'
  const destino = link || EMAIL_APP_URL
  return (
    <Html lang="pt-BR" dir="ltr">
      <Head />
      <Preview>{message ? message.slice(0, 120) : rotulo}</Preview>
      <Body style={{ backgroundColor: '#0D0D0D', fontFamily: 'Helvetica, Arial, sans-serif', margin: 0, padding: '24px 0' }}>
        <Container style={{ backgroundColor: '#161616', borderRadius: 12, maxWidth: 520, margin: '0 auto', padding: '28px 28px 24px' }}>
          <Img src={EMAIL_LOGO_URL} alt="AcelerIQ" width="132" style={{ display: 'block', marginBottom: 20 }} />
          <Text style={{ color: '#00B84A', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', margin: '0 0 6px', fontWeight: 700 }}>
            {rotulo}
          </Text>
          <Heading as="h1" style={{ color: '#FFFFFF', fontSize: 20, lineHeight: '28px', margin: '0 0 14px' }}>
            {firstName ? `${firstName}, tem uma decisão esperando você` : 'Tem uma decisão esperando você'}
          </Heading>
          <Text style={{ color: '#E6E6E6', fontSize: 15, lineHeight: '24px', margin: '0 0 8px' }}>{message}</Text>
          {when && (
            <Text style={{ color: '#8A8A8A', fontSize: 12, margin: '0 0 20px' }}>Registrado no painel em {when}.</Text>
          )}
          <Section style={{ margin: '8px 0 22px' }}>
            <Button href={destino} style={{ backgroundColor: '#00B84A', color: '#0D0D0D', borderRadius: 8, fontSize: 14, fontWeight: 700, padding: '12px 20px', textDecoration: 'none' }}>
              Abrir no painel
            </Button>
          </Section>
          <Hr style={{ borderColor: '#2A2A2A', margin: '0 0 14px' }} />
          <Text style={{ color: '#6E6E6E', fontSize: 11, lineHeight: '17px', margin: 0 }}>
            Você recebe este e-mail porque é administrador do painel AcelerIQ. O mesmo aviso está no sino em{' '}
            <Link href={EMAIL_APP_URL} style={{ color: '#00B84A' }}>{EMAIL_APP_URL.replace(/^https?:\/\//, '')}</Link>.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template: TemplateEntry = {
  component: AvisoDoPainelEmail,
  subject: (data: Record<string, any>) => {
    const rotulo = ROTULO[String(data?.kind ?? '')] ?? 'Aviso do painel'
    const resumo = typeof data?.message === 'string' ? data.message.slice(0, 70) : ''
    return resumo ? `${rotulo}: ${resumo}` : rotulo
  },
  displayName: 'Aviso do painel para a equipe',
  previewData: {
    name: 'Almir Bueno',
    kind: 'approval',
    message: 'Aprovação recebida: Verzelo - Jardins e Poda de árvores aprovou "Seu Espaço Externo precisa de Cuidado.png". Pronto para agendar na Agenda.',
    link: 'https://aceleriq.online/calendario',
    when: '16/09/2026 18:07',
  },
}
