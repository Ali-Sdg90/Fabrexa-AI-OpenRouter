# Troubleshooting

Start with the complete project check:

```bash
npm run check
```

It runs lint and tests before reporting missing local tools, invalid required values, Ollama connection problems, and unavailable models. Use `npm run check:setup` when you only need the environment and Ollama checks.

## Node.js is too old

Check the installed version:

```bash
node --version
```

Fabrexa requires Node.js 22 or newer. Install a current Node.js 22 release, reopen the terminal, and run `npm install` again.

## `.env` is missing

Copy the example file before starting the bot:

```bash
cp .env.example .env
```

On Windows Command Prompt:

```bat
copy .env.example .env
```

Then replace the placeholder token, owner ID, and owner username.

## `TELEGRAM_BOT_TOKEN is not set`

Make sure `.env` contains a token created by [@BotFather](https://t.me/botfather):

```env
TELEGRAM_BOT_TOKEN=your_actual_token
```

Do not add extra spaces around the value. Restart the bot after changing `.env`.

`npm run check` confirms that a value exists, but it does not ask Telegram whether the token is valid. A malformed or revoked token normally fails when the bot starts.

## `OWNER_ID must be a numeric Telegram user id`

Private mode requires a numeric owner ID:

```env
BOT_PRIVATE=true
OWNER_ID=123456789
```

Do not use a Telegram username. If you intentionally want a shared bot, set `BOT_PRIVATE=false`; understand that anyone who can reach the bot can then use your local model.

## `OWNER_USERNAME must be a valid Telegram username`

Private mode also requires the public Telegram username that should receive access requests:

```env
BOT_PRIVATE=true
OWNER_USERNAME=your_telegram_username
```

This is separate from `OWNER_ID`: the numeric ID authorizes access, while the username is shown to users who cannot access the private instance. You may include or omit the leading `@`. Use 5 to 32 letters, numbers, or underscores, and restart the bot after changing `.env`.

## Ollama is not reachable

Start Ollama and confirm its local API is available:

```bash
ollama serve
```

The default address is:

```env
OLLAMA_BASE_URL=http://127.0.0.1:11434
```

If Ollama runs on another machine, set its reachable base URL without adding `/api/chat`.

## The configured model is missing

List installed models:

```bash
ollama list
```

Install the example model:

```bash
ollama pull gemma3:12b
```

The value in `.env` must match the model name shown by `ollama list`:

```env
OLLAMA_MODEL=gemma3:12b
```

For a Hugging Face GGUF model, keep the exact `hf.co/...` reference used by the Ollama command.

## The bot starts but messages fail

Check these items:

1. Ollama is still running.
2. `OLLAMA_MODEL` matches an installed model.
3. The tracked `personalities/prompts/Friendly.txt` file is present.
4. Its matching `personalities/appearances/Friendly.txt` file is present.
5. Any custom personality file has a non-empty prompt.
6. The request timeout is long enough for your hardware.

The included `personalities/prompts/Friendly.txt` file begins like this:

```text
Name: Friendly
Prompt:
You are Friendly, a warm, thoughtful, and easygoing assistant.
```

## Replies are slow or stop early

Local generation speed depends on the selected model, quantization, context size, and available CPU, RAM, GPU, and VRAM. Larger, more capable models generally need more resources and time.

Try a smaller model or reduce these values:

```env
OLLAMA_NUM_CTX=4096
OLLAMA_MAX_TOKENS=256
```

If generation needs more time, increase:

```env
REQUEST_TIMEOUT=180000
```

Telegram response edits are intentionally limited. `TELEGRAM_STREAM_EDIT_INTERVAL_MS` controls the initial interval, and the bot increases later delays to avoid excessive edits.

## A personality does not appear

- Place the chat prompt inside `personalities/prompts/`.
- Place a same-named appearance-only file inside `personalities/appearances/` for automatic image identity.
- Use the `.txt` extension.
- Restart the bot after adding or renaming a file.
- Give each file a distinct filename because the filename becomes its key.

Personality files are loaded when the process starts, not while it is running.

## Automatic images do not start

Run `npm run check:setup`. With automatic images available, it verifies that the private checkpoint setting exists, the workflow and scene-director files are present, and the local ComfyUI `/queue` endpoint responds.

Keep the actual checkpoint filename only in ignored `.env`:

```env
IMAGE_GENERATION_AVAILABLE=true
COMFYUI_BASE_URL=http://127.0.0.1:8188
COMFYUI_CHECKPOINT_NAME=your-local-checkpoint-file.safetensors
```

Do not put the checkpoint filename into `src/image/workflow_api.json`, Telegram messages, logs intended for publication, or commits. The committed workflow intentionally has a blank `ckpt_name` and receives the value at runtime.

If only one Telegram account has no images, open **Image Settings** and re-enable them. The choice is stored in `chat_memory/users/<telegram-id>/image-generation.json` and applies to every personality.

Fabrexa has no hosted image fallback. The configured ComfyUI service and checkpoint must be available on the host running the image pipeline.

## GPU handoff fails

Fabrexa will not start ComfyUI generation until the text model is verified as unloaded. After Telegram receives the image, Fabrexa asks ComfyUI to unload its models, verifies VRAM cleanup, and preloads the text model again. Check these items:

1. ComfyUI is running locally and no unrelated workflow is active or queued.
2. Ollama and ComfyUI point to the same expected GPU environment.
3. The `/queue`, `/system_stats`, and `/free` ComfyUI endpoints are available.
4. Increase the `OLLAMA_HANDOFF_TIMEOUT_MS` or ComfyUI cleanup timeout only when logs show a real timeout on slower hardware.

Conversation jobs and background session-memory analysis are serialized, but a manually launched external Ollama or ComfyUI job is outside Fabrexa's queue and can still interfere.

## Session memory does not update

Session-memory analysis starts only after the assistant reply and any optional image delivery, cleanup, and text-model recovery are complete. It runs as lower-priority background model work, so a waiting user conversation runs first.

Check these items:

1. Open `chat_memory/<chat-id>/sessions/<session-id>/session-memory.json`, not a file from an older session.
2. Confirm that the configured `OLLAMA_MODEL` is available; the same model handles replies, scene direction, and memory analysis.
3. Look for `Session memory analysis failed` in the console output.
4. Allow the local model to finish. This analysis has no operation timeout, so slower hardware can take longer without being cancelled.

The analyzer intentionally records only developments useful for later continuity. An exchange with no durable story, character, relationship, location, goal, clothing, or object-state change may leave the memory unchanged.

## Detailed diagnostics

Enable development logging temporarily:

```env
LOG_MODE=dev-mode
```

Restart the bot and reproduce the issue. These logs can contain the full Ollama payload, personality prompt, conversation history, and session-memory context. Do not publish them without reviewing the contents.

Return to normal logging afterward:

```env
LOG_MODE=normal
```

## Resetting local runtime data

Starting a new chat from Telegram creates fresh conversational context and an empty session memory.

The `chat_memory/` folder contains conversation sessions and their continuity-memory files. Back it up before manually changing or removing anything. Deleting it permanently removes the bot's local conversation state and saved session memories.
