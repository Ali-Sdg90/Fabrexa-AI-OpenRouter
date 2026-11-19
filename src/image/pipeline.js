function createPipelineTimings() {
    return {
        sceneDirectionMs: 0,
        promptPersistenceMs: 0,
        imageStatusMs: 0,
        imageGenerationMs: 0,
        imageDeliveryMs: 0,
        totalMs: 0,
    };
}

export class ImagePipeline {
    constructor({
        sceneDirector,
        comfyUIService,
        seedGenerator,
        now = Date.now,
    }) {
        this.sceneDirector = sceneDirector;
        this.comfyUIService = comfyUIService;
        this.seedGenerator = seedGenerator;
        this.now = now;
    }

    async initialize() {
        await Promise.all([
            this.sceneDirector.initialize(),
            this.comfyUIService.initialize(),
        ]);
    }

    async run({
        latestAssistantResponse,
        latestUserMessage,
        characterAppearance,
        sessionMemoryContext = "",
        onPromptReady,
        onGenerationStart,
        onImageReady,
    }) {
        const pipelineStartedAt = this.now();
        const timings = createPipelineTimings();

        let phaseStartedAt = this.now();
        const scenePrompt =
            await this.sceneDirector.createFromAppearanceAndLatestMessages(
                latestAssistantResponse,
                latestUserMessage,
                characterAppearance,
                sessionMemoryContext,
            );
        timings.sceneDirectionMs = this.now() - phaseStartedAt;

        // Persist the complete direction before starting local image generation.
        phaseStartedAt = this.now();
        await onPromptReady(scenePrompt);
        timings.promptPersistenceMs = this.now() - phaseStartedAt;

        return this.#generateFromPrompt({
            scenePrompt,
            onGenerationStart,
            onImageReady,
            pipelineStartedAt,
            timings,
        });
    }

    async regenerate({ scenePrompt, onGenerationStart, onImageReady }) {
        const prompt = String(scenePrompt || "").trim();
        if (!prompt) {
            throw new TypeError("A stored scene prompt is required.");
        }

        return this.#generateFromPrompt({
            scenePrompt: prompt,
            onGenerationStart,
            onImageReady,
            pipelineStartedAt: this.now(),
            timings: createPipelineTimings(),
        });
    }

    async #generateFromPrompt({
        scenePrompt,
        onGenerationStart,
        onImageReady,
        pipelineStartedAt,
        timings,
    }) {
        let phaseStartedAt = this.now();
        await onGenerationStart(scenePrompt);
        timings.imageStatusMs = this.now() - phaseStartedAt;

        phaseStartedAt = this.now();
        const result = await this.comfyUIService.generate(
            scenePrompt,
            this.seedGenerator(),
        );
        timings.imageGenerationMs = this.now() - phaseStartedAt;

        phaseStartedAt = this.now();
        await onImageReady({ ...result, scenePrompt });
        timings.imageDeliveryMs = this.now() - phaseStartedAt;

        timings.totalMs = this.now() - pipelineStartedAt;
        const frozenTimings = Object.freeze(timings);
        return { ...result, scenePrompt, timings: frozenTimings };
    }
}

