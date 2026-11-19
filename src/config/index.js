/**
 * Main configuration for Fabrexa AI Bot.
 * Loads environment variables and provides runtime configuration.
 */

import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: ".env" });

function readNumber(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readNonNegativeInteger(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function readBoolean(name, fallback) {
    const value = process.env[name]?.trim().toLowerCase();
    if (!value) return fallback;
    if (["1", "true", "yes", "on"].includes(value)) return true;
    if (["0", "false", "no", "off"].includes(value)) return false;
    return fallback;
}

function trimTrailingSlash(value) {
    return value.replace(/\/+$/, "");
}

function readLoopbackHttpUrl(name, fallback) {
    const rawValue = process.env[name]?.trim() || fallback;
    let url;
    try {
        url = new URL(rawValue);
    } catch {
        throw new Error(`${name} must be a valid URL.`);
    }
    if (
        url.protocol !== "http:" ||
        !new Set(["127.0.0.1", "localhost", "[::1]"]).has(url.hostname) ||
        url.username ||
        url.password ||
        !["", "/"].includes(url.pathname)
    ) {
        throw new Error(
            `${name} must be an HTTP loopback URL without credentials or a path.`,
        );
    }
    return trimTrailingSlash(url.toString());
}

function parseAdditionalSeedMappings(value) {
    if (!value?.trim()) return [];

    return value.split(",").map((mapping) => {
        const [nodeId, inputName, ...extra] = mapping
            .split(":")
            .map((part) => part.trim());
        if (!nodeId || !inputName || extra.length > 0) {
            throw new Error(
                "COMFYUI_ADDITIONAL_SEED_MAPPINGS must use comma-separated nodeId:inputName pairs.",
            );
        }
        return Object.freeze({ nodeId, inputName });
    });
}

// Telegram configuration
export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN?.trim();
if (!TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is not set. Add it to your .env file.");
}

export const BOT_PRIVATE = readBoolean("BOT_PRIVATE", true);
export const OWNER_ID = Number(process.env.OWNER_ID?.trim());
if (BOT_PRIVATE && !Number.isInteger(OWNER_ID)) {
    throw new Error(
        "OWNER_ID must be a numeric Telegram user id when BOT_PRIVATE is true.",
    );
}
export const OWNER_USERNAME = (process.env.OWNER_USERNAME || "")
    .trim()
    .replace(/^@/, "");
if (BOT_PRIVATE && !/^[A-Za-z0-9_]{5,32}$/.test(OWNER_USERNAME)) {
    throw new Error(
        "OWNER_USERNAME must be a valid Telegram username when BOT_PRIVATE is true.",
    );
}

// Groq configuration
export const GROQ_API_KEY = process.env.GROQ_API_KEY?.trim();
if (!GROQ_API_KEY) {
    throw new Error(
        "GROQ_API_KEY is not set. Add it to your .env file.",
    );
}
export const GROQ_BASE_URL = trimTrailingSlash(
    process.env.GROQ_BASE_URL?.trim() ||
        "https://api.groq.com/openai/v1",
);
export const GROQ_CHAT_URL = `${GROQ_BASE_URL}/chat/completions`;
export const GROQ_MODEL =
    process.env.GROQ_MODEL?.trim() ||
    process.env.AI_MODEL?.trim() ||
    process.env.MODEL?.trim() ||
    "qwen/qwen3.8-27b";
// Chat, session-memory analysis, and scene direction share one text model.
export const GROQ_ANALYZER_MODEL = GROQ_MODEL;
export const GROQ_CONTEXT_WINDOW = readNumber(
    "GROQ_CONTEXT_WINDOW",
    131072,
);
export const GROQ_TEMPERATURE = readNumber(
    "GROQ_TEMPERATURE",
    0.7,
);
export const GROQ_TOP_P = readNumber("GROQ_TOP_P", 0.8);
export const GROQ_MAX_TOKENS = readNumber(
    "GROQ_MAX_TOKENS",
    2048,
);
export const GROQ_MIN_RESPONSE_WORDS = readNonNegativeInteger(
    "GROQ_MIN_RESPONSE_WORDS",
    250,
);
export const GROQ_MAX_CONTINUATIONS = readNonNegativeInteger(
    "GROQ_MAX_CONTINUATIONS",
    2,
);
export const GROQ_REASONING_EFFORT =
    process.env.GROQ_REASONING_EFFORT?.trim() || "none";
export const CHAT_HISTORY_MAX_MESSAGES = Math.floor(
    readNumber("CHAT_HISTORY_MAX_MESSAGES", 24),
);
export const CHAT_HISTORY_MAX_TOKENS = Math.floor(
    readNumber("CHAT_HISTORY_MAX_TOKENS", 4096),
);
export const SESSION_MEMORY_PROMPT_PATH = path.resolve(
    process.env.SESSION_MEMORY_PROMPT_PATH?.trim() ||
        "src/memory/session-memory-prompt.txt",
);
export const SESSION_MEMORY_MAX_PROMPT_TOKENS = Math.floor(
    readNumber("SESSION_MEMORY_MAX_PROMPT_TOKENS", 2048),
);

// Logging configuration
export const LOG_LEVEL = process.env.LOG_LEVEL || "INFO";
export const LOG_MODE = (process.env.LOG_MODE || "normal").trim().toLowerCase();
export const IS_DEV_LOG_MODE = new Set([
    "dev",
    "development",
    "dev-mode",
    "debug",
    "verbose",
]).has(LOG_MODE);

// Chat session storage
export const CHAT_MEMORY_DIR = "chat_memory";
export const PERSONALITY_DIR = path.join("personalities", "prompts");
export const PERSONALITY_APPEARANCE_DIR = path.join(
    "personalities",
    "appearances",
);
export const DEFAULT_PERSONALITY = "Friendly";

// Request configuration.
export const REQUEST_TIMEOUT = readNumber("REQUEST_TIMEOUT", 120000);
export const MAX_MESSAGE_LENGTH = 4096; // Telegram message limit
export const TELEGRAM_STREAM_EDIT_INTERVAL_MS = readNumber(
    "TELEGRAM_STREAM_EDIT_INTERVAL_MS",
    6000,
);

// Optional image continuation. It is enabled for every personality by default,
// while each Telegram account can persistently opt out.
export const IMAGE_GENERATION_AVAILABLE = readBoolean(
    "IMAGE_GENERATION_AVAILABLE",
    true,
);
export const IMAGE_GENERATION_DEFAULT_ENABLED = readBoolean(
    "IMAGE_GENERATION_DEFAULT_ENABLED",
    true,
);
export const IMAGE_GENERATION_QUEUE_MAX_SIZE = Math.floor(
    readNumber("IMAGE_GENERATION_QUEUE_MAX_SIZE", 5),
);
export const IMAGE_SCENE_DIRECTOR_PROMPT_PATH = path.resolve(
    process.env.IMAGE_SCENE_DIRECTOR_PROMPT_PATH?.trim() ||
        "src/image/scene-director.txt",
);
export const IMAGE_ADDITIONAL_SCENE_PROMPT_PATH = path.resolve(
    process.env.IMAGE_ADDITIONAL_SCENE_PROMPT_PATH?.trim() ||
        "src/image/additional-scene-prompt.txt",
);
export const IMAGE_USER_DATA_DIR = path.resolve(
    CHAT_MEMORY_DIR,
    "users",
);
export const IMAGE_USER_PROMPT_HISTORY_LIMIT = Math.floor(
    readNumber("IMAGE_USER_PROMPT_HISTORY_LIMIT", 50),
);

export const IMAGE_DIRECTOR_TEMPERATURE = readNumber(
    "IMAGE_DIRECTOR_TEMPERATURE",
    0.35,
);
export const IMAGE_DIRECTOR_TOP_P = readNumber("IMAGE_DIRECTOR_TOP_P", 0.9);
export const IMAGE_DIRECTOR_MAX_TOKENS = Math.floor(
    readNumber("IMAGE_DIRECTOR_MAX_TOKENS", 700),
);

export const COMFYUI_BASE_URL = readLoopbackHttpUrl(
    "COMFYUI_BASE_URL",
    "http://127.0.0.1:8188",
);
export const COMFYUI_WORKFLOW_PATH = path.resolve(
    process.env.COMFYUI_WORKFLOW_PATH?.trim() ||
        "src/image/workflow_api.json",
);
export const COMFYUI_CHECKPOINT_NAME =
    process.env.COMFYUI_CHECKPOINT_NAME?.trim() || "";
export const COMFYUI_POLL_INTERVAL_MS = readNumber(
    "COMFYUI_POLL_INTERVAL_MS",
    2000,
);
export const COMFYUI_TIMEOUT_MS = readNumber("COMFYUI_TIMEOUT_MS", 240000);
export const COMFYUI_REQUEST_TIMEOUT_MS = readNumber(
    "COMFYUI_REQUEST_TIMEOUT_MS",
    10000,
);
export const COMFYUI_IDLE_TIMEOUT_MS = readNumber(
    "COMFYUI_IDLE_TIMEOUT_MS",
    300000,
);
export const COMFYUI_POSITIVE_PROMPT_NODE_ID =
    process.env.COMFYUI_POSITIVE_PROMPT_NODE_ID?.trim() || "67";
export const COMFYUI_POSITIVE_PROMPT_INPUT =
    process.env.COMFYUI_POSITIVE_PROMPT_INPUT?.trim() || "text";
export const COMFYUI_CHECKPOINT_NODE_ID =
    process.env.COMFYUI_CHECKPOINT_NODE_ID?.trim() || "73";
export const COMFYUI_CHECKPOINT_INPUT =
    process.env.COMFYUI_CHECKPOINT_INPUT?.trim() || "ckpt_name";
export const COMFYUI_SEED_NODE_ID =
    process.env.COMFYUI_SEED_NODE_ID?.trim() || "94";
export const COMFYUI_SEED_INPUT =
    process.env.COMFYUI_SEED_INPUT?.trim() || "seed";
export const COMFYUI_ADDITIONAL_SEED_MAPPINGS = parseAdditionalSeedMappings(
    process.env.COMFYUI_ADDITIONAL_SEED_MAPPINGS,
);
export const COMFYUI_SAVE_IMAGE_NODE_ID =
    process.env.COMFYUI_SAVE_IMAGE_NODE_ID?.trim() || "84";

export const IMAGE_GENERATION_SETTINGS = Object.freeze({
    width: 896,
    height: 1152,
    steps: 8,
    cfg: 1.1,
    sampler: "LCM",
    scheduler: "Karras",
});
export const PERSONALITY_INSTRUCTION =
    process.env.PERSONALITY_INSTRUCTION?.trim() ||
    "Follow the selected personality and always respond with a substantial, fully developed answer.";
