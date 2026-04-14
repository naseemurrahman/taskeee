const nodemailer = require('nodemailer');

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
            const secure = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
            const user = process.env.SMTP_USER;
            const pass = process.env.SMTP_PASS;

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
        // Demo mode fallback - log email to console
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
                from: process.env.SMTP_FROM || 'TaskFlow Pro <noreply@taskflowpro.com>',
                to: to,
                subject: subject,
                html: htmlContent,
                text: textContent || htmlContent.replace(/<[^>]*>/g, '') // Strip HTML for text version
            };

            const info = await this.transporter.sendMail(mailOptions);
            console.log('Email sent successfully:', info.messageId);
            return { success: true, messageId: info.messageId };
        } catch (error) {
            console.error('Failed to send email:', error);
            return { success: false, error: error.message };
        }
    }

    // Email templates
    getVerificationEmailTemplate(userName, verificationLink) {
        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verify Your Email - TaskFlow Pro</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
        }
        .header {
            background: #242220;
            color: white;
            padding: 20px;
            text-align: center;
            border-radius: 8px 8px 0 0;
        }
        .content {
            background: #f8fafc;
            padding: 30px;
            border-radius: 0 0 8px 8px;
            border: 1px solid #e2e8f0;
        }
        .logo {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 10px;
        }
        .btn {
            display: inline-block;
            padding: 12px 30px;
            background: #242220;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            margin: 20px 0;
        }
        .footer {
            text-align: center;
            margin-top: 30px;
            color: #64748b;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="logo">TaskFlow Pro</div>
        <div>AI Task Management Platform</div>
    </div>
    
    <div class="content">
        <h2>Welcome to TaskFlow Pro, ${userName}!</h2>
        <p>Thank you for signing up. To complete your registration and start using TaskFlow Pro, please verify your email address.</p>
        
        <p>Click the button below to verify your email:</p>
        
        <a href="${verificationLink}" class="btn">Verify Email Address</a>
        
        <p>Or copy and paste this link into your browser:</p>
        <p><a href="${verificationLink}">${verificationLink}</a></p>
        
        <p><strong>Note:</strong> This verification link will expire in 24 hours.</p>
        
        <p>If you didn't create an account with TaskFlow Pro, you can safely ignore this email.</p>
    </div>
    
    <div class="footer">
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
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Reset Your Password - TaskFlow Pro</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
        }
        .header {
            background: #242220;
            color: white;
            padding: 20px;
            text-align: center;
            border-radius: 8px 8px 0 0;
        }
        .content {
            background: #f8fafc;
            padding: 30px;
            border-radius: 0 0 8px 8px;
            border: 1px solid #e2e8f0;
        }
        .logo {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 10px;
        }
        .btn {
            display: inline-block;
            padding: 12px 30px;
            background: #242220;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            margin: 20px 0;
        }
        .footer {
            text-align: center;
            margin-top: 30px;
            color: #64748b;
            font-size: 14px;
        }
        .warning {
            background: #fef3c7;
            border: 1px solid #f59e0b;
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="logo">TaskFlow Pro</div>
        <div>AI Task Management Platform</div>
    </div>
    
    <div class="content">
        <h2>Password Reset Request</h2>
        <p>Hi ${userName},</p>
        <p>We received a request to reset your password for your TaskFlow Pro account.</p>
        
        <p>Click the button below to reset your password:</p>
        
        <a href="${resetLink}" class="btn">Reset Password</a>
        
        <p>Or copy and paste this link into your browser:</p>
        <p><a href="${resetLink}">${resetLink}</a></p>
        
        <div class="warning">
            <p><strong>Security Notice:</strong></p>
            <ul>
                <li>This link will expire in 1 hour for security reasons</li>
                <li>If you didn't request this password reset, please ignore this email</li>
                <li>Never share this link with anyone</li>
            </ul>
        </div>
        
        <p>If you continue to have problems, please contact our support team.</p>
    </div>
    
    <div class="footer">
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
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to TaskFlow Pro</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
        }
        .header {
            background: #242220;
            color: white;
            padding: 20px;
            text-align: center;
            border-radius: 8px 8px 0 0;
        }
        .content {
            background: #f8fafc;
            padding: 30px;
            border-radius: 0 0 8px 8px;
            border: 1px solid #e2e8f0;
        }
        .logo {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 10px;
        }
        .feature-list {
            background: white;
            padding: 20px;
            border-radius: 5px;
            margin: 20px 0;
        }
        .feature-list ul {
            list-style: none;
            padding: 0;
        }
        .feature-list li {
            padding: 8px 0;
            border-bottom: 1px solid #e2e8f0;
        }
        .feature-list li:last-child {
            border-bottom: none;
        }
        .btn {
            display: inline-block;
            padding: 12px 30px;
            background: #242220;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            margin: 20px 0;
        }
        .footer {
            text-align: center;
            margin-top: 30px;
            color: #64748b;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="logo">TaskFlow Pro</div>
        <div>AI Task Management Platform</div>
    </div>
    
    <div class="content">
        <h2>Welcome to TaskFlow Pro, ${userName}!</h2>
        <p>Your account has been successfully created and you're ready to start managing tasks more efficiently.</p>
        
        <h3>Organization: ${organizationName}</h3>
        
        <div class="feature-list">
            <h4>What you can do now:</h4>
            <ul>
                <li>✓ Create and manage tasks with AI-powered insights</li>
                <li>✓ Collaborate with your team members</li>
                <li>✓ Track project progress and deadlines</li>
                <li>✓ Generate comprehensive reports</li>
                <li>✓ Customize workflows to fit your needs</li>
            </ul>
        </div>
        
        <a href="http://localhost:8080/signin.html" class="btn">Sign In to Your Account</a>
        
        <p>If you have any questions or need help getting started, don't hesitate to reach out to our support team.</p>
        
        <p>We're excited to have you on board!</p>
    </div>
    
    <div class="footer">
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
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to ${organizationName} - Your Account Details</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
        }
        .header {
            background: #242220;
            color: white;
            padding: 20px;
            text-align: center;
            border-radius: 8px 8px 0 0;
        }
        .content {
            background: #f8fafc;
            padding: 30px;
            border-radius: 0 0 8px 8px;
            border: 1px solid #e2e8f0;
        }
        .logo {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 10px;
        }
        .credentials-box {
            background: white;
            border: 2px solid #242220;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
        }
        .credentials-box h3 {
            margin-top: 0;
            color: #242220;
        }
        .credential-item {
            padding: 10px;
            background: #f8fafc;
            margin: 10px 0;
            border-radius: 4px;
            font-family: 'Courier New', monospace;
        }
        .credential-label {
            font-weight: bold;
            color: #64748b;
            font-size: 12px;
            text-transform: uppercase;
        }
        .credential-value {
            font-size: 16px;
            color: #242220;
            margin-top: 5px;
        }
        .btn {
            display: inline-block;
            padding: 12px 30px;
            background: #242220;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            margin: 20px 0;
            font-weight: bold;
        }
        .warning {
            background: #fef3c7;
            border-left: 4px solid #f59e0b;
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
        }
        .security-notice {
            background: #dbeafe;
            border-left: 4px solid #3b82f6;
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
        }
        .footer {
            text-align: center;
            margin-top: 30px;
            color: #64748b;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="logo">TaskFlow Pro</div>
        <div>Welcome to ${organizationName}</div>
    </div>
    
    <div class="content">
        <h2>Welcome to the Team, ${employeeName}!</h2>
        <p>Your employee account has been created successfully. You can now access the TaskFlow Pro system to manage tasks, collaborate with your team, and track your work.</p>
        
        <div class="credentials-box">
            <h3>🔐 Your Login Credentials</h3>
            <div class="credential-item">
                <div class="credential-label">Username (Email)</div>
                <div class="credential-value">${email}</div>
            </div>
            <div class="credential-item">
                <div class="credential-label">Temporary Password</div>
                <div class="credential-value">${tempPassword}</div>
            </div>
        </div>
        
        <a href="${loginUrl}" class="btn">Sign In Now</a>
        
        <div class="security-notice">
            <p><strong>🔒 Important Security Steps:</strong></p>
            <ol>
                <li>Click the "Sign In Now" button above or visit: <a href="${loginUrl}">${loginUrl}</a></li>
                <li>Enter your email and temporary password</li>
                <li><strong>You will be required to change your password on first login</strong></li>
                <li>Choose a strong, unique password that you haven't used elsewhere</li>
            </ol>
        </div>
        
        <div class="warning">
            <p><strong>⚠️ Security Notice:</strong></p>
            <ul>
                <li>This temporary password will expire in 24 hours</li>
                <li>Never share your password with anyone</li>
                <li>If you didn't expect this email, please contact your HR department immediately</li>
            </ul>
        </div>
        
        <h3>Need Help?</h3>
        <p>If you have any questions or need assistance getting started, please contact:</p>
        <ul>
            <li>Your manager or HR department</li>
            <li>IT Support team</li>
        </ul>
        
        <p>We're excited to have you on board!</p>
        
        <p>Best regards,<br>${organizationName} Team</p>
    </div>
    
    <div class="footer">
        <p>&copy; 2024 TaskFlow Pro. All rights reserved.</p>
        <p>This is an automated message, please do not reply to this email.</p>
    </div>
</body>
</html>`;
    }
}

module.exports = EmailService;
