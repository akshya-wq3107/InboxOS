import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.middleware';
import { DigestGeneratorService } from '../services/digest-generator.service';
import { EmailSenderService } from '../services/email-sender.service';
import { logger } from '../utils/logger';
import { z } from 'zod';

export const digestsRouter = Router();
const prisma = new PrismaClient();

const generateSchema = z.object({
  type: z.enum(['daily', 'weekly']).optional().default('daily'),
  limit: z.number().int().min(1).max(100).optional().default(20),
});

/**
 * GET /api/digests
 * List digests for the authenticated user
 */
digestsRouter.get('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const limit = parseInt(req.query.limit as string) || 10;
    const offset = parseInt(req.query.offset as string) || 0;

    const [digests, total] = await Promise.all([
      prisma.digest.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.digest.count({ where: { userId } }),
    ]);

    return res.json({ digests, total, limit, offset });
  } catch (err: any) {
    logger.error('[Digests] GET / error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch digests' });
  }
});

/**
 * POST /api/digests/generate
 * Generate a new AI digest for the authenticated user
 */
digestsRouter.post('/generate', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const validation = generateSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Validation failed', details: validation.error.flatten() });
    }
    const { type, limit } = validation.data;

    logger.info('[Digests] Generating digest', { userId, type });
    const digest = await DigestGeneratorService.generate(userId, type, limit);

    return res.status(201).json(digest);
  } catch (err: any) {
    logger.error('[Digests] POST /generate error:', err.message);
    return res.status(500).json({ error: 'Failed to generate digest', message: err.message });
  }
});

/**
 * POST /api/digests/:id/send
 * Send a digest via email to the user
 */
digestsRouter.post('/:id/send', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const id = req.params.id as string;
    const digest = await prisma.digest.findUnique({ where: { id } });

    if (!digest || digest.userId !== userId) {
      return res.status(404).json({ error: 'Digest not found' });
    }

    // Fetch user email
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    await EmailSenderService.send(userId, {
      to: user.email,
      subject: `Your InboxOS ${digest.type} digest`,
      text: digest.content,
      html: `<pre style="font-family:sans-serif;white-space:pre-wrap">${digest.content}</pre>`,
    });

    await prisma.digest.update({ where: { id }, data: { sentAt: new Date() } });

    logger.info('[Digests] Digest sent', { id, userId });
    return res.json({ message: 'Digest sent successfully' });
  } catch (err: any) {
    logger.error('[Digests] POST /:id/send error:', err.message);
    return res.status(500).json({ error: 'Failed to send digest', message: err.message });
  }
});
