import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";

import axios from "axios";

import { ComfyUIError, ImageConfigurationError } from "./errors.js";

const ALLOWED_IMAGE_TYPES = new Set(["output", "temp"]);

function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function mappedNode(workflow, nodeId, inputName, label) {
    const node = workflow?.[nodeId];
    if (!node?.inputs || !Object.hasOwn(node.inputs, inputName)) {
        throw new ImageConfigurationError(
            `${label} mapping ${nodeId}:${inputName} was not found in the ComfyUI workflow.`,
        );
    }
    return node;
}

export function validateWorkflowMappings(workflow, mappings) {
    if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
        throw new ImageConfigurationError(
            "The ComfyUI workflow must be an object keyed by node ids.",
        );
    }

    mappedNode(
        workflow,
        mappings.positivePromptNodeId,
        mappings.positivePromptInput,
        "Positive prompt",
    );
    const checkpoint = mappedNode(
        workflow,
        mappings.checkpointNodeId,
        mappings.checkpointInput,
        "Checkpoint",
    );
    if (checkpoint.class_type !== "CheckpointLoaderSimple") {
        throw new ImageConfigurationError(
            "The configured checkpoint node is not CheckpointLoaderSimple.",
        );
    }
    mappedNode(workflow, mappings.seedNodeId, mappings.seedInput, "Seed");
    for (const mapping of mappings.additionalSeedMappings) {
        mappedNode(workflow, mapping.nodeId, mapping.inputName, "Additional seed");
    }

    const output = workflow[mappings.saveImageNodeId];
    if (output?.class_type !== "SaveImage") {
        throw new ImageConfigurationError(
            "The configured output node is not a SaveImage node.",
        );
    }
    return true;
}

export function cloneAndInjectWorkflow(
    workflow,
    mappings,
    { prompt, seed, checkpointName },
) {
    validateWorkflowMappings(workflow, mappings);
    const cloned = structuredClone(workflow);
    cloned[mappings.positivePromptNodeId].inputs[
        mappings.positivePromptInput
    ] = prompt;
    cloned[mappings.checkpointNodeId].inputs[mappings.checkpointInput] =
        checkpointName;
    cloned[mappings.seedNodeId].inputs[mappings.seedInput] = seed;
    for (const mapping of mappings.additionalSeedMappings) {
        cloned[mapping.nodeId].inputs[mapping.inputName] = seed;
    }
    return cloned;
}

function safeImageMetadata(image) {
    const { filename, subfolder = "", type = "output" } = image || {};
    if (
        typeof filename !== "string" ||
        !filename ||
        filename.includes("/") ||
        filename.includes("\\") ||
        filename.includes("\0") ||
        filename === "." ||
        filename === ".."
    ) {
        throw new ComfyUIError("ComfyUI returned an unsafe image filename.");
    }
    if (
        typeof subfolder !== "string" ||
        subfolder.includes("\0") ||
        subfolder.split(/[\\/]+/).some((part) => part === "..")
    ) {
        throw new ComfyUIError("ComfyUI returned an unsafe image subfolder.");
    }
    if (!ALLOWED_IMAGE_TYPES.has(type)) {
        throw new ComfyUIError("ComfyUI returned an unsupported image type.");
    }
    return { filename, subfolder, type };
}

function generationFailure(historyEntry) {
    const messages = historyEntry?.status?.messages;
    if (!Array.isArray(messages)) return null;
    const failure = messages.find(
        (message) =>
            Array.isArray(message) &&
            ["execution_error", "execution_interrupted"].includes(message[0]),
    );
    return failure?.[1]?.exception_message || null;
}

export class ComfyUIService {
    constructor(config, { httpClient, sleep = wait, now = Date.now } = {}) {
        this.config = config;
        this.sleep = sleep;
        this.now = now;
        this.clientId = randomUUID();
        this.httpClient =
            httpClient ||
            axios.create({
                baseURL: config.baseUrl,
                timeout: config.requestTimeoutMs,
                maxRedirects: 0,
            });
        this.workflow = null;
    }

    async initialize() {
        if (!this.config.checkpointName) {
            throw new ImageConfigurationError(
                "COMFYUI_CHECKPOINT_NAME is required when image generation is available.",
            );
        }

        let raw;
        try {
            raw = await fs.readFile(this.config.workflowPath, "utf8");
        } catch (error) {
            throw new ImageConfigurationError(
                `Could not read the ComfyUI workflow at "${this.config.workflowPath}".`,
                { cause: error },
            );
        }
        try {
            this.workflow = JSON.parse(raw);
        } catch (error) {
            throw new ImageConfigurationError(
                "The ComfyUI workflow is not valid JSON.",
                { cause: error },
            );
        }
        validateWorkflowMappings(this.workflow, this.config.mappings);
    }

    createWorkflow(prompt, seed) {
        if (!this.workflow) {
            throw new ImageConfigurationError(
                "ComfyUIService must be initialized before generation.",
            );
        }
        return cloneAndInjectWorkflow(this.workflow, this.config.mappings, {
            prompt,
            seed,
            checkpointName: this.config.checkpointName,
        });
    }

    async getQueueState() {
        try {
            const response = await this.httpClient.get("/queue");
            const running = response?.data?.queue_running;
            const pending = response?.data?.queue_pending;
            if (!Array.isArray(running) || !Array.isArray(pending)) {
                throw new ComfyUIError("ComfyUI returned an invalid queue state.");
            }
            return { idle: running.length === 0 && pending.length === 0 };
        } catch (error) {
            if (error instanceof ComfyUIError) throw error;
            throw new ComfyUIError("Could not inspect the ComfyUI queue.", {
                cause: error,
            });
        }
    }

