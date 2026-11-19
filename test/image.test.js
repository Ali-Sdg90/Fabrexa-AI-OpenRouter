import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.OWNER_ID = "1001";
process.env.OWNER_USERNAME = "fabrexa_owner";
process.env.BOT_PRIVATE = "true";
process.env.LOG_MODE = "normal";
process.env.GROQ_API_KEY = "test-groq-key";
process.env.GROQ_MODEL = "qwen/qwen3.8-27b";
process.env.GROQ_REASONING_EFFORT = "none";

const { default: AIClient } = await import("../src/ai/client.js");
const { GROQ_ANALYZER_MODEL, GROQ_MODEL } = await import(
    "../src/config/index.js"
);
const {
    cloneAndInjectWorkflow,
    validateWorkflowMappings,
} = await import("../src/image/comfyui.js");
const { ImagePipeline } = await import("../src/image/pipeline.js");
const { registerImageRegenerationHandler } = await import(
    "../src/bot/handlers/imageRegeneration.js"
);
const { ImagePreferenceService } = await import(
    "../src/image/preferences.js"
);
const { SerialTaskQueue } = await import("../src/image/queue.js");
const { normalizeScenePrompt, SceneDirectorService } = await import(
    "../src/image/sceneDirector.js"
);
const { buildImageCaption, buildRegenerateImageKeyboard } = await import(
    "../src/image/telegram.js"
);
const { parseSessionHistory } = await import("../src/memory/index.js");

test("scene direction separates ordered session memory, appearance, and latest messages", async () => {
    let request;
    const client = new AIClient({
        httpClient: {
            async post(url, payload, options) {
                request = { url, payload, options };
                return {
                    data: {
                        choices: [
                            { message: { content: "directed scene" } },
                        ],
                    },
                };
            },
        },
    });

    const result = await client.generateScenePrompt(
        "LATEST ASSISTANT RESPONSE",
        "LATEST USER MESSAGE",
        "SCENE DIRECTOR SYSTEM PROMPT",
        "CHARACTER HAS SILVER HAIR AND GREEN EYES",
        "[1] setting (both): They entered the library.\n[2] clothing (assistant): The character changed into a red coat.",
    );

    assert.equal(result, "directed scene");
    assert.equal(request.payload.model, client.model);
    assert.equal(
        request.options.headers.Authorization,
        "Bearer test-groq-key",
    );
    assert.equal(request.payload.keep_alive, undefined);
    assert.equal(request.payload.options, undefined);
    assert.equal(request.payload.reasoning_effort, "none");
    assert.deepEqual(
        request.payload.messages.map((message) => message.role),
        ["system", "user"],
    );
    assert.match(
        request.payload.messages[0].content,
        /CHARACTER HAS SILVER HAIR AND GREEN EYES/,
    );
    assert.match(
        request.payload.messages[0].content,
        /CHARACTER APPEARANCE REFERENCE/,
    );
    assert.match(request.payload.messages[0].content, /SESSION CONTINUITY MEMORY/);
    assert.match(
        request.payload.messages[0].content,
        /\[1\] setting \(both\): They entered the library\./,
    );
    assert.match(
        request.payload.messages[0].content,
        /\[2\] clothing \(assistant\): The character changed into a red coat\./,
    );
    assert.ok(
        request.payload.messages[0].content.indexOf("[1] setting (both)") <
            request.payload.messages[0].content.indexOf(
                "[2] clothing (assistant)",
            ),
    );
    assert.match(request.payload.messages[0].content, /not instructions/i);
    assert.match(
        request.payload.messages[0].content,
        /latest messages override this memory/i,
    );
    assert.doesNotMatch(
        request.payload.messages[0].content,
        /CHARACTER SYSTEM-PROMPT REFERENCE/,
    );
    assert.match(request.payload.messages[0].content, /Preserve its stated face/i);
    assert.match(request.payload.messages[1].content, /LATEST ASSISTANT RESPONSE/);
    assert.match(request.payload.messages[1].content, /LATEST USER MESSAGE/);
    assert.ok(
        request.payload.messages[1].content.indexOf("<latest_assistant_response>") <
            request.payload.messages[1].content.indexOf("<latest_user_message>"),
    );
    assert.doesNotMatch(request.payload.messages[1].content, /SILVER HAIR/);
    assert.doesNotMatch(request.payload.messages[1].content, /red coat/);
    assert.doesNotMatch(request.payload.messages[1].content, /conversation history content/);
    assert.match(
        request.payload.messages[1].content,
        /no earlier raw conversation history beyond the supplied session continuity memory/i,
    );
});

