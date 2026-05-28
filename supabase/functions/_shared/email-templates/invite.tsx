/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import { Button, Heading, Link, Text } from 'npm:@react-email/components@0.0.22'
import { EmailLayout, styles } from './_layout.tsx'

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({ siteName, siteUrl, confirmationUrl }: InviteEmailProps) => (
  <EmailLayout preview={`Você foi convidado para o ${siteName}`}>
    <Heading style={styles.h1}>Você foi convidado</Heading>
    <Text style={styles.text}>
      Você foi convidado para acessar o{' '}
      <Link href={siteUrl} style={styles.link}>
        <strong>{siteName}</strong>
      </Link>
      . Clique no botão abaixo para aceitar o convite e ativar sua conta.
    </Text>
    <Button style={styles.button} href={confirmationUrl}>
      Aceitar convite
    </Button>
    <Text style={styles.hint}>
      Se você não esperava este convite, pode ignorar este e-mail com segurança.
    </Text>
  </EmailLayout>
)

export default InviteEmail
