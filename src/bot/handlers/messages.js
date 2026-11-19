/**
 * Message handler.
 * Streams the text reply, then optionally directs and generates one image.
 */

import {
    IMAGE_GENERATION_AVAILABLE,
    COMFYUI_CHECKPOINT_NAME,
    MAX_MESSAGE_LENGTH,
    GROQ_MODEL,
    TELEGRAM_STREAM_EDIT_INTERVAL_MS,
} from "../../config/index.js";
import { PERSONALITIES } from "../../personalities/index.js";
import { isOwner, replyNotOwner } from "../middleware/ownerCheck.js";
import {
    getChatState,
    appendChatArtifact,
    appendChatMessage,
    loadRecentConversation,
    getSessionMemoryForPrompt,
} from "../../memory/index.js";
import { analyzeAndSaveSessionTurn } from "../../memory/sessionMemory.js";
import {
    aiClient,
    conversationQueue,
    imagePipeline,
    imagePreferences,
} from "../../image/runtime.js";
import { ImageQueueFullError } from "../../image/errors.js";
import {
    IMAGE_BUILDING_MESSAGE,
    buildImageCaption,
    buildRegenerateImageKeyboard,
    imageGenerationErrorMessage,
} from "../../image/telegram.js";
import {
    buildPipelineTimingReport,
    compactTimingReport,
} from "../../image/timing.js";

const STREAM_EDIT_DELAY_SEQUENCE_MS = [
    TELEGRAM_STREAM_EDIT_INTERVAL_MS,
    TELEGRAM_STREAM_EDIT_INTERVAL_MS,
    TELEGRAM_STREAM_EDIT_INTERVAL_MS * 2,
    20000,
];

export function formatModelDisplayName(value, maxWords = 4) {
    const filename = String(value || "")
        .trim()
        .split(/[\\/]/)
        .at(-1)
        .replace(/\.(?:safetensors|ckpt|gguf)$/i, "");
    const colonParts = filename.split(":");
    if (/^q\d/i.test(colonParts.at(-1))) colonParts.pop();

    const words = colonParts
        .join(" ")
        .replace(/[-_]+/g, " ")
        .split(/\s+/)
        .filter((word) => word && !/^gguf$/i.test(word) && !/^q\d/i.test(word));
    return words.slice(0, maxWords).join(" ") || "Unknown";
}

export function buildProcessingMessage({
    personalityName,
    imageEnabled,
    textModel = GROQ_MODEL,
    imageModel = COMFYUI_CHECKPOINT_NAME,
}) {
    const textLabel = formatModelDisplayName(textModel);
    const imageLabel = imageEnabled
        ? formatModelDisplayName(imageModel)
        : "Off";
    const character = String(personalityName || "Unknown").replace(/\s+/g, " ");

    return [
        "⏳ Processing...",
        `💬 Text→Text: ${textLabel}`,
        `🎨 Text→Image: ${imageLabel}`,
        `🎭 ${character} · Session memory on`,
    ].join("\n");
}

async function logPipelineTimings({
    chatId,
    sessionId,
    username,
    userId,
    messageTimings,
    imageTimings,
    totalToPhotoMs,
    totalMs,
}) {
    const report = buildPipelineTimingReport({
        username,
        userId,
        messageTimings,
        imageTimings,
        totalToPhotoMs,
        totalMs,
    });
    console.log(report);
    try {
        await appendChatArtifact(
            chatId,
            "Pipeline Timing",
            compactTimingReport(report),
            sessionId,
        );
    } catch (error) {
        console.warn("⚠️ Could not save pipeline timing to the session:", error.message);
    }
}

function splitTelegramMessage(text) {
    return text.match(new RegExp(`.{1,${MAX_MESSAGE_LENGTH}}`, "gs")) || [text];
}

function getEditablePreview(text) {
    const trimmed = text.trim();
    if (!trimmed) return "";
    if (trimmed.length <= MAX_MESSAGE_LENGTH) return trimmed;
    return `${trimmed.slice(0, MAX_MESSAGE_LENGTH - 24)}\n\n...streaming`;
}

async function editMessageSafely(ctx, messageId, text) {
    if (!messageId || !text.trim()) return false;

    try {
        await ctx.telegram.editMessageText(
            ctx.chat.id,
            messageId,
            undefined,
            getEditablePreview(text),
        );
        return true;
    } catch (error) {
        const description = error.description || error.message || "";
        if (description.includes("message is not modified")) return true;
        console.warn("⚠️ Could not edit Telegram message:", error.message);
        return false;
    }
}

