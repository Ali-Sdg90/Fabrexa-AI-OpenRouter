export class ImageGenerationError extends Error {
    constructor(message, options = {}) {
        super(message, options);
        this.name = this.constructor.name;
        this.details = options.details;
    }
}

export class ImageConfigurationError extends ImageGenerationError {}
export class ScenePromptError extends ImageGenerationError {}
export class ComfyUIError extends ImageGenerationError {}
export class ImageQueueFullError extends ImageGenerationError {}

