function createPipelineTimings() {
    return {
        sceneDirectionMs: 0,
        promptPersistenceMs: 0,
        textModelUnloadMs: 0,
        imageStatusMs: 0,
        imageGenerationMs: 0,
        imageDeliveryMs: 0,
        imageModelUnloadMs: 0,
        textModelReloadMs: 0,
        totalMs: 0,
    };
}

export class ImagePipeline {
    constructor({
        aiClient,
        sceneDirector,
        comfyUIService,
        seedGenerator,
        now = Date.now,
    }) {
        this.aiClient = aiClient;
        this.sceneDirector = sceneDirector;
        this.comfyUIService = comfyUIService;
        this.seedGenerator = seedGenerator;
        this.now = now;
        this.textModelReady = true;
        this.initialPreparationDone = false;
    }

    async initialize() {
        await Promise.all([
            this.sceneDirector.initialize(),
            this.comfyUIService.initialize(),
        ]);
    }

    async ensureTextModelReady() {
        if (this.textModelReady && this.initialPreparationDone) return;
        await this.comfyUIService.releaseModelsForTextInference();
        await this.aiClient.loadModelAndWait();
        this.textModelReady = true;
        this.initialPreparationDone = true;
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

        // Persist the complete direction before unloading the text model so a
        // failed record never starts the GPU handoff.
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
        await this.aiClient.unloadModelAndWait();
        timings.textModelUnloadMs = this.now() - phaseStartedAt;
        this.textModelReady = false;

        let primaryError = null;
        let imageDelivered = false;
        let result;
        try {
            phaseStartedAt = this.now();
            await onGenerationStart(scenePrompt);
            timings.imageStatusMs = this.now() - phaseStartedAt;

            phaseStartedAt = this.now();
            result = await this.comfyUIService.generate(
                scenePrompt,
                this.seedGenerator(),
            );
            timings.imageGenerationMs = this.now() - phaseStartedAt;

            phaseStartedAt = this.now();
            await onImageReady({ ...result, scenePrompt });
            timings.imageDeliveryMs = this.now() - phaseStartedAt;
            imageDelivered = true;
        } catch (error) {
            primaryError = error;
        }

        let recoveryError = null;
        try {
            // This intentionally runs after Telegram delivery: the image model
            // is unloaded first, then the same text model is preloaded again.
            phaseStartedAt = this.now();
            await this.comfyUIService.releaseModelsForTextInference();
            timings.imageModelUnloadMs = this.now() - phaseStartedAt;

            phaseStartedAt = this.now();
            await this.aiClient.loadModelAndWait();
            timings.textModelReloadMs = this.now() - phaseStartedAt;
            this.textModelReady = true;
            this.initialPreparationDone = true;
        } catch (error) {
            recoveryError = error;
        }

        timings.totalMs = this.now() - pipelineStartedAt;
        const frozenTimings = Object.freeze(timings);
        if (primaryError) {
            primaryError.imageDelivered = imageDelivered;
            primaryError.pipelineTimings = frozenTimings;
            if (recoveryError) primaryError.recoveryError = recoveryError;
            throw primaryError;
        }
        if (recoveryError) {
            recoveryError.imageDelivered = imageDelivered;
            recoveryError.pipelineTimings = frozenTimings;
            throw recoveryError;
        }
        return { ...result, scenePrompt, timings: frozenTimings };
    }
}

