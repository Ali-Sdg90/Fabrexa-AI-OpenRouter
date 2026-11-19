# Project Guide

This guide covers Fabrexa's local text and image runtimes, configuration, personalities, and per-session continuity behavior. Start with the main [README](../README.md) if you only want to install and run the bot.

## Runtime flow

Fabrexa uses Telegram as the chat interface, Ollama as the local text-model server, and ComfyUI as the optional local image runtime.

```text
Telegram update
    ↓
Telegraf handlers
    ↓
Access check
    ↓
Conversation and personality context
    ↓
Ollama /api/chat
    ↓
Streamed Telegram reply
    ├── text-only: continue to memory analysis
    └── image enabled
          ↓
        Appearance + session continuity + latest exchange
          ↓
        Unload text model → local ComfyUI image → Telegram photo
          ↓
        Unload image model → preload text model
    ↓
Background session-memory analysis
    ↓
Ordered session state for the next turn
```

For each normal text message, the bot:

1. Checks access when private mode is enabled.
2. Loads the active personality and conversation session.
3. Loads up to 24 recent messages and a bounded chronological continuity memory from the active session, then trims the oldest conversation messages when the history token budget or context window requires it.
4. Sends the request to Ollama with streaming enabled.
5. Shows a compact model/personality/session-memory placeholder, then replaces it as soon as the first streamed text chunk arrives and continues throttled edits.
6. Stores and finishes sending the final conversation locally.
7. If the Telegram account has automatic images enabled, asks the same text model to direct one still image. The matching file under `personalities/appearances/` supplies stable character appearance and defaults; ordered session continuity memory supplies relevant prior story state; the final assistant reply supplies the immediate narrative moment; and the latest user message supplies the requested scene and changes. Later memory entries override earlier conflicting memory, the latest exchange overrides memory, and explicit user-request details take precedence over conflicting assistant-reply details. The personality system prompt and raw earlier history outside the supplied session memory are not included.
8. Stores the scene direction in the session log and the user's private image record without adding it to future conversation context.
9. Unloads the text model, sends a small image-building status, runs ComfyUI with the complete direction, and sends the result with the direction inside an expandable caption and a Regenerate button. Only the displayed caption is shortened when Telegram's fixed caption limit requires it.
10. Deletes the status, unloads the ComfyUI model, and preloads the text model for the next queued message.
11. After the reply and optional image cleanup are complete, queues lower-priority analysis of the latest user/assistant exchange and appends important developments to the active session's ordered memory. A later reply or image direction can use that state.

After successful photo delivery and model recovery, the console reports wall-clock durations for request setup, queue wait, text-model preparation, context/session memory, text generation and delivery, scene direction, prompt persistence, both model handoffs, image generation and delivery, time until the photo, and total time including cleanup. The same report is appended to the active session as `Artifact(Pipeline Timing)`.

The Regenerate callback stores only the saved scene-prompt ID. The handler verifies the Telegram user and chat, retrieves the full private prompt, enters the shared serial queue, performs the same text-to-image-to-text model handoff with a new seed, sends a new photo message with the same caption and button, and logs regeneration timings to the console and `Artifact(Image Regeneration Timing)` in the active session. It does not rerun chat generation or scene direction.

The Ollama request includes `temperature`, `top_p`, `num_ctx`, `num_predict`, and `keep_alive` from the environment configuration.

## Local inference boundary

Ollama runs the configured text model for chat replies, scene direction, and session-memory analysis. ComfyUI runs the separately configured image checkpoint when automatic images are available. Both services are expected on local or explicitly configured host addresses, and Fabrexa has no hosted inference fallback. Telegram transports user messages, streamed answers, and generated photos, but model execution and runtime files remain on the host machine.

The example configuration uses `gemma3:12b`, but the runtime can use compatible Ollama models and GGUF model references. Text quality, image quality, speed, and memory usage depend on the selected models, quantization, workflow, and available hardware.

## Main modules

| Path | Responsibility |
| --- | --- |
| `bot.js` | Application entry point |
| `src/bot/` | Telegram commands, quick actions, callbacks, and access control |
| `src/ai/client.js` | Ollama request construction and streaming |
| `src/config/index.js` | Environment parsing and defaults |
| `src/personalities/` | Personality file loading |
| `src/memory/index.js` | Conversation-session storage and history parsing |
| `src/memory/sessionMemory.js` | Ordered per-session continuity memory and analysis |
| `src/image/` | Scene direction, per-user preference/history, serial queue, ComfyUI workflow, and model handoff |

## Personalities

Each personality uses two same-named local `.txt` files. `personalities/prompts/<key>.txt` is the chat system prompt, while `personalities/appearances/<key>.txt` contains only stable visual identity, body, clothing, and accessory details for image direction. The filename without `.txt` is the personality key.

