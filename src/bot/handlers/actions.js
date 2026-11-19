/**
 * Callback action handlers for inline keyboard buttons.
 */

import { isOwner, replyNotOwner } from "../middleware/ownerCheck.js";
import {
    mainMenu,
    buildPersonalityMenu,
    buildImageSettingsKeyboard,
    imageSettingsMessage,
} from "../utils/keyboards.js";
import { PERSONALITIES } from "../../personalities/index.js";
import {
    createNewChatSession,
    updateChatPersonality,
} from "../../memory/index.js";
import { IMAGE_GENERATION_AVAILABLE } from "../../config/index.js";
import { imagePreferences } from "../../image/runtime.js";

export function registerActionHandlers(bot) {
    bot.action("show_image_settings", async (ctx) => {
        if (!isOwner(ctx)) return replyNotOwner(ctx, true);
        const enabled = await imagePreferences.getPreference(ctx.from);
        await ctx.answerCbQuery();
        await ctx.editMessageText(
            imageSettingsMessage(enabled, IMAGE_GENERATION_AVAILABLE),
            buildImageSettingsKeyboard(enabled, IMAGE_GENERATION_AVAILABLE),
        );
    });

    bot.action(/image_generation_(enable|disable)/, async (ctx) => {
        if (!isOwner(ctx)) return replyNotOwner(ctx, true);
        if (!IMAGE_GENERATION_AVAILABLE) {
            await ctx.answerCbQuery("Automatic images are unavailable.", {
                show_alert: true,
            });
            return;
        }

        const enabled = ctx.match[1] === "enable";
        await imagePreferences.setPreference(ctx.from, enabled);
        await ctx.answerCbQuery(
            enabled ? "Automatic images enabled." : "Automatic images disabled.",
        );
        await ctx.editMessageText(
            imageSettingsMessage(enabled, true),
            buildImageSettingsKeyboard(enabled, true),
        );
    });

    bot.action("new_chat", async (ctx) => {
        if (!isOwner(ctx)) return replyNotOwner(ctx, true);
        await createNewChatSession(ctx.chat.id);
        await ctx.answerCbQuery("✨ New chat session created.");
        await ctx.reply(
            "✨ New chat session started with fresh session memory.",
            mainMenu,
        );
    });

    bot.action("configure_personality", async (ctx) => {
        if (!isOwner(ctx)) return replyNotOwner(ctx, true);
        await ctx.answerCbQuery("🎭 Choose a personality");
        await ctx.editMessageText(
            "🎭 Choose a personality for this chat:",
            buildPersonalityMenu(),
        );
    });

    bot.action(/set_personality_(.+)/, async (ctx) => {
        if (!isOwner(ctx)) return replyNotOwner(ctx, true);
        const personalityKey = ctx.match[1];
        if (!PERSONALITIES[personalityKey]) {
            await ctx.answerCbQuery("Personality not found", {
                show_alert: true,
            });
            return;
        }

        await createNewChatSession(ctx.chat.id);
        await updateChatPersonality(ctx.chat.id, personalityKey);
        await ctx.answerCbQuery(
            `✨ ${PERSONALITIES[personalityKey].name} selected`,
        );
        await ctx.editMessageText(
            `✨ Personality updated to ${PERSONALITIES[personalityKey].name}.\n\n🆕 New chat session started for this personality.`,
        );
    });
}
