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
 * Conteúdo esperando a aprovação do cliente.
 *
 * Até 24/09/2026 o cliente só descobria que tinha post para aprovar quando
 * abria o painel: o e-mail de aviso ia só para a equipe. Este e-mail vai ao
 * cliente, agrupado (um por vez, com todos os pendentes), e vira lembrete
 * quando o conteúdo passa de dois dias sem decisão. Enviado pelo cron
 * aprovacao_email_tick (banco), nunca pela tela.
 */
interface AprovacaoPendenteProps {
  name?: string
  total?: number
  itens?: string[]
  lembrete?: boolean
  dias?: number
  link?: string
}

const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios)

const AprovacaoPendenteEmail = ({ name, total = 1, itens = [], lembrete = false, dias = 0, link }: AprovacaoPendenteProps) => {
  const firstName = name ? name.split(' ')[0] : null
  const destino = link || `${EMAIL_APP_URL}/aprovacoes`
  const qtd = `${total} ${plural(total, 'conteúdo', 'conteúdos')}`
  const titulo = lembrete
    ? `${firstName ? `${firstName}, ` : ''}${qtd} ${plural(total, 'ainda espera', 'ainda esperam')} sua aprovação`
    : `${firstName ? `${firstName}, ` : ''}${plural(total, 'chegou conteúdo novo', 'chegaram conteúdos novos')} para você aprovar`
  const lista = itens.slice(0, 8)
  return (
    <Html lang="pt-BR" dir="ltr">
      <Head />
      <Preview>{lembrete ? `${qtd} esperando sua aprovação` : `${qtd} para aprovar no painel`}</Preview>
      <Body style={{ backgroundColor: '#0D0D0D', fontFamily: 'Helvetica, Arial, sans-serif', margin: 0, padding: '24px 0' }}>
        <Container style={{ backgroundColor: '#161616', borderRadius: 12, maxWidth: 520, margin: '0 auto', padding: '28px 28px 24px' }}>
          <Img src={EMAIL_LOGO_URL} alt="AcelerIQ" width="132" style={{ display: 'block', marginBottom: 20 }} />
          <Text style={{ color: '#00B84A', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', margin: '0 0 6px', fontWeight: 700 }}>
            {lembrete ? 'Lembrete de aprovação' : 'Aprovação pendente'}
          </Text>
          <Heading as="h1" style={{ color: '#FFFFFF', fontSize: 20, lineHeight: '28px', margin: '0 0 14px' }}>
            {titulo}
          </Heading>
          <Text style={{ color: '#E6E6E6', fontSize: 15, lineHeight: '24px', margin: '0 0 10px' }}>
            {lembrete && dias > 0
              ? `Há ${dias} ${plural(dias, 'dia', 'dias')} ${plural(total, 'este conteúdo espera', 'estes conteúdos esperam')} a sua decisão. Aprovar leva um clique, e o pedido de ajuste também é pelo painel.`
              : 'Veja cada arte no painel e aprove ou peça ajuste. Assim que você aprova, a publicação segue para a agenda.'}
          </Text>
          {lista.length > 0 && (
            <Section style={{ margin: '4px 0 14px' }}>
              {lista.map((t, i) => (
                <Text key={i} style={{ color: '#BDBDBD', fontSize: 13, lineHeight: '20px', margin: '0 0 4px' }}>
                  {'• '}{t}
                </Text>
              ))}
              {total > lista.length && (
                <Text style={{ color: '#8A8A8A', fontSize: 12, margin: '4px 0 0' }}>
                  e mais {total - lista.length} no painel.
                </Text>
              )}
            </Section>
          )}
          <Section style={{ margin: '8px 0 22px' }}>
            <Button href={destino} style={{ backgroundColor: '#00B84A', color: '#0D0D0D', borderRadius: 8, fontSize: 14, fontWeight: 700, padding: '12px 20px', textDecoration: 'none' }}>
              Ver e aprovar
            </Button>
          </Section>
          <Hr style={{ borderColor: '#2A2A2A', margin: '0 0 14px' }} />
          <Text style={{ color: '#6E6E6E', fontSize: 11, lineHeight: '17px', margin: 0 }}>
            Você recebe este e-mail porque a AcelerIQ cuida das suas redes. Os conteúdos ficam em{' '}
            <Link href={destino} style={{ color: '#00B84A' }}>{EMAIL_APP_URL.replace(/^https?:\/\//, '')}/aprovacoes</Link>.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template: TemplateEntry = {
  component: AprovacaoPendenteEmail,
  subject: (data: Record<string, any>) => {
    const total = Number(data?.total) || 1
    const qtd = `${total} ${total === 1 ? 'conteúdo' : 'conteúdos'}`
    return data?.lembrete ? `Lembrete: ${qtd} esperando sua aprovação` : `${qtd} para aprovar no painel AcelerIQ`
  },
  displayName: 'Aprovação pendente para o cliente',
  previewData: {
    name: 'Thiélo',
    total: 3,
    itens: ['Carrossel | Primavera não é sair cortando tudo', 'Post estático: Avaliação gratuita', 'Carrossel: 5 sinais de que a árvore precisa de poda'],
    lembrete: false,
    dias: 0,
    link: 'https://aceleriq.online/aprovacoes',
  },
}
