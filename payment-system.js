// Enhanced Payment Processing System - AuthKit Style
class PaymentProcessor {
    constructor() {
        this.stripe = null;
        this.elements = null;
        this.paymentElement = null;
        this.customerId = null;
        this.subscriptionId = null;
        this.plans = {
            free: {
                id: 'price_free',
                name: 'Free',
                price: 0,
                users: 5,
                features: ['Basic features', 'Community support', 'Up to 5 users']
            },
            pro: {
                id: 'price_pro_monthly',
                name: 'Pro',
                price: 12,
                users: 50,
                features: ['All core features', 'Advanced analytics', 'Priority support', 'API access', 'Up to 50 users']
            },
            business: {
                id: 'price_business_monthly',
                name: 'Business',
                price: 25,
                users: -1, // unlimited
                features: ['Everything in Pro', 'Custom integrations', 'Dedicated support', 'SLA guarantee', 'Unlimited users']
            }
        };
    }

    async initialize() {
        try {
            // Initialize Stripe with your publishable key
            this.stripe = Stripe('pk_test_51234567890abcdef'); // Replace with actual key
            
            // Create payment elements
            const response = await fetch('/api/create-payment-intent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ plan: 'pro' })
            });
            
            const { clientSecret, customerId } = await response.json();
            this.customerId = customerId;
            
            this.elements = this.stripe.elements({
                clientSecret,
                appearance: {
                    theme: 'stripe',
                    variables: {
                        colorPrimary: '#242220',
                        colorBackground: '#ffffff',
                        colorText: '#171513',
                        colorDanger: '#cf4b3e',
                        fontFamily: 'Inter, sans-serif',
                        spacingUnit: '4px',
                        borderRadius: '8px'
                    }
                }
            });
            
            this.paymentElement = this.elements.create('payment', {
                layout: 'tabs'
            });
            
            return true;
        } catch (error) {
            console.error('Payment processor initialization failed:', error);
            return false;
        }
    }

    async createSubscription(planId, paymentMethodId) {
        try {
            const response = await fetch('/api/create-subscription', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    planId,
                    paymentMethodId,
                    customerId: this.customerId
                })
            });
            
            const { subscription, error } = await response.json();
            
            if (error) {
                throw new Error(error);
            }
            
            this.subscriptionId = subscription.id;
            return subscription;
        } catch (error) {
            console.error('Subscription creation failed:', error);
            throw error;
        }
    }

    async updateSubscription(subscriptionId, planId) {
        try {
            const response = await fetch('/api/update-subscription', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    subscriptionId,
                    planId
                })
            });
            
            const { subscription, error } = await response.json();
            
            if (error) {
                throw new Error(error);
            }
            
            return subscription;
        } catch (error) {
            console.error('Subscription update failed:', error);
            throw error;
        }
    }

    async cancelSubscription(subscriptionId, reason = 'user_requested') {
        try {
            const response = await fetch('/api/cancel-subscription', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    subscriptionId,
                    reason
                })
            });
            
            const { subscription, error } = await response.json();
            
            if (error) {
                throw new Error(error);
            }
            
            return subscription;
        } catch (error) {
            console.error('Subscription cancellation failed:', error);
            throw error;
        }
    }

    async pauseSubscription(subscriptionId) {
        try {
            const response = await fetch('/api/pause-subscription', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subscriptionId })
            });
            
            const { subscription, error } = await response.json();
            
            if (error) {
                throw new Error(error);
            }
            
            return subscription;
        } catch (error) {
            console.error('Subscription pause failed:', error);
            throw error;
        }
    }

    async resumeSubscription(subscriptionId) {
        try {
            const response = await fetch('/api/resume-subscription', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subscriptionId })
            });
            
            const { subscription, error } = await response.json();
            
            if (error) {
                throw new Error(error);
            }
            
            return subscription;
        } catch (error) {
            console.error('Subscription resume failed:', error);
            throw error;
        }
    }

    async addPaymentMethod(paymentMethodId) {
        try {
            const response = await fetch('/api/add-payment-method', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customerId: this.customerId,
                    paymentMethodId
                })
            });
            
            const { paymentMethod, error } = await response.json();
            
            if (error) {
                throw new Error(error);
            }
            
            return paymentMethod;
        } catch (error) {
            console.error('Payment method addition failed:', error);
            throw error;
        }
    }

    async removePaymentMethod(paymentMethodId) {
        try {
            const response = await fetch('/api/remove-payment-method', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customerId: this.customerId,
                    paymentMethodId
                })
            });
            
            const { success, error } = await response.json();
            
            if (error) {
                throw new Error(error);
            }
            
            return success;
        } catch (error) {
            console.error('Payment method removal failed:', error);
            throw error;
        }
    }

    async getUsageMetrics(customerId) {
        try {
            const response = await fetch(`/api/usage-metrics/${customerId}`);
            const { metrics, error } = await response.json();
            
            if (error) {
                throw new Error(error);
            }
            
            return metrics;
        } catch (error) {
            console.error('Usage metrics fetch failed:', error);
            throw error;
        }
    }

    async calculateOverage(usage, planLimits) {
        const overage = {
            storage: Math.max(0, usage.storage - planLimits.storage),
            apiCalls: Math.max(0, usage.apiCalls - planLimits.apiCalls),
            users: Math.max(0, usage.users - planLimits.users),
            projects: Math.max(0, usage.projects - planLimits.projects)
        };

        const overageCosts = {
            storage: overage.storage * 0.10, // $0.10 per GB
            apiCalls: Math.ceil(overage.apiCalls / 1000) * 0.01, // $0.01 per 1000 calls
            users: overage.users * planIds[planLimits.plan].price, // Full price per additional user
            projects: overage.projects * 2 // $2 per additional project
        };

        return {
            overage,
            costs: overageCosts,
            total: Object.values(overageCosts).reduce((sum, cost) => sum + cost, 0)
        };
    }

    async processPayment(amount, currency = 'usd') {
        try {
            const response = await fetch('/api/process-payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    amount: Math.round(amount * 100), // Convert to cents
                    currency,
                    customerId: this.customerId
                })
            });
            
            const { paymentIntent, error } = await response.json();
            
            if (error) {
                throw new Error(error);
            }
            
            return paymentIntent;
        } catch (error) {
            console.error('Payment processing failed:', error);
            throw error;
        }
    }

    async getInvoices(customerId) {
        try {
            const response = await fetch(`/api/invoices/${customerId}`);
            const { invoices, error } = await response.json();
            
            if (error) {
                throw new Error(error);
            }
            
            return invoices;
        } catch (error) {
            console.error('Invoice fetch failed:', error);
            throw error;
        }
    }

    async downloadInvoice(invoiceId) {
        try {
            const response = await fetch(`/api/invoices/${invoiceId}/download`);
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `invoice-${invoiceId}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Invoice download failed:', error);
            throw error;
        }
    }

    renderPaymentElement(containerId) {
        if (this.paymentElement && containerId) {
            this.paymentElement.mount(`#${containerId}`);
        }
    }

    destroyPaymentElement() {
        if (this.paymentElement) {
            this.paymentElement.destroy();
        }
        if (this.elements) {
            this.elements.destroy();
        }
    }
}

