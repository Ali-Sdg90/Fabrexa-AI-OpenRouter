import { IMAGE_GENERATION_AVAILABLE } from "../../config/index.js";
import { ImageQueueFullError } from "../../image/errors.js";
import { appendChatArtifact } from "../../memory/index.js";
import {
    conversationQueue,
    imagePipeline,
    imagePreferences,
} from "../../image/runtime.js";
import {
    IMAGE_REGENERATING_MESSAGE,
    buildImageCaption,
    buildRegenerateImageKeyboard,
    imageRegenerationErrorMessage,
} from "../../image/telegram.js";
import {
    buildRegenerationTimingReport,
    compactTimingReport,
} from "../../image/timing.js";
import { isOwner, replyNotOwner } from "../middleware/ownerCheck.js";

async function deleteMessageSafely(ctx, messageId) {
    if (!messageId) return;
    try {
        await ctx.deleteMessage(messageId);
    } catch (error) {
        console.warn(
            "⚠️ Could not delete Telegram regeneration status:",
            error.message,
        );
    }
}

async function showRegenerationError(ctx, statusMessage) {
    const message = imageRegenerationErrorMessage();
    if (statusMessage?.message_id) {
        try {
            await ctx.telegram.editMessageText(
                ctx.chat.id,
                statusMessage.message_id,
                undefined,
                message,
            );
            return;
        } catch (error) {
            console.warn(
                "⚠️ Could not edit Telegram regeneration status:",
                error.message,
            );
        }
    }
    await ctx.reply(message);
}

async function logRegenerationTimings({
    chatId,
    username,
    userId,
    queueWaitMs,
    photoDeliveredMs,
    totalMs,
    timings,
    artifactWriter,
}) {
    const report = buildRegenerationTimingReport({
        username,
        userId,
        queueWaitMs,
        photoDeliveredMs,
        totalMs,
        timings,
    });
    console.log(report);
    try {
        await artifactWriter(
            chatId,
            "Image Regeneration Timing",
            compactTimingReport(report),
        );
    } catch (error) {
        console.warn(
            "⚠️ Could not save regeneration timing to the session:",
            error.message,
        );
    }
}

async function regenerateStoredImage(
    ctx,
    promptRecord,
    queuedAt,
    pipeline,
    artifactWriter,
) {
    const startedAt = Date.now();
    const username = ctx.from?.username || ctx.from?.first_name || "Unknown";
    const userId = ctx.from?.id;
    const caption = buildImageCaption(promptRecord.scenePrompt);
    let statusMessage = null;
    let photoDeliveredAt = null;

    try {
        const result = await pipeline.regenerate({
            scenePrompt: promptRecord.scenePrompt,
            onGenerationStart: async () => {
                statusMessage = await ctx.reply(IMAGE_REGENERATING_MESSAGE);
            },
            onImageReady: async ({ buffer }) => {
                try {
                    await ctx.sendChatAction("upload_photo");
                } catch {}
                await deleteMessageSafely(ctx, statusMessage?.message_id);
                await ctx.replyWithPhoto(
                    { source: buffer },
                    {
                        caption,
                        parse_mode: "HTML",
                        ...buildRegenerateImageKeyboard(promptRecord.id),
                    },
                );
                photoDeliveredAt = Date.now();
            },
        });

        console.log(`✅ Regenerated image for ${username} (${userId})`);
        await logRegenerationTimings({
            chatId: ctx.chat.id,
            username,
            userId,
            queueWaitMs: startedAt - queuedAt,
            photoDeliveredMs: photoDeliveredAt - startedAt,
            totalMs: Date.now() - startedAt,
            timings: result.timings,
            artifactWriter,
        });
    } catch (error) {
        console.error(
            `❌ Image regeneration failed for ${username} (${userId}): ${error.message}`,
        );
        if (error.imageDelivered) {
            if (error.pipelineTimings) {
                await logRegenerationTimings({
                    chatId: ctx.chat.id,
                    username,
                    userId,
                    queueWaitMs: startedAt - queuedAt,
                    photoDeliveredMs: photoDeliveredAt
                        ? photoDeliveredAt - startedAt
                        : 0,
                    totalMs: Date.now() - startedAt,
                    timings: error.pipelineTimings,
                    artifactWriter,
                });
            }
            return;
        }
        await showRegenerationError(ctx, statusMessage);
    }
}

export function registerImageRegenerationHandler(
    bot,
    {
        queue = conversationQueue,
        pipeline = imagePipeline,
        preferences = imagePreferences,
        imageGenerationAvailable = IMAGE_GENERATION_AVAILABLE,
        artifactWriter = appendChatArtifact,
    } = {},
) {
    bot.action(/^regenerate_image:([0-9a-f-]{36})$/i, async (ctx) => {
        if (!isOwner(ctx)) return replyNotOwner(ctx, true);
        if (!imageGenerationAvailable) {
            await ctx.answerCbQuery("Image generation is unavailable.", {
                show_alert: true,
            });
            return;
        }

        const promptRecord = await preferences.getScenePrompt({
            user: ctx.from,
            chatId: ctx.chat.id,
            promptId: ctx.match[1],
        });
        if (!promptRecord) {
            await ctx.answerCbQuery("The saved image direction is no longer available.", {
                show_alert: true,
            });
            return;
        }

        const queuedAt = Date.now();
        let queued;
        try {
            queued = queue.add(() =>
                regenerateStoredImage(
                    ctx,
                    promptRecord,
                    queuedAt,
                    pipeline,
                    artifactWriter,
                ),
            );
        } catch (error) {
            if (error instanceof ImageQueueFullError) {
                await ctx.answerCbQuery("The image queue is full. Please try again shortly.", {
                    show_alert: true,
                });
                return;
            }
            throw error;
        }

        await ctx.answerCbQuery(
            queued.queued
                ? `Regeneration queued (${queued.position}).`
                : "Regenerating image...",
        );
        void queued.promise.catch((error) => {
            console.error("❌ Queued image regeneration failed:", error.message);
        });
    });
}
