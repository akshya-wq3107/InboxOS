import { Router, Response, Request } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.middleware';
import { ImapService } from '../services/imap.service';
import { encrypt } from '../utils/crypto';
import { logger } from '../utils/logger';
import { z } from 'zod';
import crypto from 'crypto';
import { google } from 'googleapis';

export const integrationsRouter = Router();
const prisma = new PrismaClient();

// Outlook OAuth2 config (Microsoft Identity Platform)
const OUTLOOK_CLIENT_ID = process.env.OUTLOOK_CLIENT_ID || '';
const OUTLOOK_CLIENT_SECRET = process.env.OUTLOOK_CLIENT_SECRET || '';
const OUTLOOK_REDIRECT_URI = process.env.OUTLOOK_REDIRECT_URI || 'http://localhost:8000/api/integrations/outlook/callback';
const OUTLOOK_TENANT = process.env.OUTLOOK_TENANT || 'common';
const OUTLOOK_SCOPE = 'openid profile email offline_access https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.ReadWrite';

const imapConnectSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(993),
  user: z.string().email(),
  password: z.string().min(1),
  tls: z.boolean().default(true),
});

/**
 * GET /api/integrations
 * List all connected email accounts for the user
 */
integrationsRouter.get('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const accounts = await prisma.emailAccount.findMany({
      where: { userId },
      select: {
        id: true,
        provider: true,
        emailAddress: true,
        syncState: true,
        isActive: true,
        lastSyncAt: true,
        createdAt: true,
      },
    });

    const integrations = await prisma.integration.findMany({
      where: { userId },
      select: { id: true, provider: true, createdAt: true, updatedAt: true },
    });

    return res.json({ emailAccounts: accounts, integrations });
  } catch (err: any) {
    logger.error('[Integrations] GET / error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch integrations' });
  }
});

/**
 * GET /api/integrations/outlook/auth
 * Generate Microsoft OAuth2 authorization URL
 */
integrationsRouter.get('/outlook/auth', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  if (!OUTLOOK_CLIENT_ID) {
    return res.status(503).json({ error: 'Outlook integration not configured. Set OUTLOOK_CLIENT_ID and OUTLOOK_CLIENT_SECRET.' });
  }

  const state = req.user?.userId;
  const params = new URLSearchParams({
    client_id: OUTLOOK_CLIENT_ID,
    response_type: 'code',
    redirect_uri: OUTLOOK_REDIRECT_URI,
    scope: OUTLOOK_SCOPE,
    response_mode: 'query',
    state: state || '',
    prompt: 'consent',
  });

  const url = `https://login.microsoftonline.com/${OUTLOOK_TENANT}/oauth2/v2.0/authorize?${params.toString()}`;
  return res.json({ url });
});

/**
 * GET /api/integrations/outlook/callback
 * Exchange authorization code for tokens and save to database
 */
integrationsRouter.get('/outlook/callback', async (req: Request, res: Response) => {
  const { code, state: userId, error: oauthError } = req.query;

  if (oauthError) {
    logger.error('[Integrations] Outlook OAuth error:', oauthError);
    return res.status(400).json({ error: 'OAuth authorization failed', detail: oauthError });
  }

  if (!code || !userId) {
    return res.status(400).json({ error: 'Missing code or state parameter' });
  }

  if (!OUTLOOK_CLIENT_ID || !OUTLOOK_CLIENT_SECRET) {
    return res.status(503).json({ error: 'Outlook integration not configured' });
  }

  try {
    // Exchange code for tokens
    const tokenResponse = await fetch(`https://login.microsoftonline.com/${OUTLOOK_TENANT}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: OUTLOOK_CLIENT_ID,
        client_secret: OUTLOOK_CLIENT_SECRET,
        code: code as string,
        redirect_uri: OUTLOOK_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    const tokens: any = await tokenResponse.json();
    if (tokens.error) {
      logger.error('[Integrations] Outlook token exchange failed:', tokens.error_description);
      return res.status(400).json({ error: tokens.error_description });
    }

    // Get user profile from Microsoft Graph
    const profileResponse = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile: any = await profileResponse.json();
    const emailAddress = profile.mail || profile.userPrincipalName;

    if (!emailAddress) {
      return res.status(400).json({ error: 'Could not retrieve email from Outlook account' });
    }

    const encryptedTokens = encrypt(JSON.stringify(tokens));

    await prisma.emailAccount.upsert({
      where: {
        userId_provider_emailAddress: {
          userId: userId as string,
          provider: 'outlook',
          emailAddress,
        },
      },
      update: { encryptedTokens, syncState: 'connected', lastSyncAt: new Date() },
      create: {
        userId: userId as string,
        provider: 'outlook',
        emailAddress,
        encryptedTokens,
        syncState: 'connected',
      },
    });

    logger.info('[Integrations] Outlook connected', { userId, emailAddress });
    return res.json({ message: 'Outlook connected successfully', emailAddress });
  } catch (err: any) {
    logger.error('[Integrations] Outlook callback error:', err.message);
    return res.status(500).json({ error: 'Outlook OAuth integration failed' });
  }
});

/**
 * POST /api/integrations/imap/connect
 * Connect an IMAP account
 */
integrationsRouter.post('/imap/connect', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const validation = imapConnectSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Validation failed', details: validation.error.flatten() });
    }

    const { host, port, user, password, tls } = validation.data;

    // Test the connection before saving
    const testResult = await ImapService.testConnection({ host, port, user, password, tls });
    if (!testResult.success) {
      return res.status(422).json({ error: 'IMAP connection failed', detail: testResult.error });
    }

    // Encrypt credentials
    const credentials = encrypt(JSON.stringify({ host, port, user, password, tls }));

    const account = await prisma.emailAccount.upsert({
      where: {
        userId_provider_emailAddress: { userId, provider: 'imap', emailAddress: user },
      },
      update: {
        encryptedTokens: credentials,
        syncState: 'connected',
        smtpHost: host,
        smtpPort: port,
        lastSyncAt: new Date(),
      },
      create: {
        userId,
        provider: 'imap',
        emailAddress: user,
        encryptedTokens: credentials,
        syncState: 'connected',
        smtpHost: host,
        smtpPort: port,
      },
    });

    logger.info('[Integrations] IMAP connected', { userId, user });
    return res.status(201).json({
      message: 'IMAP account connected successfully',
      id: account.id,
      emailAddress: account.emailAddress,
    });
  } catch (err: any) {
    logger.error('[Integrations] IMAP connect error:', err.message);
    return res.status(500).json({ error: 'Failed to connect IMAP account', message: err.message });
  }
});

/**
 * POST /api/integrations/imap/test
 * Test IMAP connection without saving
 */
integrationsRouter.post('/imap/test', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const validation = imapConnectSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Validation failed', details: validation.error.flatten() });
    }

    const { host, port, user, password, tls } = validation.data;
    logger.info('[Integrations] Testing IMAP connection', { userId, host, user });

    const result = await ImapService.testConnection({ host, port, user, password, tls });

    if (result.success) {
      return res.json({ success: true, message: 'IMAP connection successful' });
    } else {
      return res.status(422).json({ success: false, error: result.error });
    }
  } catch (err: any) {
    logger.error('[Integrations] IMAP test error:', err.message);
    return res.status(500).json({ error: 'IMAP test failed', message: err.message });
  }
});
