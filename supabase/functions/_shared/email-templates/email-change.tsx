/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import { Button, Heading, Link, Text } from 'npm:@react-email/components@0.0.22'
import { EmailLayout, styles } from './_layout.tsx'

interface EmailChangeEmailProps {
  siteName: string
  oldEmail: string
  email: string
  newEmail: string
  confirmationUrl: string
}

export const EmailChangeEmail = ({
  siteName,
  oldEmail,
  newEmail,
  confirmationUrl,
}: EmailChangeEmailProps) => (
  <EmailLayout preview={`Confirme a troca de e-mail no ${siteName}`}>
    <Heading style={styles.h1}>Confirme a troca de e-mail</Heading>
    <Text style={styles.text}>
      Você pediu para alterar o e-mail da sua conta no {siteName} de{' '}
      <Link href={`mailto:${oldEmail}`} style={styles.link}>{oldEmail}</Link>{' '}
      para{' '}
      <Link href={`mailto:${newEmail}`} style={styles.link}>{newEmail}</Link>.
    </Text>
    <Text style={styles.text}>Clique no botão abaixo para confirmar a troca:</Text>
    <Button style={styles.button} href={confirmationUrl}>
      Confirmar troca de e-mail
    </Button>
    <Text style={styles.hint}>
      Se você não solicitou esta troca, proteja sua conta imediatamente.
    </Text>
  </EmailLayout>
)

export default EmailChangeEmail
