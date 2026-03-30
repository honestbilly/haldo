import nodemailer from 'nodemailer';

interface AlertSummary {
  item_label: string;
  current_value: string;
  threshold_value: string;
  message: string;
  severity: string;
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendAlertEmail(
  alerts: AlertSummary[],
  context: { vessel: string; crewName: string; templateName: string }
): Promise<void> {
  const managerEmail = process.env.MANAGER_EMAIL;
  if (!managerEmail) {
    console.warn('[email] MANAGER_EMAIL not set, skipping alert email');
    return;
  }

  const appName = process.env.APP_NAME || 'Haldo';
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const from = process.env.ALERT_EMAIL_FROM || process.env.SMTP_USER || 'haldo@honesteco.com';

  const vessel = context.vessel.toUpperCase();
  const now = new Date().toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const alertLines = alerts.map(a =>
    `  ⚠ ${a.item_label}: ${a.current_value} (minimum: ${a.threshold_value}) — ${a.message}`
  ).join('\n');

  const subject = `[${appName}] ${vessel} ${context.templateName} — ${alerts.length} item${alerts.length === 1 ? '' : 's'} need attention`;

  const text = `${appName} Alert — ${context.templateName}
${vessel} | ${context.crewName} | ${now}

Items below minimum:
${alertLines}

View full submission: ${appUrl}/report

---
${appName} by Honest Eco`;

  const html = `
<div style="font-family: Inter, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #168E6E; margin-bottom: 4px;">${appName} Alert — ${context.templateName}</h2>
  <p style="color: #666; margin-top: 0;">${vessel} | ${context.crewName} | ${now}</p>
  <div style="background: #FFF5F5; border-left: 4px solid #F36D4F; padding: 16px; border-radius: 8px; margin: 16px 0;">
    <p style="margin: 0 0 8px; font-weight: 600; color: #F36D4F;">Items below minimum:</p>
    ${alerts.map(a => `
    <p style="margin: 4px 0; color: #333;">
      ⚠ <strong>${a.item_label}:</strong> ${a.current_value} (minimum: ${a.threshold_value})<br>
      <span style="color: #666; font-size: 14px;">${a.message}</span>
    </p>`).join('')}
  </div>
  <a href="${appUrl}/report" style="display: inline-block; background: #168E6E; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">View Report</a>
  <p style="color: #999; font-size: 12px; margin-top: 24px;">${appName} by Honest Eco</p>
</div>`;

  await transporter.sendMail({
    from: `"${appName}" <${from}>`,
    to: managerEmail,
    subject,
    text,
    html,
  });

  // Update notified_at for these alerts would happen here in production
  console.log(`[email] Alert sent to ${managerEmail}: ${alerts.length} items`);
}