// Subscription Lifecycle Manager
class SubscriptionLifecycle {
    constructor() {
        this.paymentProcessor = new PaymentProcessor();
        this.currentSubscription = null;
        this.usageMetrics = null;
    }

    async initialize() {
        await this.paymentProcessor.initialize();
        await this.loadCurrentSubscription();
        await this.loadUsageMetrics();
    }

    async loadCurrentSubscription() {
        try {
            const response = await fetch('/api/current-subscription');
            const { subscription, error } = await response.json();
            
            if (!error && subscription) {
                this.currentSubscription = subscription;
            }
        } catch (error) {
            console.error('Failed to load current subscription:', error);
        }
    }

    async loadUsageMetrics() {
        try {
            if (this.currentSubscription) {
                this.usageMetrics = await this.paymentProcessor.getUsageMetrics(
                    this.currentSubscription.customerId
                );
            }
        } catch (error) {
            console.error('Failed to load usage metrics:', error);
        }
    }

    async upgradePlan(newPlanId) {
        try {
            if (!this.currentSubscription) {
                // Create new subscription
                const subscription = await this.paymentProcessor.createSubscription(newPlanId);
                this.currentSubscription = subscription;
                return subscription;
            } else {
                // Update existing subscription
                const subscription = await this.paymentProcessor.updateSubscription(
                    this.currentSubscription.id,
                    newPlanId
                );
                this.currentSubscription = subscription;
                return subscription;
            }
        } catch (error) {
            console.error('Plan upgrade failed:', error);
            throw error;
        }
    }

