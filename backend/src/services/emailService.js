const nodemailer = require('nodemailer');

function cleanSmtpPassword(value) {
    // Gmail app passwords are commonly copied with spaces. SMTP auth expects the compact value.
    return typeof value === 'string' ? value.replace(/\s+/g, '') : value;
}

class EmailService {
    constructor() {
        this.transporter = null;
        this.isConfigured = false;
        this.initializeTransporter();
    }

    initializeTransporter() {
        try {
            const host = process.env.SMTP_HOST;
            const port = parseInt(process.env.SMTP_PORT || '587', 10);
            const secure = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true' || port === 465;
            const user = process.env.SMTP_USER;
            const pass = cleanSmtpPassword(process.env.SMTP_PASS);

            if (!host) {
                console.warn('Email service not configured (SMTP_HOST missing).');
                this.isConfigured = false;
                return;
            }

            this.transporter = nodemailer.createTransport({
                host,
                port,
                secure,
                ...(user && pass ? { auth: { user, pass } } : {})
            });

            this.isConfigured = true;
            console.log('Email service initialized successfully with SMTP');
        } catch (error) {
            console.error('Failed to initialize email service:', error);
            this.isConfigured = false;
        }
    }

    async sendEmail(to, subject, htmlContent, textContent = null) {
        if (!this.isConfigured) {
            console.log('=== EMAIL SERVICE NOT CONFIGURED - DEMO MODE ===');
            console.log('To:', to);
            console.log('Subject:', subject);
            console.log('Content:', htmlContent);
            console.log('===============================================');
            return { success: true, demoMode: true, message: 'Email logged to console (demo mode)' };
        }

        try {
            const mailOptions = {
                from: process.env.SMTP_FROM || process.env.SMTP_USER || 'TaskFlow Pro <noreply@taskflowpro.com>',
                to,
                subject,
                html: htmlContent,
                text: textContent || String(htmlContent || '').replace(/<[^>]*>/g, '')
            };

            const info = await this.transporter.sendMail(mailOptions);
            console.log('Email sent successfully:', info.messageId);
            return { success: true, messageId: info.messageId };
        } catch (error) {
            console.error('Failed to send email:', error);
            return { success: false, error: error.message };
        }
    }

    getVerificationEmailTemplate(userName, verificationLink) {
        return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Verify Your Email - TaskFlow Pro</title></head>
<body style="font-family:Segoe UI,Tahoma,Geneva,Verdana,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px">
    <div style="background:#242220;color:white;padding:20px;text-align:center;border-radius:8px 8px 0 0">
        <div style="font-size:24px;font-weight:bold;margin-bottom:10px">TaskFlow Pro</div>
        <div>AI Task Management Platform</div>
    </div>
    <div style="background:#f8fafc;padding:30px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0">
        <h2>Welcome to TaskFlow Pro, ${userName}!</h2>
        <p>Thank you for signing up. To complete your registration and start using TaskFlow Pro, please verify your email address.</p>
        <p><a href="${verificationLink}" style="display:inline-block;padding:12px 30px;background:#242220;color:white;text-decoration:none;border-radius:5px;margin:20px 0">Verify Email Address</a></p>
        <p>Or copy and paste this link into your browser:</p>
        <p><a href="${verificationLink}">${verificationLink}</a></p>
        <p><strong>Note:</strong> This verification link will expire in 24 hours.</p>
        <p>If you didn't create an account with TaskFlow Pro, you can safely ignore this email.</p>
    </div>
    <div style="text-align:center;margin-top:30px;color:#64748b;font-size:14px">
        <p>&copy; 2024 TaskFlow Pro. All rights reserved.</p>
        <p>This is an automated message, please do not reply to this email.</p>
    </div>
</body>
</html>`;
    }

    getPasswordResetEmailTemplate(userName, resetLink) {
        return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Reset Your Password - TaskFlow Pro</title></head>
<body style="font-family:Segoe UI,Tahoma,Geneva,Verdana,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px">
    <div style="background:#242220;color:white;padding:20px;text-align:center;border-radius:8px 8px 0 0">
        <div style="font-size:24px;font-weight:bold;margin-bottom:10px">TaskFlow Pro</div>
        <div>AI Task Management Platform</div>
    </div>
    <div style="background:#f8fafc;padding:30px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0">
        <h2>Password Reset Request</h2>
        <p>Hi ${userName},</p>
        <p>We received a request to reset your password for your TaskFlow Pro account.</p>
        <p><a href="${resetLink}" style="display:inline-block;padding:12px 30px;background:#242220;color:white;text-decoration:none;border-radius:5px;margin:20px 0;font-weight:bold">Reset Password</a></p>
        <p>Or copy and paste this link into your browser:</p>
        <p><a href="${resetLink}">${resetLink}</a></p>
        <div style="background:#fef3c7;border:1px solid #f59e0b;padding:15px;border-radius:5px;margin:20px 0">
            <p><strong>Security Notice:</strong></p>
            <ul>
                <li>This link will expire in 1 hour for security reasons</li>
                <li>If you didn't request this password reset, please ignore this email</li>
                <li>Never share this link with anyone</li>
            </ul>
        </div>
    </div>
    <div style="text-align:center;margin-top:30px;color:#64748b;font-size:14px">
        <p>&copy; 2024 TaskFlow Pro. All rights reserved.</p>
        <p>This is an automated message, please do not reply to this email.</p>
    </div>
</body>
</html>`;
    }

