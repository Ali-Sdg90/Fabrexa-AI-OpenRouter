import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { ImageConfigurationError } from "./errors.js";

function normalizeUser(user) {
    const id = String(user?.id ?? "");
    if (!/^\d+$/.test(id) || id === "0") {
        throw new ImageConfigurationError(
            "A positive Telegram user id is required for image preferences.",
        );
    }
    return {
        id,
        username: user?.username ?? null,
        firstName: user?.first_name ?? user?.firstName ?? null,
        lastName: user?.last_name ?? user?.lastName ?? null,
    };
}

function validateRecord(value, filePath) {
    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        typeof value.imageGenerationEnabled !== "boolean" ||
        !Array.isArray(value.scenePrompts)
    ) {
        throw new ImageConfigurationError(
            `Invalid image preference data at "${filePath}".`,
        );
    }
    return value;
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

export class ImagePreferenceService {
    #records = new Map();
    #writeQueue = Promise.resolve();

    constructor({ rootDirectory, defaultEnabled = true, promptHistoryLimit = 50 }) {
        this.rootDirectory = rootDirectory;
        this.defaultEnabled = defaultEnabled;
        this.promptHistoryLimit = promptHistoryLimit;
    }

    async initialize() {
        await fs.mkdir(this.rootDirectory, { recursive: true });
    }

    getPreference(user) {
        return this.#enqueue(async () => {
            const record = await this.#load(user);
            return record.imageGenerationEnabled;
        });
    }

    setPreference(user, enabled) {
        if (typeof enabled !== "boolean") {
            return Promise.reject(new TypeError("enabled must be a boolean."));
        }

        return this.#enqueue(async () => {
            const normalizedUser = normalizeUser(user);
            const record = await this.#load(normalizedUser);
            record.telegramUser = normalizedUser;
            record.imageGenerationEnabled = enabled;
            record.updatedAt = new Date().toISOString();
            await writeJsonAtomically(record.filePath, this.#serializable(record));
            return enabled;
        });
    }

    recordScenePrompt({ user, chatId, assistantResponse, scenePrompt }) {
        return this.#enqueue(async () => {
            const normalizedUser = normalizeUser(user);
            const record = await this.#load(normalizedUser);
            record.telegramUser = normalizedUser;
            const promptRecord = {
                id: randomUUID(),
                createdAt: new Date().toISOString(),
                chatId: String(chatId),
                source: "character_appearance_file_and_latest_messages_scene",
                assistantResponse,
                scenePrompt,
            };
            record.scenePrompts.push(promptRecord);
            record.scenePrompts = record.scenePrompts.slice(
                -this.promptHistoryLimit,
            );
            record.updatedAt = new Date().toISOString();
            await writeJsonAtomically(record.filePath, this.#serializable(record));
            return Object.freeze({ ...promptRecord });
        });
    }

    getScenePrompt({ user, chatId, promptId }) {
        return this.#enqueue(async () => {
            const record = await this.#load(user);
            const promptRecord = record.scenePrompts.find(
                (entry) =>
                    entry?.id === promptId &&
                    String(entry?.chatId) === String(chatId),
            );
            return promptRecord
                ? Object.freeze({ ...promptRecord })
                : null;
        });
    }

    #enqueue(operation) {
        const queued = this.#writeQueue.then(operation);
        this.#writeQueue = queued.catch(() => undefined);
        return queued;
    }

    async #load(user) {
        const normalizedUser = normalizeUser(user);
        const cached = this.#records.get(normalizedUser.id);
        if (cached) return cached;

        const userDirectory = path.join(this.rootDirectory, normalizedUser.id);
        const filePath = path.join(userDirectory, "image-generation.json");
        await fs.mkdir(userDirectory, { recursive: true });

        let record;
        try {
            const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
            record = validateRecord(parsed, filePath);
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
            record = {
                version: 1,
                telegramUser: normalizedUser,
                imageGenerationEnabled: this.defaultEnabled,
                updatedAt: null,
                scenePrompts: [],
            };
        }

        const cachedRecord = { ...record, filePath };
        await writeJsonAtomically(filePath, this.#serializable(cachedRecord));
        this.#records.set(normalizedUser.id, cachedRecord);
        return cachedRecord;
    }

    #serializable(record) {
        const value = { ...record };
        delete value.filePath;
        return value;
    }
}

