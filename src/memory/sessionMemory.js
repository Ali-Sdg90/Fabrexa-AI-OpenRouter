import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    CHAT_MEMORY_DIR,
    SESSION_MEMORY_MAX_PROMPT_TOKENS,
    SESSION_MEMORY_PROMPT_PATH,
} from "../config/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const memoryRoot = path.join(__dirname, "..", "..", CHAT_MEMORY_DIR);
const SESSION_MEMORY_CATEGORIES = new Set([
    "character_state",
    "relationship",
    "event",
    "goal",
    "setting",
    "object_state",
    "emotional_shift",
    "continuity",
]);
const SESSION_MEMORY_SOURCES = new Set(["user", "assistant", "exchange"]);
const MAX_ENTRIES_PER_TURN = 8;
const MAX_ENTRY_LENGTH = 500;
const writeQueues = new Map();
let promptPromise = null;

function normalizedIdentifier(value, label) {
    const normalized = String(value ?? "").trim();
    if (!normalized || /[\\/\0]/.test(normalized) || normalized === "." || normalized === "..") {
        throw new TypeError(`${label} is invalid.`);
    }
    return normalized;
}

function nowIso() {
    return new Date().toISOString();
}

function createEmptyMemory(chatId, sessionId) {
    return {
        version: 1,
        chatId: String(chatId),
        sessionId: Number(sessionId),
        updatedAt: null,
        entries: [],
    };
}

function validateSessionId(sessionId) {
    const value = Number(sessionId);
    if (!Number.isInteger(value) || value < 1) {
        throw new TypeError("sessionId must be a positive integer.");
    }
    return value;
}

export function getSessionDirectory(chatId, sessionId) {
    const safeChatId = normalizedIdentifier(chatId, "chatId");
    const safeSessionId = validateSessionId(sessionId);
    return path.join(memoryRoot, safeChatId, "sessions", String(safeSessionId));
}

export function getSessionChatPath(chatId, sessionId) {
    return path.join(getSessionDirectory(chatId, sessionId), "chat.txt");
}

export function getSessionMemoryPath(chatId, sessionId) {
    return path.join(getSessionDirectory(chatId, sessionId), "session-memory.json");
}

async function writeJsonAtomically(filePath, value) {
    const temporaryPath = `${filePath}.tmp-${randomUUID()}`;
    try {
        await fs.writeFile(
            temporaryPath,
            `${JSON.stringify(value, null, 2)}\n`,
            "utf8",
        );
        await fs.rename(temporaryPath, filePath);
    } catch (error) {
        await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
        throw error;
    }
}

async function createFileIfMissing(filePath, content) {
    try {
        await fs.writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
    } catch (error) {
        if (error?.code !== "EEXIST") throw error;
    }
}

export async function ensureSessionData({ chatId, sessionId, legacyChatPath }) {
    const directory = getSessionDirectory(chatId, sessionId);
    const chatPath = getSessionChatPath(chatId, sessionId);
    const memoryPath = getSessionMemoryPath(chatId, sessionId);
    await fs.mkdir(directory, { recursive: true });

    let initialChat = `--- New chat session ${sessionId} ---\n`;
    if (legacyChatPath) {
        try {
            initialChat = await fs.readFile(legacyChatPath, "utf8");
        } catch (error) {
            if (error?.code !== "ENOENT") throw error;
        }
    }
    await createFileIfMissing(chatPath, initialChat);
    await createFileIfMissing(
        memoryPath,
        `${JSON.stringify(createEmptyMemory(chatId, sessionId), null, 2)}\n`,
    );

    return Object.freeze({ directory, chatPath, memoryPath });
}

function validateStoredMemory(value, filePath, chatId, sessionId) {
    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        value.version !== 1 ||
        String(value.chatId) !== String(chatId) ||
        Number(value.sessionId) !== Number(sessionId) ||
        !Array.isArray(value.entries)
    ) {
        throw new Error(`Invalid session memory data at "${filePath}".`);
    }

    for (const entry of value.entries) {
        if (
            !Number.isInteger(entry?.sequence) ||
            entry.sequence < 1 ||
            !Number.isInteger(entry?.turn) ||
            entry.turn < 1 ||
            !SESSION_MEMORY_SOURCES.has(entry?.source) ||
            !SESSION_MEMORY_CATEGORIES.has(entry?.category) ||
            typeof entry?.content !== "string" ||
            !entry.content.trim() ||
            typeof entry?.createdAt !== "string"
        ) {
            throw new Error(`Invalid session memory entry at "${filePath}".`);
        }
    }
    return value;
}

export async function loadSessionMemory(chatId, sessionId) {
    const memoryPath = getSessionMemoryPath(chatId, sessionId);
    const parsed = JSON.parse(await fs.readFile(memoryPath, "utf8"));
    return validateStoredMemory(parsed, memoryPath, chatId, sessionId);
}

