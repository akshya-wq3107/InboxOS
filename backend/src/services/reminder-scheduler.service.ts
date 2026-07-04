import { PrismaClient } from '@prisma/client';
import { TelegramNotificationService } from './telegram-notification.service';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

export class ReminderSchedulerService {
  /**
   * Check for due reminders and dispatch notifications.
   * Should be called periodically (e.g., every minute via a cron job).
   */
  public static async checkAndDispatch(): Promise<void> {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + 60 * 1000); // 1-minute window

    const dueReminders = await prisma.reminder.findMany({
      where: {
        isSent: false,
        dueAt: { lte: windowEnd },
      },
      include: {
        user: {
          include: { settings: true },
        },
      },
    });

    if (dueReminders.length === 0) return;

    logger.info('[ReminderScheduler] Processing due reminders', { count: dueReminders.length });

    for (const reminder of dueReminders) {
      try {
        // Telegram notification if enabled
        if (reminder.user.settings?.telegramEnabled && reminder.user.settings?.telegramChatId) {
          await TelegramNotificationService.sendSystemErrorAlert(
            reminder.user.settings.telegramChatId,
            `⏰ Reminder: ${reminder.title}\nDue: ${reminder.dueAt.toISOString()}`
          );
        }

        // Mark as sent
        await prisma.reminder.update({
          where: { id: reminder.id },
          data: { isSent: true },
        });

        logger.info('[ReminderScheduler] Reminder dispatched', { id: reminder.id, userId: reminder.userId });
      } catch (err: any) {
        logger.error('[ReminderScheduler] Failed to dispatch reminder', {
          id: reminder.id,
          error: err.message,
        });
      }
    }
  }

  /**
   * Create a reminder for a user.
   */
  public static async createReminder(params: {
    userId: string;
    emailId?: string;
    title: string;
    dueAt: Date;
  }): Promise<{ id: string }> {
    const reminder = await prisma.reminder.create({
      data: {
        userId: params.userId,
        emailId: params.emailId,
        title: params.title,
        dueAt: params.dueAt,
      },
    });

    logger.info('[ReminderScheduler] Reminder created', { id: reminder.id, dueAt: params.dueAt });
    return { id: reminder.id };
  }
}
