/**
 * Command handlers.
 */

import { isOwner, replyNotOwner } from "../middleware/ownerCheck.js";
import { quickKeyboard } from "../utils/keyboards.js";
import {
    IMAGE_GENERATION_AVAILABLE,
    GROQ_MODEL,
} from "../../config/index.js";

export function registerCommandHandlers(bot) {
    bot.command("start", async (ctx) => {
        if (!isOwner(ctx)) return replyNotOwner(ctx);

        const imageNote = IMAGE_GENERATION_AVAILABLE
            ? "Automatic images are enabled by default for every personality."
            : "Automatic images are unavailable in this application configuration.";
        const welcomeMessage = `👋 *Welcome to Fabrexa AI!*

🤖 *Online model:* \`${GROQ_MODEL}\`
🌐 *Powered by:* Groq

🎨 *Images:* your local ComfyUI

Send me any message, question, idea, or late-night thought and I'll answer with your selected personality.

*Quick actions:*
🆕 New Chat - fresh conversation
⚙️ Change Personality - switch personality
🖼️ Image Settings - enable or disable the image made after each reply

${imageNote}

_Just type your message and let's go!_ 🚀`;

        await ctx.reply(welcomeMessage, {
            parse_mode: "Markdown",
            ...quickKeyboard,
        });
        console.log(`📝 User started bot: ${ctx.from.id}`);
    });
}