async function deleteMessageSafely(ctx, messageId) {
    if (!messageId) return;
    try {
        await ctx.deleteMessage(messageId);
    } catch (error) {
        console.warn("⚠️ Could not delete Telegram status message:", error.message);
    }
}

async function sendFinalResponse(ctx, processingMessage, response) {
    const messages = splitTelegramMessage(response.trim());

    if (processingMessage?.message_id) {
        const edited = await editMessageSafely(
            ctx,
            processingMessage.message_id,
            messages[0],
        );
        if (!edited) {
            await deleteMessageSafely(ctx, processingMessage.message_id);
            await ctx.reply(messages[0]);
        }
    } else {
        await ctx.reply(messages[0]);
    }

    for (const chunk of messages.slice(1)) {
        await ctx.reply(chunk);
    }
}

async function sendAutomaticImage(
    ctx,
    response,
    userMessage,
    characterAppearance,
    sessionMemoryContext,
    username,
    userId,
    sessionId,
) {
    let imageStatusMessage = null;
    let caption = "";
    let regenerationPromptId = null;
    let photoDeliveredAt = null;

    try {
        const result = await imagePipeline.run({
            latestAssistantResponse: response,
            latestUserMessage: userMessage,
            characterAppearance,
            sessionMemoryContext,
            onPromptReady: async (scenePrompt) => {
                caption = buildImageCaption(scenePrompt);
                await appendChatArtifact(
                    ctx.chat.id,
                    "Scene Director",
                    scenePrompt,
                    sessionId,
                );
                const promptRecord = await imagePreferences.recordScenePrompt({
                    user: ctx.from,
                    chatId: ctx.chat.id,
                    assistantResponse: response,
                    scenePrompt,
                });
                regenerationPromptId = promptRecord.id;
            },
            onGenerationStart: async () => {
                imageStatusMessage = await ctx.reply(IMAGE_BUILDING_MESSAGE);
            },
            onImageReady: async ({ buffer }) => {
                try {
                    await ctx.sendChatAction("upload_photo");
                } catch {}
                await deleteMessageSafely(
                    ctx,
                    imageStatusMessage?.message_id,
                );
                await ctx.replyWithPhoto(
                    { source: buffer },
                    {
                        caption,
                        parse_mode: "HTML",
                        ...buildRegenerateImageKeyboard(regenerationPromptId),
                    },
                );
                photoDeliveredAt = Date.now();
            },
        });
        console.log(`✅ Sent automatic image to ${username} (${userId})`);
        return { ...result, photoDeliveredAt };
    } catch (error) {
        console.error(
            `❌ Automatic image failed for ${username} (${userId}): ${error.message}`,
        );
        const message = imageGenerationErrorMessage(error);
        if (imageStatusMessage?.message_id) {
            const edited = await editMessageSafely(
                ctx,
                imageStatusMessage.message_id,
                message,
            );
            if (edited) return;
        }
        await ctx.reply(message);
        return null;
    }
}

