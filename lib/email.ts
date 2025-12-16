/**
 * Email Service Module
 * Handles sending emails for password reset and other notifications
 * Supports multiple providers with a clean abstraction layer
 */

/**
 * Email provider types
 * - console: Development mode, logs to console instead of sending
 * - sendgrid: SendGrid API integration (requires SENDGRID_API_KEY)
 */
export type EmailProvider = 'console' | 'sendgrid';

/**
 * Email configuration interface
 */
export interface EmailConfig {
  provider: EmailProvider;
  fromEmail: string;
  fromName?: string;
  appName: string;
  baseUrl: string;
}

/**
 * Email template data for password reset
 */
export interface PasswordResetEmailData {
  toEmail: string;
  resetToken: string;
  userId: string;
  expiresInHours?: number;
}

/**
 * Result of email sending operation
 */
export interface EmailResult {
  success: boolean;
  error?: string;
  messageId?: string;
}

/**
 * Get email configuration from environment variables
 */
function getEmailConfig(): EmailConfig {
  const provider = (process.env.EMAIL_PROVIDER || 'console') as EmailProvider;
  const fromEmail = process.env.EMAIL_FROM || 'noreply@splice.app';
  const fromName = process.env.EMAIL_FROM_NAME || 'Splice';
  const appName = process.env.APP_NAME || 'Splice';
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.BASE_URL || 'http://localhost:3000';

  return {
    provider,
    fromEmail,
    fromName,
    appName,
    baseUrl,
  };
}

/**
 * Generate password reset email HTML content
 */
function generatePasswordResetEmailHTML(config: EmailConfig, data: PasswordResetEmailData): string {
  const resetUrl = `${config.baseUrl}/reset-password?token=${data.resetToken}`;
  const expiresIn = data.expiresInHours || 1;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Reset - ${config.appName}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 600px; max-width: 100%; border-collapse: collapse; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px 40px; text-align: center;">
              <h1 style="margin: 0; font-size: 28px; font-weight: 600; color: #1a1a1a;">
                ${config.appName}
              </h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 20px 40px;">
              <h2 style="margin: 0 0 20px 0; font-size: 24px; font-weight: 600; color: #1a1a1a;">
                Reset Your Password
              </h2>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 24px; color: #4a4a4a;">
                We received a request to reset your password. Click the button below to create a new password:
              </p>

              <!-- CTA Button -->
              <table role="presentation" style="margin: 30px 0;">
                <tr>
                  <td style="border-radius: 6px; background-color: #0066ff;">
                    <a href="${resetUrl}" target="_blank" style="display: inline-block; padding: 14px 32px; font-size: 16px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 6px;">
                      Reset Password
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 20px 0; font-size: 14px; line-height: 20px; color: #6a6a6a;">
                Or copy and paste this link into your browser:
              </p>
              <p style="margin: 0 0 20px 0; padding: 12px; font-size: 14px; line-height: 20px; color: #0066ff; background-color: #f5f5f5; border-radius: 4px; word-break: break-all;">
                ${resetUrl}
              </p>

              <p style="margin: 20px 0 0 0; font-size: 14px; line-height: 20px; color: #6a6a6a;">
                This link will expire in <strong>${expiresIn} hour${expiresIn !== 1 ? 's' : ''}</strong>.
              </p>
            </td>
          </tr>

          <!-- Security Notice -->
          <tr>
            <td style="padding: 20px 40px; background-color: #fff5e6; border-radius: 0 0 8px 8px;">
              <p style="margin: 0; font-size: 14px; line-height: 20px; color: #8a6d3b;">
                <strong>Security Notice:</strong> If you didn't request this password reset, you can safely ignore this email. Your password will not be changed.
              </p>
            </td>
          </tr>
        </table>

        <!-- Footer -->
        <table role="presentation" style="width: 600px; max-width: 100%; margin-top: 20px;">
          <tr>
            <td style="padding: 20px; text-align: center; font-size: 12px; color: #8a8a8a;">
              <p style="margin: 0 0 10px 0;">
                This is an automated message from ${config.appName}. Please do not reply to this email.
              </p>
              <p style="margin: 0;">
                &copy; ${new Date().getFullYear()} ${config.appName}. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Generate password reset email plain text content (fallback)
 */
function generatePasswordResetEmailText(config: EmailConfig, data: PasswordResetEmailData): string {
  const resetUrl = `${config.baseUrl}/reset-password?token=${data.resetToken}`;
  const expiresIn = data.expiresInHours || 1;

  return `
${config.appName} - Reset Your Password

We received a request to reset your password.

To reset your password, click the link below or copy and paste it into your browser:

${resetUrl}

This link will expire in ${expiresIn} hour${expiresIn !== 1 ? 's' : ''}.

Security Notice:
If you didn't request this password reset, you can safely ignore this email. Your password will not be changed.

---
This is an automated message from ${config.appName}. Please do not reply to this email.
© ${new Date().getFullYear()} ${config.appName}. All rights reserved.
  `.trim();
}

/**
 * Send email using console provider (development)
 */
async function sendEmailConsole(
  config: EmailConfig,
  data: PasswordResetEmailData
): Promise<EmailResult> {
  const resetUrl = `${config.baseUrl}/reset-password?token=${data.resetToken}`;

  console.log('========================================');
  console.log('EMAIL SERVICE (CONSOLE MODE)');
  console.log('========================================');
  console.log('From:', `${config.fromName} <${config.fromEmail}>`);
  console.log('To:', data.toEmail);
  console.log('Subject: Reset Your Password');
  console.log('----------------------------------------');
  console.log('Password reset requested for user:', data.userId);
  console.log('Reset URL:', resetUrl);
  console.log('Token:', data.resetToken);
  console.log('Expires in:', data.expiresInHours || 1, 'hour(s)');
  console.log('========================================');

  return {
    success: true,
    messageId: `console-${Date.now()}-${data.userId}`,
  };
}

/**
 * Send email using SendGrid provider
 */
async function sendEmailSendGrid(
  config: EmailConfig,
  data: PasswordResetEmailData
): Promise<EmailResult> {
  const apiKey = process.env.SENDGRID_API_KEY;

  if (!apiKey) {
    console.error('SendGrid API key not configured');
    return {
      success: false,
      error: 'SendGrid API key not configured',
    };
  }

  try {
    const htmlContent = generatePasswordResetEmailHTML(config, data);
    const textContent = generatePasswordResetEmailText(config, data);

    // SendGrid API v3 request
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email: data.toEmail }],
            subject: `Reset Your Password - ${config.appName}`,
          },
        ],
        from: {
          email: config.fromEmail,
          name: config.fromName || config.appName,
        },
        content: [
          {
            type: 'text/plain',
            value: textContent,
          },
          {
            type: 'text/html',
            value: htmlContent,
          },
        ],
        categories: ['password-reset'],
        tracking_settings: {
          click_tracking: { enable: false },
          open_tracking: { enable: false },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('SendGrid API error:', response.status, errorText);
      return {
        success: false,
        error: `SendGrid API error: ${response.status}`,
      };
    }

    // SendGrid returns 202 Accepted with X-Message-Id header
    const messageId = response.headers.get('X-Message-Id') || `sg-${Date.now()}`;

    console.log('Password reset email sent via SendGrid:', {
      to: data.toEmail,
      messageId,
    });

    return {
      success: true,
      messageId,
    };
  } catch (error) {
    console.error('SendGrid email error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown SendGrid error',
    };
  }
}

