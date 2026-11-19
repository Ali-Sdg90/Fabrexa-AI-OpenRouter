import AIClient from "../ai/client.js";
import {
    COMFYUI_ADDITIONAL_SEED_MAPPINGS,
    COMFYUI_BASE_URL,
    COMFYUI_CHECKPOINT_INPUT,
    COMFYUI_CHECKPOINT_NAME,
    COMFYUI_CHECKPOINT_NODE_ID,
    COMFYUI_CLEANUP_FREE_RATIO,
    COMFYUI_CLEANUP_MIN_RELEASE_BYTES,
    COMFYUI_CLEANUP_POLL_INTERVAL_MS,
    COMFYUI_CLEANUP_STABLE_SAMPLES,
    COMFYUI_CLEANUP_TIMEOUT_MS,
    COMFYUI_IDLE_TIMEOUT_MS,
    COMFYUI_POLL_INTERVAL_MS,
    COMFYUI_POSITIVE_PROMPT_INPUT,
    COMFYUI_POSITIVE_PROMPT_NODE_ID,
    COMFYUI_REQUEST_TIMEOUT_MS,
    COMFYUI_SAVE_IMAGE_NODE_ID,
    COMFYUI_SEED_INPUT,
    COMFYUI_SEED_NODE_ID,
    COMFYUI_TIMEOUT_MS,
    COMFYUI_WORKFLOW_PATH,
    IMAGE_GENERATION_AVAILABLE,
    IMAGE_GENERATION_DEFAULT_ENABLED,
    IMAGE_GENERATION_QUEUE_MAX_SIZE,
    IMAGE_ADDITIONAL_SCENE_PROMPT_PATH,
    IMAGE_SCENE_DIRECTOR_PROMPT_PATH,
    IMAGE_USER_DATA_DIR,
    IMAGE_USER_PROMPT_HISTORY_LIMIT,
} from "../config/index.js";
import { ComfyUIService, generateSeed } from "./comfyui.js";
import { ImagePipeline } from "./pipeline.js";
import { ImagePreferenceService } from "./preferences.js";
import { SerialTaskQueue } from "./queue.js";
import { SceneDirectorService } from "./sceneDirector.js";

export const aiClient = new AIClient();
export const imagePreferences = new ImagePreferenceService({
    rootDirectory: IMAGE_USER_DATA_DIR,
    defaultEnabled: IMAGE_GENERATION_DEFAULT_ENABLED,
    promptHistoryLimit: IMAGE_USER_PROMPT_HISTORY_LIMIT,
});
export const conversationQueue = new SerialTaskQueue({
    maxSize: IMAGE_GENERATION_QUEUE_MAX_SIZE,
});

const comfyUIService = new ComfyUIService({
    baseUrl: COMFYUI_BASE_URL,
    workflowPath: COMFYUI_WORKFLOW_PATH,
    checkpointName: COMFYUI_CHECKPOINT_NAME,
    pollIntervalMs: COMFYUI_POLL_INTERVAL_MS,
    timeoutMs: COMFYUI_TIMEOUT_MS,
    requestTimeoutMs: COMFYUI_REQUEST_TIMEOUT_MS,
    idleTimeoutMs: COMFYUI_IDLE_TIMEOUT_MS,
    cleanupTimeoutMs: COMFYUI_CLEANUP_TIMEOUT_MS,
    cleanupPollIntervalMs: COMFYUI_CLEANUP_POLL_INTERVAL_MS,
    cleanupMinReleaseBytes: COMFYUI_CLEANUP_MIN_RELEASE_BYTES,
    cleanupFreeRatio: COMFYUI_CLEANUP_FREE_RATIO,
    cleanupStableSamples: COMFYUI_CLEANUP_STABLE_SAMPLES,
    mappings: Object.freeze({
        positivePromptNodeId: COMFYUI_POSITIVE_PROMPT_NODE_ID,
        positivePromptInput: COMFYUI_POSITIVE_PROMPT_INPUT,
        checkpointNodeId: COMFYUI_CHECKPOINT_NODE_ID,
        checkpointInput: COMFYUI_CHECKPOINT_INPUT,
        seedNodeId: COMFYUI_SEED_NODE_ID,
        seedInput: COMFYUI_SEED_INPUT,
        additionalSeedMappings: COMFYUI_ADDITIONAL_SEED_MAPPINGS,
        saveImageNodeId: COMFYUI_SAVE_IMAGE_NODE_ID,
    }),
});
const sceneDirector = new SceneDirectorService({
    aiClient,
    promptPath: IMAGE_SCENE_DIRECTOR_PROMPT_PATH,
    additionalPromptPath: IMAGE_ADDITIONAL_SCENE_PROMPT_PATH,
});
export const imagePipeline = new ImagePipeline({
    aiClient,
    sceneDirector,
    comfyUIService,
    seedGenerator: generateSeed,
});

export async function initializeImageRuntime() {
    await imagePreferences.initialize();
    if (IMAGE_GENERATION_AVAILABLE) {
        await imagePipeline.initialize();
    }
}

