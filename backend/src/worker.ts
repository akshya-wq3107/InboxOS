import { EventBus } from './services/event-bus.service';
import { PrismaClient } from '@prisma/client';
import { AIService } from './services/ai.service';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();

export async function registerWorkerHandlers() {
  console.log('Registering email processing workers...');

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
      console.log(`[Worker] Classification result for "${email.subject}": category = ${result.category}, confidence = ${result.confidence}`);

      // 3. Update the email with the category
      await prisma.email.update({
        where: { id: email.id },
        data: {
          category: result.category,
        },
      });

      console.log(`[Worker] Email updated successfully!`);

      // 4. Extract and save actions
      console.log(`[Worker] Extracting actions for: "${email.subject}"`);
      const actions = await AIService.extractActions(email.subject, email.body);
      
      if (actions && actions.length > 0) {
        console.log(`[Worker] Found ${actions.length} action items. Saving...`);
        await prisma.actionItem.createMany({
          data: actions.map((task) => ({
            emailId: email.id,
            taskDescription: task,
            isCompleted: false,
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

  console.log('Worker handlers registered and listening for events.');
}

// Only run automatically if executed directly as the entry point
if (require.main === module || (process.argv[1] && process.argv[1].endsWith('worker.ts'))) {
  console.log('Worker starting as standalone process...');
  registerWorkerHandlers().catch((error) => {
    console.error('Worker failed to start:', error);
    process.exit(1);
  });
}