    async downgradePlan(newPlanId) {
        try {
            if (!this.currentSubscription) {
                throw new Error('No active subscription to downgrade');
            }

            // Check if downgrade is allowed based on current usage
            const newPlan = this.paymentProcessor.plans[newPlanId];
            const currentUsage = this.usageMetrics;

            if (newPlan.users !== -1 && currentUsage.users > newPlan.users) {
                throw new Error(`Cannot downgrade: You have ${currentUsage.users} users but ${newPlan.name} plan only allows ${newPlan.users} users`);
            }

            const subscription = await this.paymentProcessor.updateSubscription(
                this.currentSubscription.id,
                newPlanId
            );
            
            this.currentSubscription = subscription;
            return subscription;
        } catch (error) {
            console.error('Plan downgrade failed:', error);
            throw error;
        }
    }

    async cancelSubscription(reason = 'user_requested') {
        try {
            if (!this.currentSubscription) {
                throw new Error('No active subscription to cancel');
            }

            const subscription = await this.paymentProcessor.cancelSubscription(
                this.currentSubscription.id,
                reason
            );
            
            this.currentSubscription = subscription;
            return subscription;
        } catch (error) {
            console.error('Subscription cancellation failed:', error);
            throw error;
        }
    }

    async pauseSubscription() {
        try {
            if (!this.currentSubscription) {
                throw new Error('No active subscription to pause');
            }

            const subscription = await this.paymentProcessor.pauseSubscription(
                this.currentSubscription.id
            );
            
            this.currentSubscription = subscription;
            return subscription;
        } catch (error) {
            console.error('Subscription pause failed:', error);
            throw error;
        }
    }

    async resumeSubscription() {
        try {
            if (!this.currentSubscription) {
                throw new Error('No paused subscription to resume');
            }

            const subscription = await this.paymentProcessor.resumeSubscription(
                this.currentSubscription.id
            );
            
            this.currentSubscription = subscription;
            return subscription;
        } catch (error) {
            console.error('Subscription resume failed:', error);
            throw error;
        }
    }

    getPlanComparison() {
        const plans = this.paymentProcessor.plans;
        const currentPlan = this.currentSubscription?.plan || 'free';
        
        return Object.entries(plans).map(([key, plan]) => ({
            ...plan,
            id: key,
            isCurrent: key === currentPlan,
            canUpgrade: this.canUpgrade(currentPlan, key),
            canDowngrade: this.canDowngrade(currentPlan, key)
        }));
    }

    canUpgrade(currentPlan, targetPlan) {
        const planHierarchy = { free: 0, pro: 1, business: 2 };
        return planHierarchy[targetPlan] > planHierarchy[currentPlan];
    }

    canDowngrade(currentPlan, targetPlan) {
        const planHierarchy = { free: 0, pro: 1, business: 2 };
        return planHierarchy[targetPlan] < planHierarchy[currentPlan];
    }

    getUsageWarnings() {
        if (!this.usageMetrics || !this.currentSubscription) {
            return [];
        }

        const plan = this.paymentProcessor.plans[this.currentSubscription.plan];
        const warnings = [];

        if (plan.users !== -1) {
            const userUsage = (this.usageMetrics.users / plan.users) * 100;
            if (userUsage > 90) {
                warnings.push({
                    type: 'users',
                    severity: 'warning',
                    message: `You're using ${userUsage.toFixed(1)}% of your user limit`,
                    action: 'upgrade'
                });
            }
        }

        const storageUsage = (this.usageMetrics.storage / 10) * 100; // 10GB base storage
        if (storageUsage > 90) {
            warnings.push({
                type: 'storage',
                severity: 'warning',
                message: `You're using ${storageUsage.toFixed(1)}% of your storage limit`,
                action: 'upgrade'
            });
        }

        return warnings;
    }

    async generateUsageReport() {
        if (!this.usageMetrics) {
            return null;
        }

        const plan = this.paymentProcessor.plans[this.currentSubscription?.plan || 'free'];
        const overage = await this.paymentProcessor.calculateOverage(
            this.usageMetrics,
            { ...plan, plan: this.currentSubscription?.plan || 'free' }
        );

        return {
            currentUsage: this.usageMetrics,
            planLimits: {
                users: plan.users,
                storage: 10, // 10GB base storage
                apiCalls: plan.id === 'free' ? 10000 : plan.id === 'pro' ? 100000 : 1000000,
                projects: plan.id === 'free' ? 5 : plan.id === 'pro' ? 100 : 1000
            },
            overage,
            recommendations: this.generateRecommendations()
        };
    }

