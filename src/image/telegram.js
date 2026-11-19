export const IMAGE_BUILDING_MESSAGE = "🎨 Your image is being created...";
export const IMAGE_REGENERATING_MESSAGE = "🎨 Your image is being regenerated...";
export const REGENERATE_IMAGE_CALLBACK_PREFIX = "regenerate_image:";

const TELEGRAM_PHOTO_CAPTION_MAX_LENGTH = 1024;
const IMAGE_CAPTION_PREFIX = "📝 Image direction\n<blockquote expandable>";
const IMAGE_CAPTION_SUFFIX = "</blockquote>";

export function escapeTelegramHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

export function buildImageCaption(scenePrompt) {
    const escapedPrompt = escapeTelegramHtml(scenePrompt);
    const availableLength =
        TELEGRAM_PHOTO_CAPTION_MAX_LENGTH -
        IMAGE_CAPTION_PREFIX.length -
        IMAGE_CAPTION_SUFFIX.length;

    if (escapedPrompt.length <= availableLength) {
        return `${IMAGE_CAPTION_PREFIX}${escapedPrompt}${IMAGE_CAPTION_SUFFIX}`;
    }

    const ellipsis = "…";
    const previewLimit = availableLength - ellipsis.length;
    let preview = "";
    for (const character of String(scenePrompt)) {
        const escapedCharacter = escapeTelegramHtml(character);
        if (preview.length + escapedCharacter.length > previewLimit) break;
        preview += escapedCharacter;
    }

    return `${IMAGE_CAPTION_PREFIX}${preview}${ellipsis}${IMAGE_CAPTION_SUFFIX}`;
}

export function buildRegenerateImageKeyboard(promptId) {
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(promptId || ""))) {
        throw new TypeError("A valid stored prompt id is required.");
    }
    const callbackData = `${REGENERATE_IMAGE_CALLBACK_PREFIX}${promptId}`;
    if (callbackData.length > 64) {
        throw new TypeError("The regenerate callback exceeds Telegram's limit.");
    }
    return {
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: "🔄 Regenerate",
                        callback_data: callbackData,
                    },
                ],
            ],
        },
    };
}

export function imageGenerationErrorMessage() {
    return "⚠️ I couldn't create the image this time. Your text reply is safe; please try again with the next message.";
}

export function imageRegenerationErrorMessage() {
    return "⚠️ I couldn't regenerate the image this time. Please try the button again.";
}

