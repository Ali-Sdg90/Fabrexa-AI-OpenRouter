/**
 * Memory module.
 * Manages chat sessions, personality state, transcripts, and continuity memory.
 */

import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
    CHAT_HISTORY_MAX_MESSAGES,
    CHAT_MEMORY_DIR,
    DEFAULT_PERSONALITY,
} from "../config/index.js";
import {
    ensureSessionData,
    getSessionChatPath,
    getSessionMemoryForPrompt as loadSessionMemoryForPrompt,
} from "./sessionMemory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storageRoot = path.join(__dirname, "..", "..", CHAT_MEMORY_DIR);

function getChatFolder(chatId) {
    return path.join(storageRoot, String(chatId));
}

function getMetaPath(chatId) {
    return path.join(getChatFolder(chatId), "meta.json");
}

function getLegacySessionPath(chatId, sessionId) {
    return path.join(getChatFolder(chatId), `session_${sessionId}.txt`);
}

async function ensureChatSession(chatId, sessionId) {
    return ensureSessionData({
        chatId,
        sessionId,
        legacyChatPath: getLegacySessionPath(chatId, sessionId),
    });
}

async function ensureChatFolder(chatId) {
    const chatFolder = getChatFolder(chatId);
    await fs.mkdir(chatFolder, { recursive: true });
    return chatFolder;
}

async function loadMeta(chatId) {
    await ensureChatFolder(chatId);
    const metaPath = getMetaPath(chatId);
    if (!existsSync(metaPath)) {
        return {
            currentSession: 1,
            personality: DEFAULT_PERSONALITY,
        };
    }

    try {
        const rawMeta = await fs.readFile(metaPath, "utf-8");
        return JSON.parse(rawMeta);
    } catch {
        return {
            currentSession: 1,
            personality: DEFAULT_PERSONALITY,
        };
    }
}

async function saveMeta(chatId, meta) {
    await ensureChatFolder(chatId);
    const metaPath = getMetaPath(chatId);
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
}

export async function getChatState(chatId) {
    const meta = await loadMeta(chatId);
    await ensureChatSession(chatId, meta.currentSession);
    return meta;
}

export async function createNewChatSession(chatId) {
    const meta = await loadMeta(chatId);
    const nextSession = meta.currentSession + 1;
    meta.currentSession = nextSession;
    await saveMeta(chatId, meta);
    await ensureChatSession(chatId, nextSession);
    return meta;
}

export async function updateChatPersonality(chatId, personality) {
    const meta = await loadMeta(chatId);
    meta.personality = personality;
    await saveMeta(chatId, meta);
    return meta;
}

export async function appendChatMessage(
    chatId,
    role,
    message,
    personalityName = null,
    sessionId = null,
) {
    const meta = await loadMeta(chatId);
    const targetSession = sessionId ?? meta.currentSession;
    await ensureChatSession(chatId, targetSession);
    const sessionPath = getSessionChatPath(chatId, targetSession);
    const timestamp = new Date()
        .toISOString()
        .replace("T", " ")
        .replace("Z", "");
    const prefix =
        role === "user"
            ? "User"
            : personalityName
              ? personalityName
              : "Assistant";
    const entry = `[${timestamp}] ${prefix}: ${message.trim()}\n`;
    await fs.appendFile(sessionPath, entry, "utf-8");
}

export async function appendChatArtifact(chatId, label, message, sessionId = null) {
    const meta = await loadMeta(chatId);
    const targetSession = sessionId ?? meta.currentSession;
    await ensureChatSession(chatId, targetSession);
    const sessionPath = getSessionChatPath(chatId, targetSession);
    const timestamp = new Date()
        .toISOString()
        .replace("T", " ")
        .replace("Z", "");
    const cleanLabel = String(label || "Artifact").replace(/[:\r\n]/g, " ").trim();
    const cleanMessage = String(message || "").replace(/\s+/g, " ").trim();
    if (!cleanMessage) return;
    await fs.appendFile(
        sessionPath,
        `[${timestamp}] Artifact(${cleanLabel}): ${cleanMessage}\n`,
        "utf-8",
    );
}

function normalizeConversation(entries) {
    const normalized = [];

    for (const entry of entries) {
        if (!entry?.role || !entry?.content) continue;
        const role = entry.role === "user" ? "user" : "assistant";
        const content = entry.content.trim();
        if (!content) continue;

        if (normalized.length === 0) {
            if (role === "assistant") continue;
            normalized.push({ role, content });
            continue;
        }

        const lastRole = normalized[normalized.length - 1].role;
        if (lastRole === role) {
            normalized[normalized.length - 1].content += `\n${content}`;
        } else {
            normalized.push({ role, content });
        }
    }

    return normalized;
}

export async function loadRecentConversation(
    chatId,
    maxMessages = CHAT_HISTORY_MAX_MESSAGES,
    sessionId = null,
) {
    const meta = await loadMeta(chatId);
    const targetSession = sessionId ?? meta.currentSession;
    await ensureChatSession(chatId, targetSession);
    const sessionPath = getSessionChatPath(chatId, targetSession);
    if (!existsSync(sessionPath)) {
        return [];
    }

    const raw = await fs.readFile(sessionPath, "utf-8");
    return parseSessionHistory(raw, maxMessages);
}

export function parseSessionHistory(
    raw,
    maxMessages = CHAT_HISTORY_MAX_MESSAGES,
) {
    const lines = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    const parsed = [];

    for (const line of lines) {
        const messageMatch = line.match(/^\[[^\]]+\]\s+([^:]+):\s?(.*)$/);
        if (messageMatch) {
            if (messageMatch[1].startsWith("Artifact(")) {
                continue;
            }
            parsed.push({
                role: messageMatch[1] === "User" ? "user" : "assistant",
                content: messageMatch[2],
            });
            continue;
        }

        if (parsed.length > 0) {
            parsed[parsed.length - 1].content += `\n${line}`;
        }
    }

    const normalized = normalizeConversation(parsed);
    const limit = Math.max(0, Math.floor(maxMessages));
    return limit === 0 ? [] : normalized.slice(-limit);
}

export async function ensureChatDataDirectory() {
    await fs.mkdir(storageRoot, { recursive: true });
}

export async function getSessionMemoryForPrompt(chatId, sessionId = null) {
    const meta = await loadMeta(chatId);
    const targetSession = sessionId ?? meta.currentSession;
    await ensureChatSession(chatId, targetSession);
    return loadSessionMemoryForPrompt(chatId, targetSession);
}