    getWelcomeEmailTemplate(userName, organizationName) {
        return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Welcome to TaskFlow Pro</title></head>
<body style="font-family:Segoe UI,Tahoma,Geneva,Verdana,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px">
    <div style="background:#242220;color:white;padding:20px;text-align:center;border-radius:8px 8px 0 0">
        <div style="font-size:24px;font-weight:bold;margin-bottom:10px">TaskFlow Pro</div>
        <div>AI Task Management Platform</div>
    </div>
    <div style="background:#f8fafc;padding:30px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0">
        <h2>Welcome to TaskFlow Pro, ${userName}!</h2>
        <p>Your account has been successfully created and you're ready to start managing tasks more efficiently.</p>
        <h3>Organization: ${organizationName}</h3>
        <p>You can create and manage tasks, collaborate with your team, track project progress, and generate reports.</p>
        <p>We're excited to have you on board.</p>
    </div>
    <div style="text-align:center;margin-top:30px;color:#64748b;font-size:14px">
        <p>&copy; 2024 TaskFlow Pro. All rights reserved.</p>
        <p>This is an automated message, please do not reply to this email.</p>
    </div>
</body>
</html>`;
    }

    getEmployeeWelcomeEmailTemplate(employeeName, email, tempPassword, organizationName, loginUrl) {
        return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Welcome to ${organizationName} - Your Account Details</title></head>
<body style="font-family:Segoe UI,Tahoma,Geneva,Verdana,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px">
    <div style="background:#242220;color:white;padding:20px;text-align:center;border-radius:8px 8px 0 0">
        <div style="font-size:24px;font-weight:bold;margin-bottom:10px">TaskFlow Pro</div>
        <div>Welcome to ${organizationName}</div>
    </div>
    <div style="background:#f8fafc;padding:30px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0">
        <h2>Welcome to the Team, ${employeeName}!</h2>
        <p>Your employee account has been created successfully.</p>
        <div style="background:white;border:2px solid #242220;padding:20px;border-radius:8px;margin:20px 0">
            <h3>🔐 Your Login Credentials</h3>
            <p><strong>Username:</strong> ${email}</p>
            <p><strong>Temporary Password:</strong> ${tempPassword}</p>
        </div>
        <p><a href="${loginUrl}" style="display:inline-block;padding:12px 30px;background:#242220;color:white;text-decoration:none;border-radius:5px;margin:20px 0;font-weight:bold">Sign In Now</a></p>
        <div style="background:#dbeafe;border-left:4px solid #3b82f6;padding:15px;border-radius:5px;margin:20px 0">
            <p><strong>Important Security Steps:</strong></p>
            <ol>
                <li>Sign in with your email and temporary password</li>
                <li>Change your password on first login</li>
                <li>Use a strong, unique password</li>
            </ol>
        </div>
        <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:15px;border-radius:5px;margin:20px 0">
            <p><strong>Security Notice:</strong> This temporary password will expire in 24 hours. Never share your password.</p>
        </div>
    </div>
    <div style="text-align:center;margin-top:30px;color:#64748b;font-size:14px">
        <p>&copy; 2024 TaskFlow Pro. All rights reserved.</p>
        <p>This is an automated message, please do not reply to this email.</p>
    </div>
</body>
</html>`;
    }
}

module.exports = EmailService;
