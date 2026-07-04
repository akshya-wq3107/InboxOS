import { PrismaClient, Digest } from '@prisma/client';
import { EmailSenderService } from '../email-sender.service';
import { logger } from '../../utils/logger';

const prisma = new PrismaClient();

export class EmailDigestAdapter {
  /**
   * Sends the compiled digest email to the user using their connected SMTP or Gmail account.
   */
  public static async sendDigest(
    digest: Digest,
    userId: string
  ): Promise<void> {
    logger.info(
      `[EmailDigestAdapter] Sending digest ${digest.id} for user: ${userId}`
    );

    try {
      // 1. Fetch user profile to get their delivery address
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });

      if (!user) {
        throw new Error(`User not found: ${userId}`);
      }

      // 2. Resolve HTML and text formats from JSON content
      const content = digest.content as any;
      const html =
        content?.html || `<pre>${JSON.stringify(content, null, 2)}</pre>`;
      const text = `InboxOS ${digest.type.toUpperCase()} Digest: ${content?.emailCount || 0} low-priority updates compiled. Please view in a browser or HTML-capable email client.`;

      // 3. Send using EmailSenderService (which resolves Gmail API / SMTP dynamically)
      await EmailSenderService.send(userId, {
        to: user.email,
        subject: `Your InboxOS ${digest.type.charAt(0).toUpperCase() + digest.type.slice(1)} Digest`,
        text,
        html,
      });

      // 4. Update Digest status to sent
      await prisma.digest.update({
        where: { id: digest.id },
        data: {
          status: 'sent',
          sentAt: new Date(),
        },
      });

      logger.info(
        `[EmailDigestAdapter] Digest ${digest.id} sent and status updated to sent.`
      );
    } catch (err: any) {
      logger.error(
        `[EmailDigestAdapter] Failed to deliver digest ${digest.id}:`,
        err.message || err
      );

      // Update Digest status to failed in database
      try {
        await prisma.digest.update({
          where: { id: digest.id },
          data: {
            status: 'failed',
          },
        });
      } catch (dbErr) {
        logger.error(
          '[EmailDigestAdapter] Failed to mark digest status as failed in database:',
          dbErr
        );
      }

      throw err; // Re-throw to trigger job retries in BullMQ
    }
  }
}
