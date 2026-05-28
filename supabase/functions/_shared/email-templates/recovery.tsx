/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import { Button, Heading, Text } from 'npm:@react-email/components@0.0.22'
import { EmailLayout, styles } from './_layout.tsx'

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({ siteName, confirmationUrl }: RecoveryEmailProps) => (
  <EmailLayout preview={`Redefina sua senha no ${siteName}`}>
    <Heading style={styles.h1}>Redefina sua senha</Heading>
    <Text style={styles.text}>
      Recebemos um pedido para redefinir sua senha no {siteName}. Clique no botão
      abaixo para escolher uma nova senha.
    </Text>
    <Button style={styles.button} href={confirmationUrl}>
      Redefinir senha
    </Button>
    <Text style={styles.hint}>
      Se você não solicitou esta redefinição, pode ignorar este e-mail com segurança.
      Sua senha continuará a mesma.
    </Text>
  </EmailLayout>
)

export default RecoveryEmail
