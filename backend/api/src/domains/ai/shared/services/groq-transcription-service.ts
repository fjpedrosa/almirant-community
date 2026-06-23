import { env, logger } from "@almirant/config";

const GROQ_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

export interface TranscriptionResult {
  text: string;
}

export interface TranscriptionError {
  error: string;
  code: string;
}

/**
 * Check if Groq transcription is configured
 */
export function isGroqConfigured(): boolean {
  return !!env.GROQ_API_KEY;
}

/**
 * Transcribe audio using Groq Whisper API
 * @param buffer - Audio file buffer
 * @param filename - Original filename (used for extension detection)
 * @param mimeType - MIME type of the audio file
 * @param language - Optional language code (e.g., "es", "en")
 * @returns Transcribed text
 */
export async function transcribeAudio(
  buffer: Uint8Array,
  filename: string,
  mimeType: string,
  language?: string
): Promise<TranscriptionResult> {
  if (!isGroqConfigured()) {
    throw new Error("Groq transcription service is not configured. Set GROQ_API_KEY.");
  }

  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(`File size exceeds limit of 25MB. Current size: ${(buffer.length / 1024 / 1024).toFixed(2)}MB`);
  }

  // Create form data
  const formData = new FormData();
  // Bun's Blob constructor accepts Uint8Array directly
  const blob = new Blob([buffer], { type: mimeType });
  formData.append("file", blob, filename);
  formData.append("model", env.GROQ_WHISPER_MODEL);

  if (language) {
    formData.append("language", language);
  }

  try {
    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `Groq API error: ${response.status}`;

      try {
        const errorJson = JSON.parse(errorText) as TranscriptionError;
        if (errorJson.error) {
          errorMessage = errorJson.error;
        }
      } catch {
        // Use default error message if JSON parsing fails
        if (errorText) {
          errorMessage = errorText;
        }
      }

      logger.error(
        { status: response.status, error: errorText },
        "Groq transcription API error"
      );

      throw new Error(errorMessage);
    }

    const result = (await response.json()) as TranscriptionResult;

    logger.info(
      { filename, mimeType, language, textLength: result.text.length },
      "Groq transcription completed"
    );

    return result;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Unknown error during transcription");
  }
}