```text
Name: Friendly
Prompt:
You are Friendly, a warm, thoughtful, and easygoing assistant.
```

The `Name` line in the prompt file is shown in Telegram. Everything after `Prompt:` becomes the personality prompt. The appearance file is plain text and is never added to chat context.

The tracked prompt and appearance files for Friendly provide the default personality. The repository also includes paired files for Elara Voss, Sherlock Holmes, and Vent Girl, so a fresh clone is ready to use. Additional files in both personality folders remain ignored by Git to keep private prompts and private appearance references out of commits.

## Conversation and memory

Fabrexa stores runtime data under `chat_memory/<chat-id>/`.

| File | Purpose |
| --- | --- |
| `meta.json` | Active session number and selected personality |
| `sessions/<session-id>/chat.txt` | Messages and non-conversational artifacts from one session |
| `sessions/<session-id>/session-memory.json` | Ordered narrative continuity memory for that session |
| `users/<telegram-id>/image-generation.json` | Per-account image preference and recent scene directions |

### Recent conversation

Recent messages from the active session provide normal conversational context. By default, Fabrexa considers up to 24 previous messages with an approximate 4096-token history budget. It also reserves room for the system and personality prompt, session memory, the latest user message, the configured maximum response, and a small safety margin. If everything does not fit, the oldest history messages are removed first. Starting a new chat creates a new session, so earlier session messages are no longer included. Scene-direction and pipeline-timing artifact entries remain auditable in the session file but are skipped by the conversation parser.

### Session continuity memory

Every personality and chat uses a separate continuity memory for each session. After the completed assistant reply and optional image delivery/cleanup, the local text model receives only the latest user message, latest assistant response, and the strict session-memory analyzer prompt. It returns JSON entries for important story developments such as character identity and state, clothing changes, locations, events, goals, relationships, discoveries, and object state. Entries retain sequence and turn numbers so later state can supersede earlier state without rewriting history.

This analysis is queued as background model work. Waiting user conversations take priority, and ComfyUI and Ollama work remain serialized. The complete JSON file stays local and has no Telegram view or edit interface. A bounded recent portion is supplied to future chat and image-direction prompts as chronological data. Starting a new chat creates an empty continuity memory, and entries are never promoted across sessions.

## Environment reference

The repository's [`.env.example`](../.env.example) is the source of truth for a ready-to-copy configuration.

### Telegram

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Yes | None | Token created with BotFather |
| `OWNER_ID` | In private mode | None | Numeric Telegram user allowed to use the bot |
| `OWNER_USERNAME` | In private mode | None | Public contact handle shown to users denied access |
| `BOT_PRIVATE` | No | `true` | Restricts access to `OWNER_ID` |

`OWNER_ID` is used for authorization and must be numeric. `OWNER_USERNAME` is displayed in the private-mode response so other users can request access; it may be entered with or without the leading `@`. When `BOT_PRIVATE=false`, any Telegram user who can reach the bot can use it, and neither owner value is required. Runtime data is still separated by Telegram chat ID.

### Ollama and generation

| Variable | Default | Purpose |
| --- | --- | --- |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama server base URL without `/api/chat` |
| `OLLAMA_MODEL` | `llama3.1` in code | Main chat model |
| `OLLAMA_KEEP_ALIVE` | `5m` | How long Ollama keeps a model loaded |
| `OLLAMA_NUM_CTX` | `8192` | Context window size |
| `OLLAMA_TEMPERATURE` | `0.8` | Sampling temperature |
| `OLLAMA_TOP_P` | `0.9` | Nucleus sampling value |
| `OLLAMA_MAX_TOKENS` | `2048` | Maximum generated tokens per response |
| `OLLAMA_MIN_RESPONSE_WORDS` | `250` | Minimum combined response length; `0` disables automatic continuation |
| `OLLAMA_MAX_CONTINUATIONS` | `2` | Maximum extra Ollama requests for a response below the minimum |
| `CHAT_HISTORY_MAX_MESSAGES` | `24` | Maximum previous conversation messages considered per response |
| `CHAT_HISTORY_MAX_TOKENS` | `4096` | Approximate token budget for previous conversation messages |
| `SESSION_MEMORY_PROMPT_PATH` | `src/memory/session-memory-prompt.txt` | Strict analyzer prompt for per-session continuity memory |
| `SESSION_MEMORY_MAX_PROMPT_TOKENS` | `2048` | Approximate session-memory budget included in later replies |
| `PERSONALITY_INSTRUCTION` | Built-in instruction | Final shared instruction added after the selected personality prompt |
| `REQUEST_TIMEOUT` | `120000` | Ollama request timeout in milliseconds |

`.env.example` selects `gemma3:12b`, so a normal installation uses that model unless you change it.

