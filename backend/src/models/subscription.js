// Database Models for Payment System - AuthKit Style
const { DataTypes } = require('sequelize');
const { pool } = require('../utils/db');

// Create sequelize instance from pool
const { Sequelize } = require('sequelize');
const sequelize = new Sequelize({
  dialect: 'postgres',
  logging: false
});

// Import User model (assuming it's defined elsewhere)
const User = require('./user')(sequelize, DataTypes);

// Customer Model
const Customer = sequelize.define('Customer', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    stripeCustomerId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        }
    },
    organizationId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'organizations',
            key: 'id'
        }
    },
    email: {
        type: DataTypes.STRING,
        allowNull: false
    },
    name: {
        type: DataTypes.STRING,
        allowNull: true
    },
    phone: {
        type: DataTypes.STRING,
        allowNull: true
    },
    address: {
        type: DataTypes.JSON,
        allowNull: true
    },
    metadata: {
        type: DataTypes.JSON,
        allowNull: true
    },
    createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    }
});

// Subscription Model
const Subscription = sequelize.define('Subscription', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    stripeSubscriptionId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    customerId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'customers',
            key: 'id'
        }
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        }
    },
    organizationId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'organizations',
            key: 'id'
        }
    },
    planId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    status: {
        type: DataTypes.ENUM('trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused'),
        allowNull: false,
        defaultValue: 'trialing'
    },
    currentPeriodStart: {
        type: DataTypes.DATE,
        allowNull: false
    },
    currentPeriodEnd: {
        type: DataTypes.DATE,
        allowNull: false
    },
    trialStart: {
        type: DataTypes.DATE,
        allowNull: true
    },
    trialEnd: {
        type: DataTypes.DATE,
        allowNull: true
    },
    cancelAtPeriodEnd: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    canceledAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    endedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    quantity: {
        type: DataTypes.INTEGER,
        defaultValue: 1
    },
    metadata: {
        type: DataTypes.JSON,
        allowNull: true
    },
    createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    }
});

// Invoice Model
const Invoice = sequelize.define('Invoice', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    stripeInvoiceId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    customerId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'customers',
            key: 'id'
        }
    },
    subscriptionId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'subscriptions',
            key: 'id'
        }
    },
    number: {
        type: DataTypes.STRING,
        allowNull: false
    },
    status: {
        type: DataTypes.ENUM('draft', 'open', 'paid', 'void', 'uncollectible'),
        allowNull: false,
        defaultValue: 'draft'
    },
    amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false
    },
    currency: {
        type: DataTypes.STRING(3),
        allowNull: false,
        defaultValue: 'usd'
    },
    dueDate: {
        type: DataTypes.DATE,
        allowNull: true
    },
    paidAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    hostedInvoiceUrl: {
        type: DataTypes.STRING,
        allowNull: true
    },
    invoicePdf: {
        type: DataTypes.STRING,
        allowNull: true
    },
    metadata: {
        type: DataTypes.JSON,
        allowNull: true
    },
    createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    }
});

// Payment Method Model
const PaymentMethod = sequelize.define('PaymentMethod', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    stripePaymentMethodId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    customerId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'customers',
            key: 'id'
        }
    },
    type: {
        type: DataTypes.ENUM('card', 'bank_account'),
        allowNull: false
    },
    brand: {
        type: DataTypes.STRING,
        allowNull: true
    },
    last4: {
        type: DataTypes.STRING,
        allowNull: true
    },
    expMonth: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    expYear: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    fingerprint: {
        type: DataTypes.STRING,
        allowNull: true
    },
    isDefault: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    metadata: {
        type: DataTypes.JSON,
        allowNull: true
    },
    createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    }
});

// Usage Metrics Model
const UsageMetrics = sequelize.define('UsageMetrics', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    organizationId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'organizations',
            key: 'id'
        }
    },
    period: {
        type: DataTypes.ENUM('daily', 'weekly', 'monthly'),
        allowNull: false,
        defaultValue: 'monthly'
    },
    date: {
        type: DataTypes.DATE,
        allowNull: false
    },
    users: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    },
    storage: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0
    },
    apiCalls: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    },
    projects: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    },
    bandwidth: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0
    },
    tasks: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    },
    reports: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    },
    metadata: {
        type: DataTypes.JSON,
        allowNull: true
    },
    createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    }
});

// Billing Event Model (for audit trail)
const BillingEvent = sequelize.define('BillingEvent', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    eventType: {
        type: DataTypes.ENUM(
            'subscription_created',
            'subscription_updated',
            'subscription_canceled',
            'subscription_paused',
            'subscription_resumed',
            'invoice_created',
            'invoice_paid',
            'invoice_failed',
            'payment_method_added',
            'payment_method_removed',
            'usage_recorded',
            'overage_charged'
        ),
        allowNull: false
    },
    customerId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'customers',
            key: 'id'
        }
    },
    subscriptionId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'subscriptions',
            key: 'id'
        }
    },
    invoiceId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'invoices',
            key: 'id'
        }
    },
    stripeEventId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    data: {
        type: DataTypes.JSON,
        allowNull: false
    },
    processed: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    processedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    errorMessage: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    }
});

