/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import { Button, Heading, Text } from 'npm:@react-email/components@0.0.22'
import { EmailLayout, styles } from './_layout.tsx'

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({ siteName, confirmationUrl }: MagicLinkEmailProps) => (
  <EmailLayout preview={`Seu link de acesso ao ${siteName}`}>
    <Heading style={styles.h1}>Seu link de acesso</Heading>
    <Text style={styles.text}>
      Clique no botão abaixo para entrar no {siteName}. Este link expira em alguns minutos.
    </Text>
    <Button style={styles.button} href={confirmationUrl}>
      Entrar no Portal
    </Button>
    <Text style={styles.hint}>
      Se você não solicitou este link, pode ignorar este e-mail com segurança.
    </Text>
  </EmailLayout>
)

export default MagicLinkEmail
