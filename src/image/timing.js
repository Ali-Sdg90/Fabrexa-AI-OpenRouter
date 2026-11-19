function formatSeconds(milliseconds) {
    return `${(Math.max(0, milliseconds || 0) / 1000).toFixed(2)}s`;
}

export function buildPipelineTimingReport({
    username,
    userId,
    messageTimings,
    imageTimings,
    totalToPhotoMs,
    totalWithCleanupMs,
}) {
    return [
        `⏱️ Pipeline timing for ${username} (${userId})`,
        `   Request setup: ${formatSeconds(messageTimings.requestSetupMs)}`,
        `   Queue wait: ${formatSeconds(messageTimings.queueWaitMs)}`,
        `   Text-model preparation: ${formatSeconds(messageTimings.textModelPreparationMs)}`,
        `   Context and memory: ${formatSeconds(messageTimings.contextPreparationMs)}`,
        `   Text generation: ${formatSeconds(messageTimings.textGenerationMs)}`,
        `   Text delivery: ${formatSeconds(messageTimings.textDeliveryMs)}`,
        `   Scene direction: ${formatSeconds(imageTimings.sceneDirectionMs)}`,
        `   Prompt persistence: ${formatSeconds(imageTimings.promptPersistenceMs)}`,
        `   Text-model unload: ${formatSeconds(imageTimings.textModelUnloadMs)}`,
        `   Image status: ${formatSeconds(imageTimings.imageStatusMs)}`,
        `   Image generation: ${formatSeconds(imageTimings.imageGenerationMs)}`,
        `   Image delivery: ${formatSeconds(imageTimings.imageDeliveryMs)}`,
        `   Image-model unload: ${formatSeconds(imageTimings.imageModelUnloadMs)}`,
        `   Text-model reload: ${formatSeconds(imageTimings.textModelReloadMs)}`,
        `   Image pipeline total: ${formatSeconds(imageTimings.totalMs)}`,
        `   Total until photo: ${formatSeconds(totalToPhotoMs)}`,
        `   Total with cleanup: ${formatSeconds(totalWithCleanupMs)}`,
    ].join("\n");
}

export function buildRegenerationTimingReport({
    username,
    userId,
    queueWaitMs,
    photoDeliveredMs,
    totalMs,
    timings,
}) {
    return [
        `⏱️ Image regeneration timing for ${username} (${userId})`,
        `   Queue wait: ${formatSeconds(queueWaitMs)}`,
        `   Text-model unload: ${formatSeconds(timings.textModelUnloadMs)}`,
        `   Image status: ${formatSeconds(timings.imageStatusMs)}`,
        `   Image generation: ${formatSeconds(timings.imageGenerationMs)}`,
        `   Image delivery: ${formatSeconds(timings.imageDeliveryMs)}`,
        `   Image-model unload: ${formatSeconds(timings.imageModelUnloadMs)}`,
        `   Text-model reload: ${formatSeconds(timings.textModelReloadMs)}`,
        `   Total until photo: ${formatSeconds(photoDeliveredMs)}`,
        `   Total with cleanup: ${formatSeconds(totalMs)}`,
    ].join("\n");
}

export function compactTimingReport(report) {
    return String(report || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .join(" | ");
}
