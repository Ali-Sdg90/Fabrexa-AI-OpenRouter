/**
 * Fabrexa AI Telegram Bot.
 * Main bot initialization and startup.
 */

import { Telegraf } from "telegraf";
import {
    IS_DEV_LOG_MODE,
    LOG_MODE,
    GROQ_MODEL,
    TELEGRAM_BOT_TOKEN,
} from "../config/index.js";
import { ensureChatDataDirectory } from "../memory/index.js";
import { initializeSessionMemoryAnalyzer } from "../memory/sessionMemory.js";
import { initializeImageRuntime } from "../image/runtime.js";
import { registerCommandHandlers } from "./handlers/commands.js";
import { registerActionHandlers } from "./handlers/actions.js";
import { registerImageRegenerationHandler } from "./handlers/imageRegeneration.js";
import { registerQuickActionHandlers } from "./handlers/quickActions.js";
import { registerMessageHandler } from "./handlers/messages.js";

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

export function createBot() {
    registerCommandHandlers(bot);
    registerActionHandlers(bot);
    registerImageRegenerationHandler(bot);
    registerQuickActionHandlers(bot);
    registerMessageHandler(bot);

    bot.catch((err, ctx) => {
        console.error(`❌ Error for ${ctx.updateType}: ${err.message}`);
    });

    return bot;
}

export async function startBot() {
    try {
        console.log("\n" + "=".repeat(60));
        console.log("🚀 Starting Fabrexa AI Bot...");
        console.log("=".repeat(60));

        process.once("SIGINT", () => {
            console.log("\n🛑 Bot stopped by user");
            bot.stop("SIGINT");
            process.exit(0);
        });

        process.once("SIGTERM", () => {
            console.log("\n🛑 Bot stopped by system");
            bot.stop("SIGTERM");
            process.exit(0);
        });

        await ensureChatDataDirectory();
        await initializeSessionMemoryAnalyzer();
        await initializeImageRuntime();

        const tokenLength = TELEGRAM_BOT_TOKEN?.length || 0;

        console.log("✅ Fabrexa AI Bot is running!");
        console.log(`🤖 Groq model: ${GROQ_MODEL}`);
        console.log(
            `🧾 Log mode: ${LOG_MODE}${IS_DEV_LOG_MODE ? " (dev payload logs enabled)" : ""}`,
        );
        console.log(`🔐 TELEGRAM_BOT_TOKEN loaded: ${tokenLength} characters`);
        console.log("📱 Press Ctrl+C to stop the bot");
        console.log("=".repeat(60) + "\n");

        if (tokenLength < 30) {
            console.warn(
                "⚠️  Telegram token looks too short. Verify TELEGRAM_BOT_TOKEN is correct and has no quotes or extra spaces.",
            );
        }

        await bot.telegram.setMyCommands([
            { command: "start", description: "Start Fabrexa" },
        ]);

        await bot.launch({ allowedUpdates: ["message", "callback_query"] });
    } catch (error) {
        console.error(`💥 Critical error: ${error.message}`);
        if (error.response) {
            console.error(
                `📡 Response status: ${error.response.status} ${
                    error.response.statusText || ""
                }`,
            );
            console.error(
                `📘 Response body: ${JSON.stringify(error.response.data)}`,
            );
            if (error.response.status === 404) {
                console.error(
                    "🔧 404 usually means your TELEGRAM_BOT_TOKEN is malformed or missing, or the bot endpoint is wrong. Check your token and ensure it is set in the same shell where you start the bot.",
                );
            }
        } else if (error.code || error.errno) {
            console.error(`📡 Error code: ${error.code || error.errno}`);
        } else {
            console.error(
                `📡 Full error object: ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`,
            );
        }
        process.exit(1);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    startBot();
}

export default createBot();
