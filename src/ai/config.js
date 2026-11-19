/**
 * AI client configuration for Groq.
 */

export {
    IS_DEV_LOG_MODE,
    GROQ_API_KEY,
    GROQ_CHAT_URL,
    GROQ_MODEL,
    GROQ_ANALYZER_MODEL,
    GROQ_CONTEXT_WINDOW,
    GROQ_TEMPERATURE,
    GROQ_TOP_P,
    GROQ_MAX_TOKENS,
    GROQ_MIN_RESPONSE_WORDS,
    GROQ_MAX_CONTINUATIONS,
    GROQ_REASONING_EFFORT,
    CHAT_HISTORY_MAX_MESSAGES,
    CHAT_HISTORY_MAX_TOKENS,
    PERSONALITY_INSTRUCTION,
    IMAGE_DIRECTOR_TEMPERATURE,
    IMAGE_DIRECTOR_TOP_P,
    IMAGE_DIRECTOR_MAX_TOKENS,
} from "../config/index.js";

// Backup system message if personality loading fails.
export const SYSTEM_MESSAGE = `
There was a problem with personality selection. Tell the user that the selected personality could not be loaded.
`.trim();
