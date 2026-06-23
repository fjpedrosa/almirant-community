/**
 * Invoice Parser Service
 *
 * Extracts structured data from invoice images using OpenAI GPT-4o vision.
 * Returns null if OPENAI_API_KEY is not configured or on any parsing error.
 */

import { ChatOpenAI } from '@langchain/openai';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { env, logger } from '@almirant/config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedInvoiceData {
  vendor: string | null;
  amount: string | null;
  currency: string | null;
  date: string | null;
  description: string | null;
  invoiceNumber: string | null;
  taxAmount: string | null;
  confidence: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INVOICE_SYSTEM_PROMPT = `You are an invoice data extraction assistant.

Analyze the invoice image and extract the following fields as a JSON object:
- vendor: The name of the vendor or seller (string or null)
- amount: The total amount due (string or null, e.g. "123.45")
- currency: The currency code or symbol (string or null, e.g. "USD", "EUR", "$")
- date: The invoice date (string or null, e.g. "2024-03-07" or as it appears)
- description: A brief description of the goods or services (string or null)
- invoiceNumber: The invoice number or reference (string or null)
- taxAmount: The tax amount if present (string or null)

Rules:
- Return valid JSON only, no markdown fences, no explanation.
- Use null for any field you cannot determine from the image.
- Preserve numbers as strings to avoid precision loss.

Output JSON schema:
{
  "vendor": "string | null",
  "amount": "string | null",
  "currency": "string | null",
  "date": "string | null",
  "description": "string | null",
  "invoiceNumber": "string | null",
  "taxAmount": "string | null"
}`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true if OPENAI_API_KEY is configured in the environment.
 */
export const isInvoiceParsingConfigured = (): boolean => {
  return Boolean(env.OPENAI_API_KEY);
};

/**
 * Parses an invoice image buffer and returns structured invoice data.
 *
 * @param imageBuffer - Raw image data as a Buffer
 * @param mimeType - MIME type of the image (e.g. "image/jpeg", "image/png")
 * @returns Parsed invoice data or null if parsing failed or AI is not configured
 */
export const parseInvoice = async (
  imageBuffer: Buffer,
  mimeType: string
): Promise<ParsedInvoiceData | null> => {
  if (!isInvoiceParsingConfigured()) {
    logger.warn(
      '[invoice-parser-service] OPENAI_API_KEY is not configured, skipping invoice parsing'
    );
    return null;
  }

  try {
    const base64 = imageBuffer.toString('base64');
    const dataUri = `data:${mimeType};base64,${base64}`;

    const model = new ChatOpenAI({
      modelName: 'gpt-4o',
      apiKey: env.OPENAI_API_KEY,
      temperature: 0,
    });

    const response = await model.invoke([
      new SystemMessage(INVOICE_SYSTEM_PROMPT),
      new HumanMessage({
        content: [
          {
            type: 'text',
            text: 'Extract invoice data as JSON from the following invoice image. Return only valid JSON with the fields specified.',
          },
          {
            type: 'image_url',
            image_url: { url: dataUri },
          },
        ],
      }),
    ]);

    const rawContent =
      typeof response.content === 'string'
        ? response.content
        : String(response.content);

    // Strip potential markdown code fences
    const cleaned = rawContent
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const parsed = JSON.parse(cleaned) as Omit<ParsedInvoiceData, 'confidence'>;

    // Calculate confidence based on how many non-null fields were extracted
    const fields: (keyof Omit<ParsedInvoiceData, 'confidence'>)[] = [
      'vendor',
      'amount',
      'currency',
      'date',
      'description',
      'invoiceNumber',
      'taxAmount',
    ];
    const extractedCount = fields.filter((f) => parsed[f] !== null && parsed[f] !== undefined).length;
    const confidence = extractedCount / fields.length;

    const result: ParsedInvoiceData = {
      vendor: parsed.vendor ?? null,
      amount: parsed.amount ?? null,
      currency: parsed.currency ?? null,
      date: parsed.date ?? null,
      description: parsed.description ?? null,
      invoiceNumber: parsed.invoiceNumber ?? null,
      taxAmount: parsed.taxAmount ?? null,
      confidence,
    };

    logger.info(
      { confidence, extractedCount, totalFields: fields.length },
      '[invoice-parser-service] Invoice parsed successfully'
    );

    return result;
  } catch (err) {
    logger.error(
      { error: err },
      '[invoice-parser-service] Failed to parse invoice'
    );
    return null;
  }
};