async function processConversation({
    ctx,
    processingMessage,
    userMessage,
    username,
    userId,
    imageEnabled,
    personality,
    sessionId,
    receivedAt,
    queuedAt,
}) {
    const processingStartedAt = Date.now();
    const messageTimings = {
        requestSetupMs: queuedAt - receivedAt,
        queueWaitMs: processingStartedAt - queuedAt,
        contextPreparationMs: 0,
        textGenerationMs: 0,
        textDeliveryMs: 0,
    };

    let phaseStartedAt = Date.now();
    const recentHistory = await loadRecentConversation(
        ctx.chat.id,
        undefined,
        sessionId,
    );
    const sessionMemoryContext = await getSessionMemoryForPrompt(
        ctx.chat.id,
        sessionId,
    );

    await appendChatMessage(ctx.chat.id, "user", userMessage, null, sessionId);
    messageTimings.contextPreparationMs = Date.now() - phaseStartedAt;

    await ctx.sendChatAction("typing");
    let nextEditAt = 0;
    let editDelayIndex = 0;
    let lastEditedText = "";

    phaseStartedAt = Date.now();
    const response = await aiClient.chatStream(
        userMessage,
        personality,
        recentHistory,
        async (partialText) => {
            const now = Date.now();
            const preview = getEditablePreview(partialText);
            if (!preview || preview === lastEditedText || now < nextEditAt) return;

            const edited = await editMessageSafely(
                ctx,
                processingMessage.message_id,
                preview,
            );
            if (edited) {
                lastEditedText = preview;
                editDelayIndex = Math.min(
                    editDelayIndex + 1,
                    STREAM_EDIT_DELAY_SEQUENCE_MS.length - 1,
                );
                nextEditAt = now + STREAM_EDIT_DELAY_SEQUENCE_MS[editDelayIndex];
                await ctx.sendChatAction("typing");
            }
        },
        sessionMemoryContext,
    );
    messageTimings.textGenerationMs = Date.now() - phaseStartedAt;

    if (!response) {
        await deleteMessageSafely(ctx, processingMessage?.message_id);
        await ctx.reply(
            "❌ I couldn't process your request. Please check the Groq connection and try again.",
        );
        return;
    }

    phaseStartedAt = Date.now();
    await appendChatMessage(
        ctx.chat.id,
        "assistant",
        response,
        personality.name,
        sessionId,
    );
    await sendFinalResponse(ctx, processingMessage, response);
    messageTimings.textDeliveryMs = Date.now() - phaseStartedAt;
    console.log(`✅ Sent response to ${username} (${userId})`);

    if (imageEnabled) {
        const imageResult = await sendAutomaticImage(
            ctx,
            response,
            userMessage,
            personality.appearance,
            sessionMemoryContext,
            username,
            userId,
            sessionId,
        );
        if (imageResult?.photoDeliveredAt) {
            await logPipelineTimings({
                chatId: ctx.chat.id,
                sessionId,
                username,
                userId,
                messageTimings,
                imageTimings: imageResult.timings,
                totalToPhotoMs: imageResult.photoDeliveredAt - receivedAt,
                totalMs: Date.now() - receivedAt,
            });
        }
    }

    scheduleSessionMemoryAnalysis({
        chatId: ctx.chat.id,
        sessionId,
        userMessage,
        assistantMessage: response,
    });
}

function scheduleSessionMemoryAnalysis({
    chatId,
    sessionId,
    userMessage,
    assistantMessage,
}) {
    try {
        const queued = conversationQueue.add(
            async () =>
                analyzeAndSaveSessionTurn({
                    chatId,
                    sessionId,
                    userMessage,
                    assistantMessage,
                    aiClient,
                }),
            { priority: "background" },
        );
        void queued.promise.catch((error) => {
            console.error(
                `Session memory analysis failed for chat ${chatId}, session ${sessionId}: ${error.message}`,
            );
        });
    } catch (error) {
        console.error(
            `Could not queue session memory analysis for chat ${chatId}, session ${sessionId}: ${error.message}`,
        );
    }
}

function startBackgroundTask(promise, ctx, processingMessage) {
    void promise.catch(async (error) => {
        console.error(`❌ Error processing queued message: ${error.message}`);
        const message = "❌ Something unexpected happened. Please try again.";
        const edited = await editMessageSafely(
            ctx,
            processingMessage?.message_id,
            message,
        );
        if (!edited) await ctx.reply(message);
    });
}
export function registerMessageHandler(bot) {
    bot.on("message", async (ctx) => {
        if (!ctx.message?.text) return;
        if (!isOwner(ctx)) return replyNotOwner(ctx);
        if (ctx.message.text.startsWith("/")) return;

        const userId = Number(ctx.from.id);
        const username = ctx.from.username || "Unknown";
        const userMessage = ctx.message.text.trim();
        const receivedAt = Date.now();
        console.log("-".repeat(50));
        console.log(`💬 Message from ${username} (${userId}): ${userMessage}`);

        const imageEnabled =
            IMAGE_GENERATION_AVAILABLE &&
            (await imagePreferences.getPreference(ctx.from));
        const chatState = await getChatState(ctx.chat.id);
        const personality =
            PERSONALITIES[chatState.personality] ||
            PERSONALITIES[Object.keys(PERSONALITIES)[0]];
        const processingMessage = await ctx.reply(
            buildProcessingMessage({
                personalityName: personality.name,
                imageEnabled,
            }),
        );
        const queuedAt = Date.now();

        let queued;
        try {
            queued = conversationQueue.add(() =>
                processConversation({
                    ctx,
                    processingMessage,
                    userMessage,
                    username,
                    userId,
                    imageEnabled,
                    personality,
                    sessionId: chatState.currentSession,
                    receivedAt,
                    queuedAt,
                }),
            );
        } catch (error) {
            await deleteMessageSafely(ctx, processingMessage.message_id);
            if (error instanceof ImageQueueFullError) {
                await ctx.reply(
                    "⏳ Too many messages are already waiting. Please try again after the current reply finishes.",
                );
                return;
            }
            throw error;
        }

        startBackgroundTask(queued.promise, ctx, processingMessage);
    });
}
