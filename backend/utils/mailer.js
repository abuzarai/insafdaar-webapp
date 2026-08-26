import nodemailer from "nodemailer";

const SMTP_PORT = Number(process.env.SMTP_PORT || 587);

export const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465, // auto: 465=true, 587=false
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  // ✅ helps when SMTP servers require TLS upgrade
  tls: {
    rejectUnauthorized: false,
  },
});

export async function sendOtpEmail(email, otp) {
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: "Insafdaar Email Verification OTP",
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif; background:#f6f8fb; padding:24px;">
        <div style="max-width:640px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; border-radius:12px; overflow:hidden;">
          <div style="padding:18px 22px; background:#0b2a6f;">
            <div style="font-size:14px; font-weight:700; color:#ffffff; letter-spacing:0.3px;">
              Insafdaar
            </div>
          </div>

          <div style="padding:22px;">
            <h2 style="margin:0 0 12px; font-size:20px; color:#111827; font-weight:700;">
              Email Verification OTP
            </h2>

            <div style="font-size:14px; color:#374151; line-height:1.65;">
              <p style="margin:0 0 12px;">Use the OTP below to verify your email address:</p>

              <div style="display:inline-block; padding:10px 14px; border:1px solid #e5e7eb; border-radius:10px; background:#f9fafb; font-size:18px; font-weight:800; letter-spacing:2px; color:#111827;">
                ${otp}
              </div>

              <p style="margin:12px 0 0; font-size:12px; color:#6b7280;">
                This code expires in 10 minutes. If you didn’t request this, you can ignore this email.
              </p>
            </div>

            <div style="margin-top:18px; font-size:13px; color:#111827;">
              Regards,<br/>
              <b>Team Insafdaar</b>
            </div>
          </div>

          <div style="padding:14px 22px; background:#f9fafb; border-top:1px solid #e5e7eb; font-size:12px; color:#6b7280;">
            © ${new Date().getFullYear()} Insafdaar. All rights reserved.
          </div>
        </div>
      </div>
    `,
  });
}

export async function sendNotificationEmail({ to, subject, title, message }) {
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject,
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif; background:#f6f8fb; padding:24px;">
        <div style="max-width:640px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; border-radius:12px; overflow:hidden;">

          <div style="padding:18px 22px; background:#0b2a6f;">
            <div style="font-size:14px; font-weight:700; color:#ffffff; letter-spacing:0.3px;">
              Insafdaar
            </div>
          </div>

          <div style="padding:22px;">
            <h2 style="margin:0 0 12px; font-size:20px; color:#111827; font-weight:700;">
              ${title || subject}
            </h2>

            <div style="font-size:14px; color:#374151; line-height:1.65;">
              ${message || ""}
            </div>

            <div style="margin-top:18px; font-size:12px; color:#6b7280;">
              If you have any questions, reply to this email or contact our support team.
            </div>

            <div style="margin-top:18px; font-size:13px; color:#111827;">
              Regards,<br/>
              <b>Team Insafdaar</b>
            </div>
          </div>

          <div style="padding:14px 22px; background:#f9fafb; border-top:1px solid #e5e7eb; font-size:12px; color:#6b7280;">
            © ${new Date().getFullYear()} Insafdaar. All rights reserved.
          </div>

        </div>
      </div>
    `,
  });
}

export async function sendContractSigningOtpEmail({ to, otp, caseId, versionNo }) {
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: `Insafdaar Contract Signing OTP (Case #${caseId})`,
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif; background:#f6f8fb; padding:24px;">
        <div style="max-width:640px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; border-radius:12px; overflow:hidden;">
          <div style="padding:18px 22px; background:#0b2a6f; color:#ffffff; font-weight:700;">Insafdaar</div>
          <div style="padding:22px; color:#374151; line-height:1.6; font-size:14px;">
            <h2 style="margin:0 0 12px; color:#111827; font-size:20px;">Contract Signature Verification</h2>
            <p style="margin:0 0 10px;">Use this OTP to continue signing the contract.</p>
            <p style="margin:0 0 10px;"><b>Case:</b> #${caseId} &nbsp; <b>Version:</b> v${versionNo}</p>
            <div style="display:inline-block; padding:10px 14px; border:1px solid #e5e7eb; border-radius:10px; background:#f9fafb; font-size:18px; font-weight:800; letter-spacing:2px; color:#111827;">
              ${otp}
            </div>
            <p style="margin:12px 0 0; font-size:12px; color:#6b7280;">
              This code expires in ${Number(process.env.CONTRACT_OTP_TTL_MINUTES || 10)} minutes.
            </p>
          </div>
        </div>
      </div>
    `,
  });
}
