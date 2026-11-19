import fs from "node:fs/promises";

import { ScenePromptError } from "./errors.js";

const LEADING_LABEL_PATTERN =
    /^(?:(?:positive|image(?:-generation)?)\s+)?prompt\s*:\s*/i;
const UNUSABLE_OPENING_PATTERN =
    /^(?:i\s+(?:cannot|can't|won't|am unable to)|sorry\b|as an ai\b|here(?:'s| is)\s+(?:the|your)\s+(?:prompt|image prompt))/i;
const UNWANTED_QUALITY_PREFIX =
    /^score_9,\s*score_8_up,\s*masterpiece,\s*best quality,\s*photorealistic,\s*cinematic photography,?\s*/i;
const UNWANTED_GENERIC_CONSTRAINTS =
    /(?:^|,\s*)(?:no text|no logos?|no watermark)(?=\s*,|\s*$)/gi;

export function normalizeScenePrompt(rawOutput) {
    if (typeof rawOutput !== "string") {
        throw new ScenePromptError("The scene director returned non-text output.");
    }

    let prompt = rawOutput.trim();
    if (prompt.startsWith("```") && prompt.endsWith("```")) {
        prompt = prompt
            .replace(/^```(?:text)?\s*/i, "")
            .replace(/\s*```$/, "")
            .trim();
    }
    if (
        (prompt.startsWith('"') && prompt.endsWith('"')) ||
        (prompt.startsWith("'") && prompt.endsWith("'"))
    ) {
        prompt = prompt.slice(1, -1).trim();
    }

    prompt = prompt
        .replace(LEADING_LABEL_PATTERN, "")
        .replace(UNWANTED_QUALITY_PREFIX, "")
        .replace(UNWANTED_GENERIC_CONSTRAINTS, "")
        .replace(/(?:,\s*){2,}/g, ", ")
        .replace(/^,\s*|,\s*$/g, "")
        .replace(/\s+/g, " ")
        .trim();
    if (!prompt) {
        throw new ScenePromptError("The scene director returned an empty prompt.");
    }
    if (UNUSABLE_OPENING_PATTERN.test(prompt)) {
        throw new ScenePromptError(
            "The scene director returned a conversational response instead of a prompt.",
        );
    }
    return prompt;
}

export class SceneDirectorService {
    constructor({ aiClient, promptPath, additionalPromptPath }) {
        this.aiClient = aiClient;
        this.promptPath = promptPath;
        this.additionalPromptPath = additionalPromptPath;
        this.systemPrompt = "";
    }

    async initialize() {
        const primaryPrompt = (
            await fs.readFile(this.promptPath, "utf8")
        ).trim();
        if (!primaryPrompt) {
            throw new ScenePromptError("The scene-director prompt file is empty.");
        }

        let additionalPrompt = "";
        if (this.additionalPromptPath) {
            try {
                additionalPrompt = (
                    await fs.readFile(this.additionalPromptPath, "utf8")
                ).trim();
            } catch (error) {
                if (error?.code !== "ENOENT") {
                    throw error;
                }
            }
        }

        this.systemPrompt = additionalPrompt
            ? `${primaryPrompt}\n\nADDITIONAL SCENE-DIRECTOR INSTRUCTIONS\n${additionalPrompt}`
            : primaryPrompt;
    }

    async createFromAppearanceAndLatestMessages(
        latestAssistantResponse,
        latestUserMessage,
        characterAppearance,
        sessionMemoryContext = "",
    ) {
        if (!this.systemPrompt) {
            throw new ScenePromptError(
                "The scene director was not initialized before use.",
            );
        }

        const rawPrompt = await this.aiClient.generateScenePrompt(
            latestAssistantResponse,
            latestUserMessage,
            this.systemPrompt,
            characterAppearance,
            sessionMemoryContext,
        );
        return normalizeScenePrompt(rawPrompt);
    }
}