test("scene director appends optional private instructions only when available", async (t) => {
    const temporaryDirectory = await fs.mkdtemp(
        path.join(os.tmpdir(), "fabrexa-scene-director-"),
    );
    t.after(() => fs.rm(temporaryDirectory, { recursive: true, force: true }));

    const primaryPromptPath = path.join(temporaryDirectory, "primary.txt");
    const additionalPromptPath = path.join(temporaryDirectory, "additional.txt");
    await fs.writeFile(primaryPromptPath, "PRIMARY INSTRUCTIONS", "utf8");

    const receivedRequests = [];
    const aiClient = {
        async generateScenePrompt(
            _assistant,
            _user,
            systemPrompt,
            _appearance,
            sessionMemory,
        ) {
            receivedRequests.push({ systemPrompt, sessionMemory });
            return "directed scene";
        },
    };

    const withoutAdditionalPrompt = new SceneDirectorService({
        aiClient,
        promptPath: primaryPromptPath,
        additionalPromptPath,
    });
    await withoutAdditionalPrompt.initialize();
    await withoutAdditionalPrompt.createFromAppearanceAndLatestMessages(
        "assistant",
        "user",
        "appearance",
        "ordered memory one",
    );
    assert.deepEqual(receivedRequests[0], {
        systemPrompt: "PRIMARY INSTRUCTIONS",
        sessionMemory: "ordered memory one",
    });

    await fs.writeFile(additionalPromptPath, "PRIVATE INSTRUCTIONS", "utf8");
    const withAdditionalPrompt = new SceneDirectorService({
        aiClient,
        promptPath: primaryPromptPath,
        additionalPromptPath,
    });
    await withAdditionalPrompt.initialize();
    await withAdditionalPrompt.createFromAppearanceAndLatestMessages(
        "assistant",
        "user",
        "appearance",
        "ordered memory two",
    );
    assert.equal(
        receivedRequests[1].systemPrompt,
        "PRIMARY INSTRUCTIONS\n\nADDITIONAL SCENE-DIRECTOR INSTRUCTIONS\nPRIVATE INSTRUCTIONS",
    );
    assert.equal(receivedRequests[1].sessionMemory, "ordered memory two");
});

test("chat, session-memory analysis, and scene direction share one text model", () => {
    assert.equal(GROQ_ANALYZER_MODEL, GROQ_MODEL);
});

test("scene prompt normalization produces one unrestricted paragraph", () => {
    assert.equal(
        normalizeScenePrompt('```text\nPrompt: cinematic   scene\nwith rain\n```'),
        "cinematic scene with rain",
    );
    assert.equal(normalizeScenePrompt("x".repeat(5000)).length, 5000);
    assert.equal(
        normalizeScenePrompt(
            "score_9, score_8_up, masterpiece, best quality, photorealistic, cinematic photography, silver-haired woman, no text, no logo",
        ),
        "silver-haired woman",
    );
});

test("photo caption uses an expandable Telegram blockquote and escapes HTML", () => {
    const caption = buildImageCaption("woman < window & rain > street");
    assert.match(caption, /<blockquote expandable>/);
    assert.match(caption, /&lt; window &amp; rain &gt;/);
    assert.ok(caption.length <= 1024);
});

test("regenerate keyboard stores only a compact prompt reference", () => {
    const promptId = "12345678-1234-4234-8234-123456789abc";
    const keyboard = buildRegenerateImageKeyboard(promptId);
    const button = keyboard.reply_markup.inline_keyboard[0][0];

    assert.equal(button.text, "🔄 Regenerate");
    assert.equal(button.callback_data, `regenerate_image:${promptId}`);
    assert.ok(button.callback_data.length <= 64);
});

