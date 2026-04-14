const express = require('express');
const router = express.Router();
const { query, withTransaction } = require('../utils/db');
const { authenticate, requireRole } = require('../middleware/auth');
const axios = require('axios');
const crypto = require('crypto');

function providerIsConfigured(provider) {
  const requiredEnv = {
    slack: ['SLACK_CLIENT_ID', 'SLACK_REDIRECT_URI'],
    google_calendar: ['GOOGLE_CLIENT_ID', 'GOOGLE_REDIRECT_URI'],
    google_drive: ['GOOGLE_CLIENT_ID', 'GOOGLE_REDIRECT_URI'],
    gmail: ['GOOGLE_CLIENT_ID', 'GOOGLE_REDIRECT_URI'],
    microsoft_teams: ['MICROSOFT_CLIENT_ID', 'MICROSOFT_REDIRECT_URI'],
    jira: ['JIRA_CLIENT_ID', 'JIRA_REDIRECT_URI'],
    discord: ['DISCORD_CLIENT_ID', 'DISCORD_REDIRECT_URI']
  };

  return (requiredEnv[provider] || []).every((key) => !!process.env[key]);
}

// GET /integrations - List available integrations and user's connected integrations
router.get('/', authenticate, async (req, res, next) => {
  try {
    const orgId = req.user.org_id || req.user.orgId;
    
    // Get user's connected integrations
    const { rows: userIntegrations } = await query(`
      SELECT 
        ii.id,
        ii.integration_type,
        ii.provider,
        ii.config,
        ii.is_active,
        ii.created_at,
        ii.last_sync_at,
        ii.user_id,
        u.full_name as created_by_name
      FROM integrations_instances ii
      LEFT JOIN users u ON ii.user_id = u.id
      WHERE ii.org_id = $1 AND ii.is_active = true
      ORDER BY ii.created_at DESC
    `, [orgId]);
    
    // Available integration types
    const availableIntegrations = [
      {
        type: 'communication',
        provider: 'slack',
        name: 'Slack',
        description: 'Send notifications and create tasks from Slack messages',
        features: ['notifications', 'task_creation', 'status_updates'],
        icon: '💬',
        category: 'Communication'
      },
      {
        type: 'communication',
        provider: 'microsoft_teams',
        name: 'Microsoft Teams',
        description: 'Integrate with Teams for notifications and task management',
        features: ['notifications', 'task_creation', 'meetings'],
        icon: '🟣',
        category: 'Communication'
      },
      {
        type: 'calendar',
        provider: 'google_calendar',
        name: 'Google Calendar',
        description: 'Sync tasks with calendar events and deadlines',
        features: ['calendar_sync', 'deadline_reminders', 'scheduling'],
        icon: '📅',
        category: 'Calendar'
      },
      {
        type: 'storage',
        provider: 'google_drive',
        name: 'Google Drive',
        description: 'Attach files and manage documents from Google Drive',
        features: ['file_attachments', 'document_management', 'sharing'],
        icon: '📁',
        category: 'Storage'
      },
      {
        type: 'email',
        provider: 'gmail',
        name: 'Gmail',
        description: 'Create tasks from emails and send notifications',
        features: ['email_to_task', 'notifications', 'attachments'],
        icon: '📧',
        category: 'Email'
      },
      {
        type: 'project_management',
        provider: 'jira',
        name: 'Jira',
        description: 'Sync tasks and issues with Jira projects',
        features: ['task_sync', 'issue_tracking', 'status_sync'],
        icon: '🎯',
        category: 'Project Management'
      },
      {
        type: 'communication',
        provider: 'discord',
        name: 'Discord',
        description: 'Send notifications and manage tasks via Discord',
        features: ['notifications', 'task_creation', 'role_based_alerts'],
        icon: '🎮',
        category: 'Communication'
      }
    ];
    
    res.json({
      available_integrations: availableIntegrations,
      connected_integrations: userIntegrations,
      categories: ['Communication', 'Calendar', 'Storage', 'Email', 'Project Management']
    });
    
  } catch (error) {
    console.error('Integrations list error:', error);
    next(error);
  }
});

