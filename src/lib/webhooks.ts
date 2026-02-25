const WEBHOOK_BASE = import.meta.env.VITE_WEBHOOK_URL || 'https://n8n.srv1353465.hstgr.cloud/webhook';

export const webhooks = {
  onboardClient:     `${WEBHOOK_BASE}/onboard-client`,
  processDiagnostic: `${WEBHOOK_BASE}/process-diagnostic`,
  meetingToPlan:     `${WEBHOOK_BASE}/meeting-to-plan`,
  creativeApproval:  `${WEBHOOK_BASE}/creative-approval`,
  clientRequest:     `${WEBHOOK_BASE}/client-request`,
  adsRecharge:       `${WEBHOOK_BASE}/ads-recharge`,
};

export const fireWebhook = async (url: string, payload: any) => {
  if (!WEBHOOK_BASE) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('Webhook error:', err);
  }
};