/**
 * Send password reset email
 * Main entry point for sending password reset emails
 *
 * @param toEmail - Recipient email address
 * @param resetToken - Password reset token
 * @param userId - User ID for logging purposes
 * @param expiresInHours - Token expiry time in hours (default: 1)
 * @returns EmailResult indicating success or failure
 */
export async function sendPasswordResetEmail(
  toEmail: string,
  resetToken: string,
  userId: string,
  expiresInHours = 1
): Promise<EmailResult> {
  const config = getEmailConfig();
  const data: PasswordResetEmailData = {
    toEmail,
    resetToken,
    userId,
    expiresInHours,
  };

  try {
    switch (config.provider) {
      case 'sendgrid':
        return await sendEmailSendGrid(config, data);

      case 'console':
      default:
        return await sendEmailConsole(config, data);
    }
  } catch (error) {
    console.error('Email service error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown email service error',
    };
  }
}

/**
 * Validate email service configuration
 * Useful for health checks and startup validation
 */
export function validateEmailConfig(): { valid: boolean; errors: string[] } {
  const config = getEmailConfig();
  const errors: string[] = [];

  if (!config.fromEmail) {
    errors.push('EMAIL_FROM environment variable not set');
  }

  if (!config.baseUrl) {
    errors.push('BASE_URL or VERCEL_URL environment variable not set');
  }

  if (config.provider === 'sendgrid' && !process.env.SENDGRID_API_KEY) {
    errors.push('SENDGRID_API_KEY required when EMAIL_PROVIDER is "sendgrid"');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