The same `OLLAMA_MODEL` is intentionally used for chat replies, session-memory analysis, and scene direction. This keeps the runtime to one text model plus one private ComfyUI checkpoint.

The director receives the selected character's standalone appearance file, the bounded ordered continuity memory from earlier turns in the active session, and the latest assistant/user exchange. It does not receive the personality prompt or raw earlier messages outside the supplied session memory. Stable face, eyes, hair, skin, body, and proportions come from the appearance file; current clothing, injuries, location, relationships, objects, and prior events can carry forward from session memory; and the latest exchange defines the current scene, action, pose, expression, setting, and composition. Later memory entries supersede earlier conflicting entries, while the latest messages supersede memory. The assistant character is prioritized over the environment and over any user representation.

### Automatic image generation

| Variable | Default | Purpose |
| --- | --- | --- |
| `IMAGE_GENERATION_AVAILABLE` | `true` | Exposes automatic image settings and initializes the image runtime |
| `IMAGE_GENERATION_DEFAULT_ENABLED` | `true` | Default for a Telegram account with no saved preference |
| `IMAGE_SCENE_DIRECTOR_PROMPT_PATH` | `src/image/scene-director.txt` | Scene-director system prompt |
| `IMAGE_GENERATION_QUEUE_MAX_SIZE` | `5` | Maximum active and waiting model-sensitive jobs |
| `COMFYUI_BASE_URL` | `http://127.0.0.1:8188` | Local ComfyUI HTTP server |
| `COMFYUI_WORKFLOW_PATH` | `src/image/workflow_api.json` | API-format image workflow |
| `COMFYUI_CHECKPOINT_NAME` | None | Required private checkpoint filename; never commit it |
| `OLLAMA_HANDOFF_TIMEOUT_MS` | `30000` | Maximum verified text-model load or unload wait |

The committed workflow deliberately leaves `ckpt_name` empty. At runtime the value comes only from ignored `.env`. Node mappings, ComfyUI polling/cleanup controls, and scene-director sampling controls are documented in [`.env.example`](../.env.example).

All incoming conversations and background session-memory analysis share a serial queue. This prevents a new Ollama request from starting while the ComfyUI model owns GPU memory. Long work continues outside Telegraf's update-handler lifetime.

### Streaming, memory, and logs

| Variable | Default | Purpose |
| --- | --- | --- |
| `TELEGRAM_STREAM_EDIT_INTERVAL_MS` | `6000` | Initial delay between Telegram response edits |
| `LOG_MODE` | `normal` | Use `dev-mode`, `debug`, or `verbose` for payload diagnostics |
| `LOG_LEVEL` | `INFO` | Configured log-level value |

Detailed logging can include prompts, recent conversation content, and session-memory context. Use it only while diagnosing local behavior.

## Models from Hugging Face

Ollama can run compatible GGUF repositories from Hugging Face:

```bash
ollama run hf.co/<publisher>/<model>-GGUF:Q4_K_M
```

After the first run, place the exact reference in `.env`:

```env
OLLAMA_MODEL=hf.co/<publisher>/<model>-GGUF:Q4_K_M
```

Model names and available quantizations differ by repository. Follow the command shown on the model page or the [official Hugging Face Ollama guide](https://huggingface.co/docs/hub/ollama).

## Local validation

```bash
npm run check
```

`npm run check` performs static JavaScript checks, runs the focused automated tests, and then verifies:

- `.env` exists
- Node.js, npm, and the Ollama CLI are available
- Required environment values are present
- Every personality prompt has a same-named appearance file
- The Ollama server responds
- The configured model is installed
- The private checkpoint setting and image files are present
- The local ComfyUI queue endpoint responds

It prints `✅ All checks passed.` only after every step succeeds. Use `npm run check:setup` to run only environment and local-service checks. Neither command validates the Telegram token with Telegram or generates a real image.

Changes to Telegram interactions, streaming, personalities, and memory should also be checked manually with a test bot and local model.

## Static project website

The portfolio page is independent of the bot runtime and lives in `public/`.

```bash
python -m http.server 8000 --directory public
```

The site uses plain HTML, CSS, and JavaScript. It does not require a frontend build step.

## Security and privacy

- Keep `.env`, bot tokens, private personality prompts, and `chat_memory/` out of Git.
- Keep private mode enabled unless public access is intentional.
- Use a public contact username for `OWNER_USERNAME`; private-mode users will see it.
- Treat detailed development logs as sensitive because they can contain conversation context.
- Telegram transports the messages, even though model inference runs through the configured Ollama server.
- Back up `chat_memory/` before moving or replacing an installation if its saved conversations matter.

For common runtime failures, see [Troubleshooting](./TROUBLESHOOTING.md).