function extractJsonObject(rawText) {
    const trimmed = String(rawText || "").trim();
    if (!trimmed) return null;
    try {
        return JSON.parse(trimmed);
    } catch {
        const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
        if (fenced) {
            try {
                return JSON.parse(fenced.trim());
            } catch {}
        }
        const objectText = trimmed.match(/\{[\s\S]*\}/)?.[0];
        if (!objectText) return null;
        try {
            return JSON.parse(objectText);
        } catch {
            return null;
        }
    }
}

export function normalizeSessionMemoryAnalysis(rawText) {
    const parsed = extractJsonObject(rawText);
    if (!parsed || !Array.isArray(parsed.entries)) return [];

    return parsed.entries.slice(0, MAX_ENTRIES_PER_TURN).flatMap((entry) => {
        const source = String(entry?.source || "").trim().toLowerCase();
        const category = String(entry?.category || "").trim().toLowerCase();
        const content = String(entry?.content || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, MAX_ENTRY_LENGTH);
        if (
            !SESSION_MEMORY_SOURCES.has(source) ||
            !SESSION_MEMORY_CATEGORIES.has(category) ||
            !content
        ) {
            return [];
        }
        return [{ source, category, content }];
    });
}

function canonicalContent(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, "")
        .replace(/\s+/g, " ");
}

function enqueueWrite(memoryPath, operation) {
    const previous = writeQueues.get(memoryPath) || Promise.resolve();
    const queued = previous.then(operation);
    const tracked = queued.catch(() => undefined);
    writeQueues.set(memoryPath, tracked);
    return queued.finally(() => {
        if (writeQueues.get(memoryPath) === tracked) {
            writeQueues.delete(memoryPath);
        }
    });
}

export async function appendSessionMemoryEntries({ chatId, sessionId, entries }) {
    if (!Array.isArray(entries) || entries.length === 0) return [];
    const memoryPath = getSessionMemoryPath(chatId, sessionId);

    return enqueueWrite(memoryPath, async () => {
        const memory = await loadSessionMemory(chatId, sessionId);
        const existing = new Set(
            memory.entries.map((entry) => canonicalContent(entry.content)),
        );
        let nextSequence =
            memory.entries.reduce(
                (maximum, entry) => Math.max(maximum, entry.sequence),
                0,
            ) + 1;
        const turn =
            memory.entries.reduce(
                (maximum, entry) => Math.max(maximum, entry.turn),
                0,
            ) + 1;
        const createdAt = nowIso();
        const added = [];

        for (const entry of entries) {
            const canonical = canonicalContent(entry.content);
            if (!canonical || existing.has(canonical)) continue;
            existing.add(canonical);
            const stored = {
                sequence: nextSequence,
                turn,
                createdAt,
                source: entry.source,
                category: entry.category,
                content: entry.content,
            };
            nextSequence += 1;
            memory.entries.push(stored);
            added.push(stored);
        }

        if (added.length > 0) {
            memory.updatedAt = createdAt;
            await writeJsonAtomically(memoryPath, memory);
        }
        return added;
    });
}

function estimateTokens(value) {
    let ascii = 0;
    let nonAscii = 0;
    for (const character of String(value || "")) {
        if (character.codePointAt(0) <= 0x7f) ascii += 1;
        else nonAscii += 1;
    }
    return Math.ceil(ascii / 4 + nonAscii);
}

export function formatSessionMemoryForPrompt(memory) {
    const lines = [];
    let usedTokens = 0;
    for (let index = memory.entries.length - 1; index >= 0; index -= 1) {
        const entry = memory.entries[index];
        const line = `[${entry.sequence}] ${entry.category} (${entry.source}): ${entry.content}`;
        const tokens = estimateTokens(line);
        if (usedTokens + tokens > SESSION_MEMORY_MAX_PROMPT_TOKENS) break;
        lines.unshift(line);
        usedTokens += tokens;
    }
    return lines.join("\n");
}

export async function getSessionMemoryForPrompt(chatId, sessionId) {
    const memory = await loadSessionMemory(chatId, sessionId);
    return formatSessionMemoryForPrompt(memory);
}

async function loadAnalysisPrompt() {
    if (!promptPromise) {
        promptPromise = fs.readFile(SESSION_MEMORY_PROMPT_PATH, "utf8").then((raw) => {
            const prompt = raw.trim();
            if (!prompt) throw new Error("The session-memory prompt file is empty.");
            return prompt;
        });
    }
    return promptPromise;
}

export async function initializeSessionMemoryAnalyzer() {
    await loadAnalysisPrompt();
}

export async function analyzeAndSaveSessionTurn({
    chatId,
    sessionId,
    userMessage,
    assistantMessage,
    aiClient,
}) {
    const startedAt = Date.now();
    const prompt = await loadAnalysisPrompt();
    const rawAnalysis = await aiClient.analyzeSessionMemory(
        userMessage,
        assistantMessage,
        prompt,
    );
    const entries = normalizeSessionMemoryAnalysis(rawAnalysis);
    const added = await appendSessionMemoryEntries({ chatId, sessionId, entries });
    console.log(
        `Session memory analyzed for chat ${chatId}, session ${sessionId}: ${added.length} entr${added.length === 1 ? "y" : "ies"} added in ${Date.now() - startedAt}ms.`,
    );
    return added;
}
