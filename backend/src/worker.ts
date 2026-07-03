import { EventBus } from './services/event-bus.service';
import { PrismaClient } from '@prisma/client';
import { AIService } from './services/ai.service';
import { indexEmailsWorker } from './jobs/index-emails.job';

const prisma = new PrismaClient();

// Wire BullMQ worker events for logging
indexEmailsWorker.on('completed', (job) => {
  console.log(`[BullMQ] Job ${job.id} completed successfully.`);
});
indexEmailsWorker.on('failed', (job, err) => {
  console.error(`[BullMQ] Job ${job?.id} failed with error:`, err);
});

async function main() {
  console.log('Worker starting...');
  console.log('[Worker] BullMQ indexEmailsWorker is listening...');

  // Subscribe to 'email.received' topic
  await EventBus.subscribe('email.received', async (payload: { emailId: string }) => {
    const { emailId } = payload;
    console.log(`[Worker] Received email.received event! emailId: ${emailId}`);

    try {
      // 1. Fetch the email from database
      const email = await prisma.email.findUnique({
        where: { id: emailId },
      });

      if (!email) {
        console.error(`[Worker] Email with ID ${emailId} not found in database.`);
        return;
      }

      console.log(`[Worker] Processing email classification for: "${email.subject}"`);

      // 2. Classify email using AIService
      const result = await AIService.classifyEmail(email.subject, email.body);
      console.log(`[Worker] Classification result for "${email.subject}": category = ${result.category}, confidence = ${result.confidence}, deadlines = ${JSON.stringify(result.deadlines)}`);

      // 3. Update the email with the category
      await prisma.email.update({
        where: { id: email.id },
        data: {
          category: result.category,
        },
      });

      // Upsert the email analysis with deadlines
      await prisma.emailAnalysis.upsert({
        where: { emailId: email.id },
        update: {
          deadlines: result.deadlines,
          category: result.category,
          confidenceScore: result.confidence,
        },
        create: {
          emailId: email.id,
          deadlines: result.deadlines,
          category: result.category,
          confidenceScore: result.confidence,
        },
      });

      console.log(`[Worker] Email and EmailAnalysis updated successfully!`);

      // 4. Extract and save actions
      console.log(`[Worker] Extracting actions for: "${email.subject}"`);
      const actionItems = await AIService.extractActionItems(email.subject, email.body);
      
      if (actionItems && actionItems.length > 0) {
        console.log(`[Worker] Found ${actionItems.length} action items. Saving...`);
        
        // Remove any existing action items for this email to avoid duplicates on reprocessing
        await prisma.actionItem.deleteMany({
          where: { emailId: email.id },
        });

        await prisma.actionItem.createMany({
          data: actionItems.map((item) => ({
            emailId: email.id,
            taskDescription: item.taskDescription,
            isCompleted: false,
            deadline: item.deadline ? new Date(item.deadline) : null,
          })),
        });
        console.log(`[Worker] Saved action items successfully.`);
      } else {
        console.log(`[Worker] No action items extracted.`);
      }

    } catch (error: any) {
      console.error(`[Worker] Classification failed for emailId ${emailId}:`, error.message || error);
      
      // Mark email status as 'FAILED'
      try {
        await prisma.email.update({
          where: { id: emailId },
          data: {
            status: 'FAILED',
          },
        });
        console.log(`[Worker] Updated email ${emailId} status to 'FAILED'.`);
      } catch (dbError) {
        console.error(`[Worker] Failed to update email ${emailId} status to 'FAILED':`, dbError);
      }
    }
  });

  console.log('Worker is listening for email.received events...');
}

main().catch((error) => {
  console.error('Worker failed to start:', error);
  process.exit(1);
});

