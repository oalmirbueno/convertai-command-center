/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import { Button, Heading, Link, Text } from 'npm:@react-email/components@0.0.22'
import { EmailLayout, styles } from './_layout.tsx'

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({
  siteName,
  siteUrl,
  recipient,
  confirmationUrl,
}: SignupEmailProps) => (
  <EmailLayout preview={`Confirme seu e-mail no ${siteName}`}>
    <Heading style={styles.h1}>Confirme seu e-mail</Heading>
    <Text style={styles.text}>
      Obrigado por entrar no{' '}
      <Link href={siteUrl} style={styles.link}>
        <strong>{siteName}</strong>
      </Link>
      . Para ativar seu acesso, confirme o e-mail{' '}
      <Link href={`mailto:${recipient}`} style={styles.link}>
        {recipient}
      </Link>{' '}
      clicando no botão abaixo.
    </Text>
    <Button style={styles.button} href={confirmationUrl}>
      Confirmar e-mail
    </Button>
    <Text style={styles.hint}>
      Se você não criou esta conta, pode ignorar este e-mail com segurança.
    </Text>
  </EmailLayout>
)

export default SignupEmail