test("long scene prompts stay intact for generation and use a safe caption preview", () => {
    const scenePrompt = `woman < rain & neon > ${"detailed scene ".repeat(200)}`;
    const normalizedPrompt = normalizeScenePrompt(scenePrompt);
    const caption = buildImageCaption(normalizedPrompt);

    assert.equal(normalizedPrompt, scenePrompt.trim().replace(/\s+/g, " "));
    assert.ok(normalizedPrompt.length > 1024);
    assert.ok(caption.length <= 1024);
    assert.match(caption, /<blockquote expandable>/);
    assert.match(caption, /&lt; rain &amp; neon &gt;/);
    assert.match(caption, /…<\/blockquote>$/);
});

test("scene-director artifacts stay in logs but out of conversation context", () => {
    const history = parseSessionHistory(
        [
            "[2026-01-01 10:00:00.000] User: Continue the story",
            "[2026-01-01 10:00:01.000] Friendly: The door opens.",
            "[2026-01-01 10:00:02.000] Artifact(Scene Director): cinematic doorway",
            "[2026-01-01 10:00:02.100] Artifact(Pipeline Timing): Pipeline timing | Total: 2.00s",
            "[2026-01-01 10:00:02.200] Artifact(Image Regeneration Timing): Regeneration timing | Total: 1.00s",
            "[2026-01-01 10:00:03.000] User: What happens next?",
        ].join("\n"),
    );

    assert.deepEqual(history, [
        { role: "user", content: "Continue the story" },
        { role: "assistant", content: "The door opens." },
        { role: "user", content: "What happens next?" },
    ]);
});

test("per-account image preference defaults on and persists scene direction", async () => {
    const rootDirectory = path.join(
        "chat_memory",
        `test-image-preferences-${process.pid}`,
    );
    const service = new ImagePreferenceService({
        rootDirectory,
        defaultEnabled: true,
        promptHistoryLimit: 2,
    });
    const user = { id: 1001, username: "tester" };

    try {
        await service.initialize();
        assert.equal(await service.getPreference(user), true);
        await service.setPreference(user, false);
        assert.equal(await service.getPreference(user), false);
        const promptRecord = await service.recordScenePrompt({
            user,
            chatId: 5001,
            assistantResponse: "The final story reply.",
            scenePrompt: "cinematic final scene",
        });
        assert.match(promptRecord.id, /^[0-9a-f-]{36}$/i);
        assert.equal(
            (
                await service.getScenePrompt({
                    user,
                    chatId: 5001,
                    promptId: promptRecord.id,
                })
            ).scenePrompt,
            "cinematic final scene",
        );
        assert.equal(
            await service.getScenePrompt({
                user,
                chatId: 9999,
                promptId: promptRecord.id,
            }),
            null,
        );

        const stored = JSON.parse(
            await fs.readFile(
                path.join(rootDirectory, "1001", "image-generation.json"),
                "utf8",
            ),
        );
        assert.equal(stored.imageGenerationEnabled, false);
        assert.equal(
            stored.scenePrompts[0].source,
            "character_appearance_file_and_latest_messages_scene",
        );
        assert.equal(stored.scenePrompts[0].scenePrompt, "cinematic final scene");
        assert.equal(stored.scenePrompts[0].assistantResponse, "The final story reply.");
    } finally {
        await fs.rm(rootDirectory, { recursive: true, force: true });
    }
});

