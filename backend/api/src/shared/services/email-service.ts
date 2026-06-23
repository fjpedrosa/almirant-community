import { Resend } from "resend";
import nodemailer, { type Transporter } from "nodemailer";
import { env, logger } from "@almirant/config";

let resendClient: Resend | null = null;
let smtpTransporter: Transporter | null = null;

const maskEmail = (email: string): string => {
  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) return "***";
  if (localPart.length <= 2) return `${localPart[0] ?? "*"}***@${domain}`;
  return `${localPart.slice(0, 2)}***@${domain}`;
};

const getResendClient = (): Resend => {
  if (!resendClient) {
    resendClient = new Resend(env.RESEND_API_KEY);
  }
  return resendClient;
};

const getSmtpPort = (): number => {
  return env.SMTP_PORT;
};

const isSmtpConfigured = (): boolean =>
  Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);

const getSmtpTransporter = (): Transporter => {
  if (!smtpTransporter) {
    const port = getSmtpPort();
    const secure = env.SMTP_SECURE === "true" || port === 465;

    smtpTransporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port,
      secure,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    });
  }

  return smtpTransporter;
};

const isResendConfigured = (): boolean => {
  return !!env.RESEND_API_KEY;
};

export const isEmailConfigured = (): boolean =>
  isSmtpConfigured() || isResendConfigured();

/**
 * Get delivery status of an email by its Resend ID.
 * Returns null if Resend is not configured or the email is not found.
 */
export const getResendEmailStatus = async (
  emailId: string
): Promise<"sent" | "delivered" | "bounced" | "complained" | null> => {
  if (!isResendConfigured()) return null;

  try {
    const client = getResendClient();
    const email = await client.emails.get(emailId);
    if (!email.data) return null;

    const last = email.data.last_event;
    if (last === "bounced") return "bounced";
    if (last === "complained") return "complained";
    if (last === "delivered" || last === "opened" || last === "clicked") return "delivered";
    return "sent";
  } catch {
    return null;
  }
};

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

interface SendEmailResult {
  success: boolean;
  error?: string;
  emailId?: string;
}

export const sendEmail = async ({
  to,
  subject,
  html,
  from: fromOverride,
}: SendEmailParams): Promise<SendEmailResult> => {
  const from = fromOverride ?? env.EMAIL_FROM;
  const recipient = maskEmail(to);
  let smtpError: string | null = null;

  if (isSmtpConfigured()) {
    try {
      const transporter = getSmtpTransporter();
      await transporter.sendMail({ from, to, subject, html });
      logger.info({ recipient, provider: "smtp" }, "[email-service] Email sent successfully");
      return { success: true };
    } catch (err) {
      smtpError = err instanceof Error ? err.message : "Unknown SMTP error";
      logger.warn(
        { recipient, provider: "smtp", error: smtpError },
        "[email-service] SMTP send failed, trying Resend"
      );
    }
  }

  if (isResendConfigured()) {
    try {
      const client = getResendClient();
      const { data, error } = await client.emails.send({
        from,
        to,
        subject,
        html,
      });

      if (error) {
        logger.error({ recipient, provider: "resend", error }, "[email-service] Resend API returned an error");
        return { success: false, error: error.message };
      }

      logger.info({ recipient, provider: "resend", emailId: data?.id }, "[email-service] Email sent successfully");
      return { success: true, emailId: data?.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error sending email";
      logger.error({ recipient, provider: "resend", error: message }, "[email-service] Failed to send with Resend");
      return { success: false, error: message };
    }
  }

  if (env.NODE_ENV === "production") {
    const message = smtpError
      ? `SMTP failed (${smtpError}) and RESEND_API_KEY is not configured`
      : "No email provider configured (SMTP or RESEND_API_KEY)";
    logger.error(
      { recipient, provider: "none", error: message },
      "[email-service] Email provider unavailable in production"
    );
    return { success: false, error: message };
  }

  logger.info(
    { recipient, provider: "none", htmlLength: html.length },
    "[email-service] Mock mode: no SMTP/RESEND config. Email logged instead of sent."
  );
  return { success: true };
};
