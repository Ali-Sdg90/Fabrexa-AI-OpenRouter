/**
 * Quick action handlers for reply keyboard buttons.
 */

import { isOwner, replyNotOwner } from "../middleware/ownerCheck.js";
import {
    BUTTONS,
    quickKeyboard,
    buildPersonalityMenu,
    buildImageSettingsKeyboard,
    imageSettingsMessage,
} from "../utils/keyboards.js";
import { createNewChatSession } from "../../memory/index.js";
import { IMAGE_GENERATION_AVAILABLE } from "../../config/index.js";
import { imagePreferences } from "../../image/runtime.js";

export function registerQuickActionHandlers(bot) {
    bot.hears([BUTTONS.imageSettings, "Image Settings"], async (ctx) => {
        if (!isOwner(ctx)) return replyNotOwner(ctx);
        const enabled = await imagePreferences.getPreference(ctx.from);
        await ctx.reply(
            imageSettingsMessage(enabled, IMAGE_GENERATION_AVAILABLE),
            buildImageSettingsKeyboard(enabled, IMAGE_GENERATION_AVAILABLE),
        );
    });

    bot.hears([BUTTONS.newChat, "New Chat"], async (ctx) => {
        if (!isOwner(ctx)) return replyNotOwner(ctx);
        await createNewChatSession(ctx.chat.id);
        await ctx.reply("✨ New chat session created.", quickKeyboard);
    });

    bot.hears(
        [BUTTONS.changePersonality, "Change Personality"],
        async (ctx) => {
            if (!isOwner(ctx)) return replyNotOwner(ctx);
            await ctx.reply(
                "🎭 Choose a personality for this chat:",
                buildPersonalityMenu(),
            );
        },
    );
}