    async waitUntilIdle() {
        const startedAt = this.now();
        while (this.now() - startedAt < this.config.idleTimeoutMs) {
            if ((await this.getQueueState()).idle) return;
            await this.sleep(this.config.cleanupPollIntervalMs);
        }
        throw new ComfyUIError("ComfyUI did not become idle in time.");
    }

    async generate(prompt, seed) {
        await this.waitUntilIdle();
        const workflow = this.createWorkflow(prompt, seed);
        let promptId;
        try {
            const response = await this.httpClient.post("/prompt", {
                prompt: workflow,
                client_id: this.clientId,
            });
            promptId = response?.data?.prompt_id;
        } catch (error) {
            throw new ComfyUIError("Could not submit the ComfyUI workflow.", {
                cause: error,
            });
        }
        if (typeof promptId !== "string" || !promptId) {
            throw new ComfyUIError("ComfyUI did not return a prompt id.");
        }

        const historyEntry = await this.#waitForCompletion(promptId);
        const images =
            historyEntry?.outputs?.[this.config.mappings.saveImageNodeId]?.images;
        if (!Array.isArray(images) || images.length === 0) {
            throw new ComfyUIError("ComfyUI completed without an output image.");
        }
        const metadata = safeImageMetadata(images.at(-1));

        try {
            const response = await this.httpClient.get("/view", {
                params: metadata,
                responseType: "arraybuffer",
            });
            const buffer = Buffer.from(response?.data || []);
            if (buffer.length === 0) {
                throw new ComfyUIError("ComfyUI returned an empty image.");
            }
            return { buffer, filename: metadata.filename, promptId };
        } catch (error) {
            if (error instanceof ComfyUIError) throw error;
            throw new ComfyUIError("Could not download the ComfyUI image.", {
                cause: error,
            });
        }
    }

    async #waitForCompletion(promptId) {
        const startedAt = this.now();
        while (this.now() - startedAt < this.config.timeoutMs) {
            let historyEntry;
            try {
                const response = await this.httpClient.get(
                    `/history/${encodeURIComponent(promptId)}`,
                );
                historyEntry = response?.data?.[promptId];
            } catch (error) {
                throw new ComfyUIError("Could not read ComfyUI history.", {
                    cause: error,
                });
            }

            if (historyEntry) {
                const failure = generationFailure(historyEntry);
                if (failure || historyEntry.status?.status_str === "error") {
                    throw new ComfyUIError(
                        failure || "ComfyUI marked image generation as failed.",
                    );
                }
                if (
                    historyEntry.status?.completed === true ||
                    Object.keys(historyEntry.outputs || {}).length > 0
                ) {
                    return historyEntry;
                }
            }
            await this.sleep(this.config.pollIntervalMs);
        }
        throw new ComfyUIError("ComfyUI image generation timed out.");
    }

    async releaseModelsForTextInference() {
        await this.waitUntilIdle();
        const before = await this.#getVramSnapshot();
        try {
            await this.httpClient.post("/free", {
                unload_models: true,
                free_memory: true,
            });
        } catch (error) {
            throw new ComfyUIError("Could not unload the ComfyUI models.", {
                cause: error,
            });
        }

        const startedAt = this.now();
        let previousFreeBytes = null;
        let stableSamples = 0;
        while (this.now() - startedAt < this.config.cleanupTimeoutMs) {
            if (!(await this.getQueueState()).idle) {
                throw new ComfyUIError(
                    "ComfyUI started another job during model cleanup.",
                );
            }
            const current = await this.#getVramSnapshot();
            if (
                previousFreeBytes !== null &&
                Math.abs(current.freeBytes - previousFreeBytes) <= 32 * 1024 * 1024
            ) {
                stableSamples += 1;
            } else {
                stableSamples = 1;
            }
            previousFreeBytes = current.freeBytes;

            const alreadyMostlyFree =
                before.freeBytes / before.totalBytes >= this.config.cleanupFreeRatio;
            const nowMostlyFree =
                current.freeBytes / current.totalBytes >= this.config.cleanupFreeRatio;
            const releasedEnough =
                current.freeBytes - before.freeBytes >=
                this.config.cleanupMinReleaseBytes;
            if (
                nowMostlyFree &&
                (alreadyMostlyFree || releasedEnough) &&
                stableSamples >= this.config.cleanupStableSamples
            ) {
                return;
            }
            await this.sleep(this.config.cleanupPollIntervalMs);
        }
        throw new ComfyUIError(
            "ComfyUI model cleanup could not be verified in time.",
        );
    }

    async #getVramSnapshot() {
        let response;
        try {
            response = await this.httpClient.get("/system_stats");
        } catch (error) {
            throw new ComfyUIError("Could not inspect ComfyUI VRAM usage.", {
                cause: error,
            });
        }
        const devices = Array.isArray(response?.data?.devices)
            ? response.data.devices
            : [];
        const device =
            devices.find((entry) =>
                String(entry?.type || "")
                    .toLowerCase()
                    .includes("cuda"),
            ) || devices[0];
        if (
            !Number.isFinite(device?.vram_total) ||
            !Number.isFinite(device?.vram_free) ||
            device.vram_total <= 0
        ) {
            throw new ComfyUIError("ComfyUI returned invalid VRAM statistics.");
        }
        return {
            totalBytes: device.vram_total,
            freeBytes: device.vram_free,
        };
    }
}

export function generateSeed() {
    return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
}