test("image pipeline keeps ComfyUI loaded without model handoffs", async () => {
    const events = [];
    const pipeline = new ImagePipeline({
        sceneDirector: {
            async createFromAppearanceAndLatestMessages(
                assistantMessage,
                userMessage,
                appearance,
                sessionMemory,
            ) {
                events.push(
                    `direct:${assistantMessage}:${userMessage}:${appearance}:${sessionMemory}`,
                );
                return "directed prompt";
            },
        },
        comfyUIService: {
            async generate(prompt, seed) {
                events.push(`generate:${prompt}:${seed}`);
                return { buffer: Buffer.from("image") };
            },
        },
        seedGenerator: () => 42,
    });

    const result = await pipeline.run({
        latestAssistantResponse: "latest only",
        latestUserMessage: "user request",
        characterAppearance: "silver hair",
        sessionMemoryContext: "ordered session state",
        async onPromptReady(prompt) {
            events.push(`persist:${prompt}`);
        },
        async onGenerationStart() {
            events.push("status");
        },
        async onImageReady() {
            events.push("deliver");
        },
    });

    assert.deepEqual(events, [
        "direct:latest only:user request:silver hair:ordered session state",
        "persist:directed prompt",
        "status",
        "generate:directed prompt:42",
        "deliver",
    ]);
    for (const value of Object.values(result.timings)) {
        assert.ok(Number.isFinite(value) && value >= 0);
    }
});

test("image pipeline surfaces local ComfyUI generation failures directly", async () => {
    const events = [];
    const pipeline = new ImagePipeline({
        sceneDirector: {
            async createFromAppearanceAndLatestMessages() {
                return "directed prompt";
            },
        },
        comfyUIService: {
            async generate() {
                events.push("generate-failed");
                throw new Error("generation failed");
            },
        },
        seedGenerator: () => 42,
    });

    await assert.rejects(
        pipeline.run({
            latestAssistantResponse: "latest only",
            latestUserMessage: "user request",
            async onPromptReady() {},
            async onGenerationStart() {},
            async onImageReady() {},
        }),
        /generation failed/,
    );
    assert.deepEqual(events, ["generate-failed"]);
});

test("image regeneration reuses the stored prompt without model handoffs", async () => {
    const events = [];
    const pipeline = new ImagePipeline({
        sceneDirector: {
            async createFromAppearanceAndLatestMessages() {
                throw new Error("scene director must not run during regeneration");
            },
        },
        comfyUIService: {
            async generate(prompt, seed) {
                events.push(`generate:${prompt}:${seed}`);
                return { buffer: Buffer.from("regenerated-image") };
            },
        },
        seedGenerator: () => 84,
    });

    const result = await pipeline.regenerate({
        scenePrompt: "the complete stored direction",
        async onGenerationStart() {
            events.push("status");
        },
        async onImageReady() {
            events.push("deliver");
        },
    });

    assert.deepEqual(events, [
        "status",
        "generate:the complete stored direction:84",
        "deliver",
    ]);
    assert.equal(result.scenePrompt, "the complete stored direction");
});

test("regenerate callback retrieves the private prompt and sends a separate photo", async () => {
    const promptId = "12345678-1234-4234-8234-123456789abc";
    const scenePrompt = "same stored image direction";
    const events = [];
    const artifacts = [];
    let queuedPromise;
    let registration;

    registerImageRegenerationHandler(
        {
            action(pattern, handler) {
                registration = { pattern, handler };
            },
        },
        {
            preferences: {
                async getScenePrompt(request) {
                    events.push(`lookup:${request.chatId}:${request.promptId}`);
                    return { id: promptId, scenePrompt };
                },
            },
            queue: {
                add(task) {
                    events.push("queue");
                    queuedPromise = task();
                    return { promise: queuedPromise, position: 1, queued: false };
                },
            },
            pipeline: {
                async regenerate({
                    scenePrompt: receivedPrompt,
                    onGenerationStart,
                    onImageReady,
                }) {
                    events.push(`regenerate:${receivedPrompt}`);
                    await onGenerationStart();
                    await onImageReady({ buffer: Buffer.from("new-photo") });
                    return {
                        timings: {
                            imageStatusMs: 1,
                            imageGenerationMs: 1,
                            imageDeliveryMs: 1,
                            totalMs: 3,
                        },
                    };
                },
            },
            imageGenerationAvailable: true,
            async artifactWriter(chatId, label, report) {
                artifacts.push({ chatId, label, report });
            },
        },
    );

    assert.match(`regenerate_image:${promptId}`, registration.pattern);
    const photos = [];
    const callbackAnswers = [];
    const ctx = {
        chat: { id: 5001 },
        from: { id: 1001, username: "tester" },
        match: [`regenerate_image:${promptId}`, promptId],
        telegram: {},
        async answerCbQuery(message) {
            callbackAnswers.push(message);
        },
        async reply(message) {
            events.push(`status:${message}`);
            return { message_id: 7001 };
        },
        async deleteMessage(messageId) {
            events.push(`delete:${messageId}`);
        },
        async sendChatAction(action) {
            events.push(`action:${action}`);
        },
        async replyWithPhoto(photo, options) {
            photos.push({ photo, options });
        },
    };

    await registration.handler(ctx);
    await queuedPromise;

    assert.deepEqual(callbackAnswers, ["Regenerating image..."]);
    assert.match(events.join("\n"), /lookup:5001:/);
    assert.match(events.join("\n"), /regenerate:same stored image direction/);
    assert.equal(photos.length, 1);
    assert.match(photos[0].options.caption, /same stored image direction/);
    assert.equal(
        photos[0].options.reply_markup.inline_keyboard[0][0].callback_data,
        `regenerate_image:${promptId}`,
    );
    assert.equal(artifacts.length, 1);
    assert.equal(artifacts[0].chatId, 5001);
    assert.equal(artifacts[0].label, "Image Regeneration Timing");
    assert.match(artifacts[0].report, /Image regeneration timing for tester/);
    assert.doesNotMatch(artifacts[0].report, /\r|\n/);
});