// POST /integrations/connect - Initiate connection to an integration provider
router.post('/connect', authenticate, async (req, res, next) => {
  try {
    const { provider, integration_type, redirect_url } = req.body;
    const orgId = req.user.org_id || req.user.orgId;
    const userId = req.user.id;
    
    if (!provider || !integration_type) {
      return res.status(400).json({ error: 'Provider and integration type are required' });
    }

    if (process.env.DEMO_MODE === 'true' || !providerIsConfigured(provider)) {
      await query(`
        INSERT INTO integrations_instances (
          id, user_id, org_id, integration_type, provider,
          config, is_active, created_at
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4, $5, true, NOW()
        )
      `, [userId, orgId, integration_type, provider, JSON.stringify({
        mode: 'manual',
        connected_at: new Date().toISOString(),
        note: 'Connected without OAuth because provider credentials are not configured.'
      })]);

      return res.json({
        success: true,
        connected: true,
        mode: 'manual',
        message: 'Connected in manual mode'
      });
    }
    
    // Generate state parameter for OAuth flow
    const state = crypto.randomBytes(32).toString('hex');
    
    // Store OAuth state in database
    await query(`
      INSERT INTO oauth_states (id, user_id, org_id, provider, integration_type, redirect_url, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '1 hour')
    `, [state, userId, orgId, provider, integration_type, redirect_url]);
    
    let authUrl;
    
    switch (provider) {
      case 'slack':
        authUrl = `https://slack.com/oauth/v2/authorize?client_id=${process.env.SLACK_CLIENT_ID}&scope=channels:read,chat:write,commands&redirect_uri=${encodeURIComponent(process.env.SLACK_REDIRECT_URI)}&state=${state}`;
        break;
      
      case 'google_calendar':
      case 'google_drive':
      case 'gmail':
        const scopes = {
          google_calendar: 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events',
          google_drive: 'https://www.googleapis.com/auth/drive.readonly',
          gmail: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send'
        };
        authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.GOOGLE_REDIRECT_URI)}&scope=${encodeURIComponent(scopes[provider])}&response_type=code&access_type=offline&state=${state}`;
        break;
      
      case 'microsoft_teams':
        authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${process.env.MICROSOFT_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(process.env.MICROSOFT_REDIRECT_URI)}&scope=https://graph.microsoft.com/Chat.ReadWrite https://graph.microsoft.com/Calendars.ReadWrite&state=${state}`;
        break;
      
      case 'jira':
        // Jira uses OAuth 1.0 - simplified for this example
        authUrl = `https://auth.atlassian.com/authorize?audience=api.atlassian.com&client_id=${process.env.JIRA_CLIENT_ID}&scope=read:jira-work write:jira-work offline_access&redirect_uri=${encodeURIComponent(process.env.JIRA_REDIRECT_URI)}&response_type=code&state=${state}&prompt=consent`;
        break;
      
      case 'discord':
        authUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&permissions=2147483648&scope=bot applications.commands&redirect_uri=${encodeURIComponent(process.env.DISCORD_REDIRECT_URI)}&response_type=code&state=${state}`;
        break;
      
      default:
        return res.status(400).json({ error: 'Unsupported provider' });
    }
    
    res.json({
      auth_url: authUrl,
      state: state
    });
    
  } catch (error) {
    console.error('Integration connect error:', error);
    next(error);
  }
});

// POST /integrations/callback - Handle OAuth callback from providers
router.post('/callback', async (req, res, next) => {
  try {
    const { state, code, error } = req.body;
    
    if (error) {
      return res.status(400).json({ error: error });
    }
    
    if (!state || !code) {
      return res.status(400).json({ error: 'State and code are required' });
    }
    
    // Verify OAuth state
    const { rows: stateRows } = await query(`
      SELECT user_id, org_id, provider, integration_type, redirect_url
      FROM oauth_states 
      WHERE id = $1 AND expires_at > NOW()
    `, [state]);
    
    if (!stateRows.length) {
      return res.status(400).json({ error: 'Invalid or expired state' });
    }
    
    const { user_id, org_id, provider, integration_type, redirect_url } = stateRows[0];
    
    // Exchange code for access token based on provider
    let tokenData;
    
    try {
      switch (provider) {
        case 'slack':
          const slackResponse = await axios.post('https://slack.com/api/oauth.v2.access', null, {
            params: {
              client_id: process.env.SLACK_CLIENT_ID,
              client_secret: process.env.SLACK_CLIENT_SECRET,
              code: code,
              redirect_uri: process.env.SLACK_REDIRECT_URI
            }
          });
          
          if (!slackResponse.data.ok) {
            throw new Error(slackResponse.data.error);
          }
          
          tokenData = {
            access_token: slackResponse.data.access_token,
            refresh_token: slackResponse.data.refresh_token,
            team_id: slackResponse.data.team.id,
            team_name: slackResponse.data.team.name,
            bot_user_id: slackResponse.data.bot_user_id
          };
          break;
        
        case 'google_calendar':
        case 'google_drive':
        case 'gmail':
          const googleResponse = await axios.post('https://oauth2.googleapis.com/token', null, {
            params: {
              client_id: process.env.GOOGLE_CLIENT_ID,
              client_secret: process.env.GOOGLE_CLIENT_SECRET,
              code: code,
              redirect_uri: process.env.GOOGLE_REDIRECT_URI,
              grant_type: 'authorization_code'
            }
          });
          
          tokenData = {
            access_token: googleResponse.data.access_token,
            refresh_token: googleResponse.data.refresh_token,
            expires_in: googleResponse.data.expires_in
          };
          break;
        
        // Add other providers as needed
        default:
          throw new Error('Provider not implemented for token exchange');
      }
      
    } catch (tokenError) {
      console.error('Token exchange error:', tokenError);
      return res.status(400).json({ error: 'Failed to exchange authorization code' });
    }
    
    // Store integration in database
    await withTransaction(async (client) => {
      await client.query(`
        INSERT INTO integrations_instances (
          id, user_id, org_id, integration_type, provider, 
          config, is_active, created_at
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4, $5, true, NOW()
        )
      `, [user_id, org_id, integration_type, provider, JSON.stringify(tokenData)]);
      
      // Clean up OAuth state
      await client.query('DELETE FROM oauth_states WHERE id = $1', [state]);
    });
    
    res.json({
      success: true,
      provider: provider,
      integration_type: integration_type,
      redirect_url: redirect_url
    });
    
  } catch (error) {
    console.error('OAuth callback error:', error);
    next(error);
  }
});

// GET /integrations/:id - Get details of a specific integration
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const orgId = req.user.org_id || req.user.orgId;
    
    const { rows } = await query(`
      SELECT 
        ii.*,
        u.full_name as created_by_name
      FROM integrations_instances ii
      LEFT JOIN users u ON ii.user_id = u.id
      WHERE ii.id = $1 AND ii.org_id = $2
    `, [id, orgId]);
    
    if (!rows.length) {
      return res.status(404).json({ error: 'Integration not found' });
    }
    
    const integration = rows[0];
    
    // Get sync history
    const { rows: syncHistory } = await query(`
      SELECT * FROM integration_sync_logs 
      WHERE integration_id = $1 
      ORDER BY created_at DESC 
      LIMIT 10
    `, [id]);
    
    res.json({
      integration: integration,
      sync_history: syncHistory
    });
    
  } catch (error) {
    console.error('Get integration error:', error);
    next(error);
  }
});

// DELETE /integrations/:id - Disconnect an integration
router.delete('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const orgId = req.user.org_id || req.user.orgId;
    
    await withTransaction(async (client) => {
      // Deactivate integration
      await client.query(`
        UPDATE integrations_instances 
        SET is_active = false, updated_at = NOW() 
        WHERE id = $1 AND org_id = $2
      `, [id, orgId]);
      
      // Log disconnection
      await client.query(`
        INSERT INTO integration_sync_logs (
          id, integration_id, sync_type, status, details, created_at
        ) VALUES (
          gen_random_uuid(), $1, 'disconnection', 'success', 
          json_build_object('disconnected_by', $2, 'timestamp', NOW()), 
          NOW()
        )
      `, [id, req.user.id]);
    });
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('Disconnect integration error:', error);
    next(error);
  }
});

// POST /integrations/:id/sync - Manually trigger sync for an integration
router.post('/:id/sync', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { sync_type = 'full' } = req.body;
    const orgId = req.user.org_id || req.user.orgId;
    
    // Get integration details
    const { rows: integrationRows } = await query(`
      SELECT * FROM integrations_instances 
      WHERE id = $1 AND org_id = $2 AND is_active = true
    `, [id, orgId]);
    
    if (!integrationRows.length) {
      return res.status(404).json({ error: 'Integration not found or inactive' });
    }
    
    const integration = integrationRows[0];
    
    // Trigger sync based on provider type
    let syncResult;
    
    try {
      switch (integration.provider) {
        case 'slack':
          syncResult = await syncSlackIntegration(integration);
          break;
        case 'google_calendar':
          syncResult = await syncGoogleCalendarIntegration(integration);
          break;
        // Add other providers
        default:
          syncResult = { message: 'Sync not implemented for this provider' };
      }
      
      // Log sync result
      await query(`
        INSERT INTO integration_sync_logs (
          id, integration_id, sync_type, status, details, created_at
        ) VALUES (
          gen_random_uuid(), $1, $2, 'success', $3, NOW()
        )
      `, [id, sync_type, JSON.stringify(syncResult)]);
      
      // Update last sync timestamp
      await query(`
        UPDATE integrations_instances 
        SET last_sync_at = NOW() 
        WHERE id = $1
      `, [id]);
      
      res.json({
        success: true,
        sync_result: syncResult
      });
      
    } catch (syncError) {
      // Log sync failure
      await query(`
        INSERT INTO integration_sync_logs (
          id, integration_id, sync_type, status, details, created_at
        ) VALUES (
          gen_random_uuid(), $1, $2, 'failed', $3, NOW()
        )
      `, [id, sync_type, JSON.stringify({ error: syncError.message })]);
      
      throw syncError;
    }
    
  } catch (error) {
    console.error('Integration sync error:', error);
    next(error);
  }
});

// Helper functions for specific integrations
async function syncSlackIntegration(integration) {
  const config = JSON.parse(integration.config);
  
  // Get channels
  const channelsResponse = await axios.get('https://slack.com/api/conversations.list', {
    headers: {
      'Authorization': `Bearer ${config.access_token}`
    }
  });
  
  if (!channelsResponse.data.ok) {
    throw new Error(channelsResponse.data.error);
  }
  
  return {
    channels_found: channelsResponse.data.channels.length,
    sync_timestamp: new Date().toISOString(),
    team_name: config.team_name
  };
}

async function syncGoogleCalendarIntegration(integration) {
  const config = JSON.parse(integration.config);
  
  // Get upcoming events
  const eventsResponse = await axios.get('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    headers: {
      'Authorization': `Bearer ${config.access_token}`
    },
    params: {
      timeMin: new Date().toISOString(),
      maxResults: 10
    }
  });
  
  return {
    events_found: eventsResponse.data.items.length,
    sync_timestamp: new Date().toISOString()
  };
}

module.exports = router;
