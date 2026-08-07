export function resolveWebhookBase(value?: string): string | null {
  const configured = value?.trim();
  if (!configured) return null;

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error('VITE_WEBHOOK_URL precisa ser uma URL absoluta válida.');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('VITE_WEBHOOK_URL precisa usar http ou https.');
  }
  const loopback = url.hostname === 'localhost'
    || url.hostname === '127.0.0.1'
    || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !loopback) {
    throw new Error('VITE_WEBHOOK_URL precisa usar https fora do ambiente local.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      'VITE_WEBHOOK_URL não pode conter credenciais, query string ou fragmento.',
    );
  }

  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString().replace(/\/$/, '');
}

export const WEBHOOK_BASE = resolveWebhookBase(import.meta.env.VITE_WEBHOOK_URL);

export const webhooks = {
  onboardClient: WEBHOOK_BASE ? `${WEBHOOK_BASE}/onboard-client` : null,
  processDiagnostic: WEBHOOK_BASE ? `${WEBHOOK_BASE}/process-diagnostic` : null,
  meetingToPlan: WEBHOOK_BASE ? `${WEBHOOK_BASE}/meeting-to-plan` : null,
  creativeApproval: WEBHOOK_BASE ? `${WEBHOOK_BASE}/creative-approval` : null,
  clientRequest: WEBHOOK_BASE ? `${WEBHOOK_BASE}/client-request-v2` : null,
  adsRecharge: WEBHOOK_BASE ? `${WEBHOOK_BASE}/ads-recharge` : null,
};

let missingConfigurationWarningEmitted = false;

export const fireWebhook = async (
  url: string | null,
  payload: unknown,
): Promise<boolean> => {
  if (!url) {
    if (!missingConfigurationWarningEmitted) {
      missingConfigurationWarningEmitted = true;
      console.warn('Webhook externo desativado: configure VITE_WEBHOOK_URL.');
    }
    return false;
  }

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return true;
  } catch (err) {
    console.error('Webhook error:', err);
    return false;
  }
};