test("the committed workflow injects prompt, private checkpoint, and seed into a clone", async () => {
    const workflow = JSON.parse(
        await fs.readFile("src/image/workflow_api.json", "utf8"),
    );
    const mappings = {
        positivePromptNodeId: "67",
        positivePromptInput: "text",
        checkpointNodeId: "73",
        checkpointInput: "ckpt_name",
        seedNodeId: "94",
        seedInput: "seed",
        additionalSeedMappings: [],
        saveImageNodeId: "84",
    };

    assert.equal(workflow["73"].inputs.ckpt_name, "");
    assert.equal(workflow["84"].inputs.filename_prefix, "cyberpony");
    assert.deepEqual(workflow["84"].inputs.images, ["65", 0]);
    assert.equal(validateWorkflowMappings(workflow, mappings), true);
    const injected = cloneAndInjectWorkflow(workflow, mappings, {
        prompt: "directed prompt",
        seed: 123,
        checkpointName: "private-runtime-checkpoint",
    });
    assert.equal(injected["67"].inputs.text, "directed prompt");
    assert.equal(injected["73"].inputs.ckpt_name, "private-runtime-checkpoint");
    assert.equal(injected["94"].inputs.seed, 123);
    assert.equal(workflow["73"].inputs.ckpt_name, "");
});

test("conversation queue runs model-sensitive jobs serially", async () => {
    const queue = new SerialTaskQueue({ maxSize: 3 });
    const events = [];
    let releaseFirst;
    const firstGate = new Promise((resolve) => {
        releaseFirst = resolve;
    });

    const first = queue.add(async () => {
        events.push("first-start");
        await firstGate;
        events.push("first-end");
    });
    const second = queue.add(async () => {
        events.push("second-start");
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(events, ["first-start"]);
    releaseFirst();
    await Promise.all([first.promise, second.promise]);
    assert.deepEqual(events, ["first-start", "first-end", "second-start"]);
});

test("conversation queue runs foreground work before waiting session-memory analysis", async () => {
    const queue = new SerialTaskQueue({ maxSize: 3 });
    const events = [];
    let releaseFirst;
    const firstGate = new Promise((resolve) => {
        releaseFirst = resolve;
    });

    const first = queue.add(async () => {
        events.push("first-start");
        await firstGate;
        events.push("first-end");
    });
    const sessionMemory = queue.add(
        async () => {
            events.push("session-memory");
        },
        { priority: "background" },
    );
    const nextMessage = queue.add(async () => {
        events.push("next-message");
    });

    await new Promise((resolve) => setImmediate(resolve));
    releaseFirst();
    await Promise.all([first.promise, sessionMemory.promise, nextMessage.promise]);
    assert.deepEqual(events, [
        "first-start",
        "first-end",
        "next-message",
        "session-memory",
    ]);
});

