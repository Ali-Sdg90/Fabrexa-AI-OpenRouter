import { ImageQueueFullError } from "./errors.js";

export class SerialTaskQueue {
    #active = false;
    #activePriority = null;
    #foregroundPending = [];
    #backgroundPending = [];

    constructor({ maxSize = 5 } = {}) {
        this.maxSize = maxSize;
    }

    get size() {
        return (
            Number(this.#active) +
            this.#foregroundPending.length +
            this.#backgroundPending.length
        );
    }

    get foregroundSize() {
        return (
            Number(this.#activePriority === "foreground") +
            this.#foregroundPending.length
        );
    }

    add(task, { priority = "foreground" } = {}) {
        if (typeof task !== "function") {
            throw new TypeError("Queue task must be a function.");
        }
        if (!new Set(["foreground", "background"]).has(priority)) {
            throw new TypeError("Queue priority must be foreground or background.");
        }
        if (priority === "foreground" && this.foregroundSize >= this.maxSize) {
            throw new ImageQueueFullError("The conversation queue is full.");
        }

        const position =
            Number(this.#active) + this.#foregroundPending.length + 1;
        let resolveTask;
        let rejectTask;
        const promise = new Promise((resolve, reject) => {
            resolveTask = resolve;
            rejectTask = reject;
        });
        const entry = { task, resolveTask, rejectTask, priority };
        if (priority === "background") {
            this.#backgroundPending.push(entry);
        } else {
            this.#foregroundPending.push(entry);
        }
        queueMicrotask(() => this.#drain());

        return Object.freeze({ promise, position, queued: position > 1 });
    }

    async #drain() {
        if (
            this.#active ||
            (this.#foregroundPending.length === 0 &&
                this.#backgroundPending.length === 0)
        ) {
            return;
        }

        const entry =
            this.#foregroundPending.shift() || this.#backgroundPending.shift();
        this.#active = true;
        this.#activePriority = entry.priority;
        try {
            entry.resolveTask(await entry.task());
        } catch (error) {
            entry.rejectTask(error);
        } finally {
            this.#active = false;
            this.#activePriority = null;
            queueMicrotask(() => this.#drain());
        }
    }
}

