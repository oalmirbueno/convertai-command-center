/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import { Heading, Text } from 'npm:@react-email/components@0.0.22'
import { EmailLayout, styles } from './_layout.tsx'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <EmailLayout preview="Seu código de verificação AcelerIQ">
    <Heading style={styles.h1}>Confirme sua identidade</Heading>
    <Text style={styles.text}>Use o código abaixo para confirmar sua identidade:</Text>
    <Text style={styles.code}>{token}</Text>
    <Text style={styles.hint}>
      Este código expira em alguns minutos. Se você não solicitou, pode ignorar este e-mail com segurança.
    </Text>
  </EmailLayout>
)

export default ReauthenticationEmail