// Plan Configuration Model
const Plan = sequelize.define('Plan', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    stripePriceId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    price: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false
    },
    currency: {
        type: DataTypes.STRING(3),
        allowNull: false,
        defaultValue: 'usd'
    },
    interval: {
        type: DataTypes.ENUM('day', 'week', 'month', 'year'),
        allowNull: false,
        defaultValue: 'month'
    },
    features: {
        type: DataTypes.JSON,
        allowNull: false
    },
    limits: {
        type: DataTypes.JSON,
        allowNull: false
    },
    isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    sortOrder: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    metadata: {
        type: DataTypes.JSON,
        allowNull: true
    },
    createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    }
});

// Define associations
Customer.belongsTo(User, { foreignKey: 'userId', as: 'user' });
Customer.belongsTo(Organization, { foreignKey: 'organizationId', as: 'organization' });
Customer.hasMany(Subscription, { foreignKey: 'customerId', as: 'subscriptions' });
Customer.hasMany(Invoice, { foreignKey: 'customerId', as: 'invoices' });
Customer.hasMany(PaymentMethod, { foreignKey: 'customerId', as: 'paymentMethods' });
Customer.hasMany(BillingEvent, { foreignKey: 'customerId', as: 'billingEvents' });

Subscription.belongsTo(Customer, { foreignKey: 'customerId', as: 'customer' });
Subscription.belongsTo(User, { foreignKey: 'userId', as: 'user' });
Subscription.belongsTo(Organization, { foreignKey: 'organizationId', as: 'organization' });
Subscription.hasMany(Invoice, { foreignKey: 'subscriptionId', as: 'invoices' });
Subscription.hasMany(BillingEvent, { foreignKey: 'subscriptionId', as: 'billingEvents' });

Invoice.belongsTo(Customer, { foreignKey: 'customerId', as: 'customer' });
Invoice.belongsTo(Subscription, { foreignKey: 'subscriptionId', as: 'subscription' });
Invoice.hasMany(BillingEvent, { foreignKey: 'invoiceId', as: 'billingEvents' });

PaymentMethod.belongsTo(Customer, { foreignKey: 'customerId', as: 'customer' });

UsageMetrics.belongsTo(Organization, { foreignKey: 'organizationId', as: 'organization' });
UsageMetrics.hasMany(BillingEvent, { foreignKey: 'organizationId', as: 'billingEvents' });

BillingEvent.belongsTo(Customer, { foreignKey: 'customerId', as: 'customer' });
BillingEvent.belongsTo(Subscription, { foreignKey: 'subscriptionId', as: 'subscription' });
BillingEvent.belongsTo(Invoice, { foreignKey: 'invoiceId', as: 'invoice' });

// Hooks and methods
Subscription.beforeCreate(async (subscription) => {
    // Set trial period for new subscriptions
    if (!subscription.trialStart && !subscription.trialEnd) {
        const trialDays = 14; // 14-day trial
        subscription.trialStart = new Date();
        subscription.trialEnd = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);
        subscription.currentPeriodStart = subscription.trialStart;
        subscription.currentPeriodEnd = subscription.trialEnd;
    }
});

// Instance methods
Subscription.prototype.isInTrial = function() {
    return this.status === 'trialing' && this.trialEnd && this.trialEnd > new Date();
};

Subscription.prototype.isPastDue = function() {
    return this.status === 'past_due' || (this.currentPeriodEnd && this.currentPeriodEnd < new Date());
};

Subscription.prototype.getDaysUntilRenewal = function() {
    if (!this.currentPeriodEnd) return null;
    const now = new Date();
    const diffTime = this.currentPeriodEnd - now;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

Subscription.prototype.getTrialDaysRemaining = function() {
    if (!this.isInTrial()) return 0;
    const now = new Date();
    const diffTime = this.trialEnd - now;
    return Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
};

// Class methods
Subscription.getCurrentSubscription = async function(userId) {
    return await this.findOne({
        where: { 
            userId,
            status: ['trialing', 'active']
        },
        include: [
            { model: Customer, as: 'customer' },
            { model: Invoice, as: 'invoices', limit: 5, order: [['createdAt', 'DESC']] }
        ],
        order: [['createdAt', 'DESC']]
    });
};

UsageMetrics.recordUsage = async function(organizationId, metrics) {
    const today = new Date();
    const existing = await this.findOne({
        where: {
            organizationId,
            period: 'daily',
            date: today
        }
    });

    if (existing) {
        // Update existing record
        return await existing.update({
            users: metrics.users || existing.users,
            storage: metrics.storage || existing.storage,
            apiCalls: metrics.apiCalls || existing.apiCalls,
            projects: metrics.projects || existing.projects,
            bandwidth: metrics.bandwidth || existing.bandwidth,
            tasks: metrics.tasks || existing.tasks,
            reports: metrics.reports || existing.reports
        });
    } else {
        // Create new record
        return await this.create({
            organizationId,
            period: 'daily',
            date: today,
            ...metrics
        });
    }
};

// Export models
module.exports = {
    Customer,
    Subscription,
    Invoice,
    PaymentMethod,
    UsageMetrics,
    BillingEvent,
    Plan
};