    generateRecommendations() {
        const recommendations = [];
        const warnings = this.getUsageWarnings();

        warnings.forEach(warning => {
            if (warning.type === 'users') {
                recommendations.push({
                    type: 'upgrade',
                    priority: 'high',
                    title: 'Upgrade your plan',
                    description: 'Consider upgrading to the Business plan for unlimited users',
                    action: 'upgrade'
                });
            } else if (warning.type === 'storage') {
                recommendations.push({
                    type: 'upgrade',
                    priority: 'medium',
                    title: 'Increase storage',
                    description: 'Upgrade your plan or purchase additional storage',
                    action: 'upgrade'
                });
            }
        });

        return recommendations;
    }
}

// Usage-based Billing System
class UsageBasedBilling {
    constructor() {
        this.usageRates = {
            storage: 0.10, // $0.10 per GB
            apiCalls: 0.01, // $0.01 per 1000 calls
            users: 12, // $12 per additional user (Pro rate)
            projects: 2, // $2 per additional project
            bandwidth: 0.05 // $0.05 per GB
        };
    }

    calculateBill(usage, plan) {
        const bill = {
            baseCost: plan.price,
            usage: {},
            overage: {},
            total: 0
        };

        // Calculate usage-based charges
        if (plan.id === 'business') {
            // Business plan has unlimited core resources
            bill.usage.storage = 0;
            bill.usage.users = 0;
            bill.usage.projects = 0;
        } else {
            // Calculate overage for limited plans
            const limits = this.getPlanLimits(plan.id);
            
            bill.usage.storage = Math.max(0, usage.storage - limits.storage) * this.usageRates.storage;
            bill.usage.users = Math.max(0, usage.users - limits.users) * this.usageRates.users;
            bill.usage.projects = Math.max(0, usage.projects - limits.projects) * this.usageRates.projects;
        }

        // API calls are always usage-based
        const apiCallUnits = Math.ceil(usage.apiCalls / 1000);
        bill.usage.apiCalls = apiCallUnits * this.usageRates.apiCalls;

        // Bandwidth usage
        const bandwidthUnits = Math.ceil(usage.bandwidth / 1); // per GB
        bill.usage.bandwidth = bandwidthUnits * this.usageRates.bandwidth;

        // Calculate total
        bill.total = bill.baseCost + Object.values(bill.usage).reduce((sum, cost) => sum + cost, 0);

        return bill;
    }

    getPlanLimits(planId) {
        const limits = {
            free: {
                storage: 5, // 5GB
                users: 5,
                projects: 5,
                apiCalls: 10000
            },
            pro: {
                storage: 10, // 10GB
                users: 50,
                projects: 100,
                apiCalls: 100000
            },
            business: {
                storage: -1, // unlimited
                users: -1, // unlimited
                projects: -1, // unlimited
                apiCalls: 1000000
            }
        };

        return limits[planId] || limits.free;
    }

    generateInvoice(usage, plan, billingPeriod) {
        const bill = this.calculateBill(usage, plan);
        
        return {
            id: `inv_${Date.now()}`,
            date: new Date().toISOString(),
            billingPeriod,
            customer: plan.customerId,
            items: [
                {
                    description: `${plan.name} Plan - ${billingPeriod}`,
                    quantity: 1,
                    unitPrice: plan.price,
                    amount: plan.price
                },
                ...Object.entries(bill.usage).map(([key, amount]) => ({
                    description: this.getUsageDescription(key),
                    quantity: this.getUsageQuantity(usage, key),
                    unitPrice: this.usageRates[key],
                    amount
                })).filter(item => item.amount > 0)
            ],
            subtotal: bill.total,
            tax: bill.total * 0.08, // 8% tax
            total: bill.total * 1.08,
            status: 'pending',
            dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        };
    }

    getUsageDescription(usageType) {
        const descriptions = {
            storage: 'Additional Storage',
            users: 'Additional Users',
            projects: 'Additional Projects',
            apiCalls: 'API Calls',
            bandwidth: 'Bandwidth Usage'
        };
        return descriptions[usageType] || usageType;
    }

    getUsageQuantity(usage, usageType) {
        const limits = this.getPlanLimits('pro'); // Use Pro as baseline
        switch (usageType) {
            case 'storage':
                return Math.max(0, usage.storage - limits.storage);
            case 'users':
                return Math.max(0, usage.users - limits.users);
            case 'projects':
                return Math.max(0, usage.projects - limits.projects);
            case 'apiCalls':
                return Math.ceil(usage.apiCalls / 1000);
            case 'bandwidth':
                return Math.ceil(usage.bandwidth / 1);
            default:
                return 1;
        }
    }
}

// Export classes for use in the application
window.PaymentProcessor = PaymentProcessor;
window.SubscriptionLifecycle = SubscriptionLifecycle;
window.UsageBasedBilling = UsageBasedBilling;
