import { AIService } from './ai.service';
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

export interface ExtractedExpense {
  merchant: string | null;
  amount: number | null;
  currency: string;
  category: string | null;
  date: string | null;
  raw: string;
}

export class ExpenseExtractorService {
  /**
   * Use AI to extract expense/receipt information from an email.
   */
  public static async extractFromEmail(email: { subject: string; body: string; sender: string }): Promise<ExtractedExpense | null> {
    const prompt = `You are an expense extraction assistant. Extract receipt/expense data from the following email and respond ONLY with a valid JSON object (no explanation, no markdown).

Required JSON format:
{
  "merchant": "string or null",
  "amount": number or null,
  "currency": "USD" (default) or detected currency code,
  "category": "food" | "travel" | "software" | "utilities" | "other" or null,
  "date": "ISO 8601 date string or null"
}

Email Subject: ${email.subject}
Email From: ${email.sender}
Email Body:
${email.body.substring(0, 3000)}`;

    try {
      logger.info('[ExpenseExtractor] Extracting expense from email', { subject: email.subject });
      const raw = await AIService.generateReply(prompt);

      // Parse the JSON response
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warn('[ExpenseExtractor] No JSON found in AI response');
        return null;
      }

      const parsed: any = JSON.parse(jsonMatch[0]);

      // Check if there's any meaningful expense data
      if (!parsed.merchant && !parsed.amount) {
        logger.info('[ExpenseExtractor] No expense data found in email');
        return null;
      }

      return {
        merchant: parsed.merchant || null,
        amount: typeof parsed.amount === 'number' ? parsed.amount : null,
        currency: parsed.currency || 'USD',
        category: parsed.category || null,
        date: parsed.date || null,
        raw,
      };
    } catch (err: any) {
      logger.error('[ExpenseExtractor] Extraction failed:', err.message);
      return null;
    }
  }
}
