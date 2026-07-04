import { PrismaClient } from '@prisma/client';
import { AIService } from './ai.service';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

export class DigestGeneratorService {
  /**
   * Generate a daily or weekly digest for a user using AI summarization.
   */
  public static async generate(
    userId: string,
    type: 'daily' | 'weekly' = 'daily',
    limit: number = 20
  ) {
    logger.info('[DigestGenerator] Starting digest generation', { userId, type, limit });

    // Determine time window
    const since = new Date();
    if (type === 'daily') {
      since.setHours(0, 0, 0, 0);
    } else {
      since.setDate(since.getDate() - 7);
      since.setHours(0, 0, 0, 0);
    }

    // Fetch recent emails for user
    const emails = await prisma.email.findMany({
      where: { userId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        subject: true,
        sender: true,
        body: true,
        category: true,
        createdAt: true,
        analysis: { select: { summary: true, priorityScore: true } },
      },
    });

    if (emails.length === 0) {
      logger.info('[DigestGenerator] No emails found for digest period', { userId, type });
      const emptyDigest = await prisma.digest.create({
        data: {
          userId,
          type,
          content: `No emails received in the ${type} period.`,
          emailCount: 0,
        },
      });
      return emptyDigest;
    }

    // Build prompt for AI
    const emailSummaries = emails
      .map((e, i) => {
        const preview = e.body.substring(0, 300).replace(/\n+/g, ' ');
        const summary = e.analysis?.summary || preview;
        return `${i + 1}. [${e.category || 'general'}] "${e.subject}" from ${e.sender}\n   ${summary}`;
      })
      .join('\n\n');

    const prompt = `You are InboxOS, an AI email assistant. Create a concise ${type} digest from the following ${emails.length} emails. 
Format it clearly with:
- A short headline summary
- Key action items
- Important conversations
- Emails by category

Emails:
${emailSummaries}

Write the digest in a professional, readable format:`;

    let content: string;
    try {
      content = await AIService.generateReply(prompt);
    } catch (aiErr: any) {
      logger.warn('[DigestGenerator] AI generation failed, falling back to simple digest:', aiErr.message);
      content = `${type.charAt(0).toUpperCase() + type.slice(1)} Email Digest\n${'='.repeat(40)}\n\n${emails
        .map((e) => `• ${e.subject} — from ${e.sender} (${e.category || 'general'})`)
        .join('\n')}`;
    }

    const digest = await prisma.digest.create({
      data: { userId, type, content, emailCount: emails.length },
    });

    logger.info('[DigestGenerator] Digest created', { id: digest.id, userId, emailCount: emails.length });
    return digest;
  }
}
