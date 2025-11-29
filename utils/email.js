const nodemailer = require("nodemailer");

// Create reusable transporter
const createTransporter = () => {
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587, // Works best on Render
    secure: false, // MUST be false for port 587
    auth: {
      user: process.env.EMAIL_USER || "stickrhive@gmail.com",
      pass: process.env.EMAIL_PASSWORD, // your App Password
    },
    tls: {
      rejectUnauthorized: false, // prevents SSL issues on Render
    },
  });
};

// Send password reset email
const sendPasswordResetEmail = async (email, resetToken, userName) => {
  try {
    const transporter = createTransporter();

    // Frontend reset URL - adjust this to match your frontend route
    const resetUrl = `${
      process.env.CLIENT_URL || "https://stickrhive-academy.vercel.app"
    }/reset/password?token=${resetToken}`;

    const mailOptions = {
      from: {
        name: "Stickrhive Academy",
        address: process.env.EMAIL_USER || "stickrhive@gmail.com",
      },
      to: email,
      subject: "Password Reset Request - Stickrhive Academy",
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
            }
            .container {
              background-color: #f9f9f9;
              border-radius: 10px;
              padding: 30px;
              box-shadow: 0 2px 5px rgba(0,0,0,0.1);
            }
            .header {
              text-align: center;
              margin-bottom: 30px;
            }
            .header h1 {
              color: #2c3e50;
              margin: 0;
              font-size: 28px;
            }
            .content {
              background-color: white;
              padding: 25px;
              border-radius: 8px;
              margin-bottom: 20px;
            }
            .button {
              display: inline-block;
              padding: 14px 30px;
              background-color: #3498db;
              color: white;
              text-decoration: none;
              border-radius: 5px;
              font-weight: bold;
              margin: 20px 0;
              text-align: center;
            }
            .button:hover {
              background-color: #2980b9;
            }
            .link-container {
              background-color: #f8f9fa;
              padding: 15px;
              border-radius: 5px;
              margin: 20px 0;
              word-break: break-all;
            }
            .link-text {
              color: #555;
              font-size: 12px;
              margin-bottom: 8px;
            }
            .link-url {
              color: #3498db;
              font-size: 13px;
            }
            .warning {
              background-color: #fff3cd;
              border-left: 4px solid #ffc107;
              padding: 12px;
              margin: 20px 0;
              border-radius: 4px;
            }
            .footer {
              text-align: center;
              color: #777;
              font-size: 12px;
              margin-top: 30px;
              padding-top: 20px;
              border-top: 1px solid #ddd;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Password Reset Request</h1>
            </div>
            
            <div class="content">
              <p>Hello ${userName || "there"},</p>
              
              <p>We received a request to reset your password for your Stickrhive Academy account. If you didn't make this request, you can safely ignore this email.</p>
              
              <p>To reset your password, click the button below:</p>
              
              <div style="text-align: center;">
                <a href="${resetUrl}" class="button">Reset Your Password</a>
              </div>
              
              <div class="link-container">
                <div class="link-text">Or copy and paste this link into your browser:</div>
                <div class="link-url">${resetUrl}</div>
              </div>
              
              <div class="warning">
                <strong>Important:</strong> This password reset link will expire in <strong>1 hour</strong> for security reasons.
              </div>
              
              <p>If you're having trouble with the button above, copy and paste the URL into your web browser.</p>
              
              <p>For security reasons, never share this link with anyone.</p>
              
              <p>Best regards,<br>
              <strong>Stickrhive Academy Team</strong></p>
            </div>
            
            <div class="footer">
              <p>This is an automated message, please do not reply to this email.</p>
              <p>&copy; ${new Date().getFullYear()} Stickrhive Academy. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
Password Reset Request - Stickrhive Academy

Hello ${userName || "there"},

We received a request to reset your password for your Stickrhive Academy account. If you didn't make this request, you can safely ignore this email.

To reset your password, please visit the following link:
${resetUrl}

This link will expire in 1 hour for security reasons.

If you're having trouble with the link above, copy and paste it into your web browser.

For security reasons, never share this link with anyone.

Best regards,
Stickrhive Academy Team

---
This is an automated message, please do not reply to this email.
© ${new Date().getFullYear()} Stickrhive Academy. All rights reserved.
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("Password reset email sent:", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("Error sending password reset email:", error);
    throw new Error("Failed to send password reset email");
  }
};

module.exports = {
  sendPasswordResetEmail,
};
