# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Voices of the Court is an Electron-based desktop application that integrates Large Language Models (LLMs) into Crusader Kings 3. It enables players to have AI-powered conversations with in-game characters and allows those characters to trigger actions that impact the game state.

The application listens for clipboard events from CK3 (triggered by the mod), parses game data from debug logs, manages conversations with multiple API providers (OpenAI, OpenRouter, Gemini, custom endpoints), and writes game commands back to a file that CK3 reads.

## Development Commands

Build TypeScript:
```bash
npm run build
```

Start development mode (builds and launches):
```bash
npm run start
```

Package the application:
```bash
npm run package
```

Create distributables (runs type definitions generation first):
```bash
npm run make
```

Generate game data type definitions:
```bash
npm run createTypeDefs
```

## Architecture

### Main Process Flow

1. **App Initialization** (`src/main/main.ts`)
   - Single instance enforcement
   - User data directory check and initialization at `~/.config/Electron/votc_data` (Linux) or equivalent
   - Logging to `votc_data/logs/debug.log` with API key sanitization
   - Config loading from `votc_data/configs/config.json`
   - Window creation (ConfigWindow and ChatWindow)
   - ClipboardListener starts monitoring for game triggers

2. **Game Data Ingestion** (triggered by clipboard event `VOTC:IN`)
   - ClipboardListener detects `VOTC:IN` event from CK3
   - `parseLog()` reads the last `VOTC:IN` block from CK3's debug.log
   - Parses character data, traits, memories, secrets, opinions, and relationships
   - Creates a `GameData` object and multiple `Character` objects
   - Initializes a new `Conversation` instance

3. **Conversation Management** (`src/main/conversation/Conversation.ts`)
   - Loads conversation summaries from previous sessions with the same character
   - Configures 3 API connections (text generation, summarization, actions)
   - Loads action scripts from `votc_data/scripts/actions/`
   - Loads description and example message scripts
   - Manages message history with context window management (resummarization when context limit hit)

4. **Message Generation**
   - User sends message via chat window (IPC: `message-send`)
   - `generateAIsMessages()` generates responses for all non-player characters
   - For each character:
     - `buildChatPrompt()` constructs prompt with system message, example messages, description, summaries, memories, and conversation history
     - Prompt sent to LLM via `ApiConnection.complete()`
     - Response cleaned (removes preambles, character name prefixes, etc.)
     - `checkActions()` analyzes the conversation and suggests game actions
   - Messages and actions sent to ChatWindow via IPC

5. **Action System** (`src/main/conversation/checkActions.ts`)
   - Loads action definitions from `votc_data/scripts/actions/standard/` and `custom/`
   - Each action has a `check()` function (determines if action is valid in current context) and `execute()` function
   - LLM analyzes conversation and suggests actions in structured format: `<rationale>...</rationale><actions>action1(),action2()</actions>`
   - Actions validated and returned to UI for player approval
   - Approved actions executed via `RunFileManager` (writes CK3 script commands to `run/votc.txt`)

6. **Game State Communication**
   - `RunFileManager` writes to `{userFolderPath}/run/votc.txt`
   - CK3 mod reads this file and executes scripted effects
   - File cleared after execution or on event `VOTC:EFFECT_ACCEPTED`

7. **Conversation Summarization**
   - When chat window closes, `summarize()` is called
   - Conversation saved as text to `votc_data/conversation_history/{playerID}/{playerID}_{aiID}_{timestamp}.txt`
   - LLM generates summary via summarization API
   - Summary saved to `votc_data/conversation_summaries/{playerID}/{aiID}.json`
   - Summaries loaded in future conversations for continuity

### Key TypeScript Classes

**GameData** (`src/shared/gameData/GameData.ts`)
- Holds all parsed data from a conversation session
- Properties: date, scene, location, playerID, aiID, characters Map
- Created by `parseLog()` from CK3's debug log

**Character** (`src/shared/gameData/Character.ts`)
- Individual character data: id, names, age, traits, memories, secrets, opinions, relationships
- Multiple characters can be loaded for group conversations

**Conversation** (`src/main/conversation/Conversation.ts`)
- Central conversation orchestrator
- Manages: messages array, API connections, actions, summaries, current summary, RunFileManager
- Methods: `pushMessage()`, `generateAIsMessages()`, `generateNewAIMessage()`, `resummarize()`, `summarize()`

**Config** (`src/shared/Config.ts`)
- Configuration loaded from JSON
- Contains: API connection configs, prompts, script selections, feature flags
- `toSafeConfig()` redacts sensitive data (API keys, base URLs) for logging

**ApiConnection** (`src/shared/apiConnection.ts`)
- Abstraction for multiple LLM providers
- Supports: OpenAI, OpenRouter (chat and instruct modes), Gemini, custom endpoints
- Methods: `complete()` (with streaming support), `testConnection()`, token calculation
- Context limits loaded from `public/contextLimits.json`
- Implements retry logic for transient failures (429 errors, empty responses)

**ClipboardListener** (`src/main/ClipboardListener.ts`)
- Monitors clipboard for triggers from CK3 mod
- Events: `VOTC:IN` (conversation start), `VOTC:EFFECT_ACCEPTED` (action executed)

**RunFileManager** (`src/main/RunFileManager.ts`)
- Manages `{userFolderPath}/run/votc.txt` file
- Methods: `write()`, `append()`, `clear()`
- CK3 mod reads this file to execute scripted effects

### Configuration System

- **Main config**: `votc_data/configs/config.json` (user settings)
- **Default config**: `default_userdata/configs/default_config.json` (template)
- **Scripts**:
  - Description scripts: `votc_data/scripts/prompts/description/` (generate character/scene descriptions)
  - Example messages: `votc_data/scripts/prompts/example messages/` (few-shot examples for LLM)
  - Action scripts: `votc_data/scripts/actions/standard/` and `custom/` (game actions)

### Window Architecture

- **ConfigWindow** (`src/main/windows/ConfigWindow.ts`): Settings UI with tabs (connection, model settings, prompts, actions, summarization, system)
- **ChatWindow** (`src/main/windows/ChatWindow.ts`): Conversation UI, always created but hidden until triggered
- Both use IPC for main/renderer process communication
- Renderer code in `src/configWindow/` and `src/chatWindow/`

### Special Features

**Self-Talk Mode**: When `playerID === aiID`, character has an internal monologue (messages wrapped in asterisks). Uses `selfTalkPrompt` and `selectedSelfTalkExMsgScript` from config.

**Context Window Management**: When token count exceeds context limit, `resummarize()` removes oldest messages and creates a rolling summary via LLM, which is prepended to future prompts.

**Message Cleaning**: Removes AI-generated preambles, character name prefixes, and ensures AI doesn't generate responses for the player character.

**Multi-API Support**: Separate API connections for text generation, summarization, and actions. Can reuse text gen API or use dedicated endpoints.

## Important Patterns

### Variable Parsing
`parseVariables()` replaces placeholders in prompts with actual game data:
- `{date}`, `{scene}`, `{location}`, `{playerName}`, `{aiName}`, etc.
- Used in system prompts, descriptions, and action descriptions

### Script System
Scripts are JavaScript modules that export functions:
- **Description scripts**: `(gameData) => string` - Generate scene/character descriptions
- **Example message scripts**: `(gameData, characterId) => Message[]` - Provide few-shot examples
- **Action scripts**: Export `{ signature, description, check, execute }` objects

### IPC Events
Main process ↔ Renderer process communication:
- `message-send`: User sent message
- `message-receive`: AI response (non-streaming)
- `stream-start`, `stream-message`: Streaming response
- `actions-receive`: Actions for player approval
- `config-change`, `config-change-nested`, `config-change-nested-nested`: Config updates
- `error-message`: Display error to user

### API Connection Types
- `openai`: OpenAI API (chat mode)
- `openrouter`: OpenRouter API (supports chat and instruct modes via `forceInstruct` flag)
- `gemini`: Google Gemini API (custom fetch implementation)
- `custom`: Generic OpenAI-compatible endpoint (chat mode)

## Common Development Tasks

### Adding a New Action
1. Create a new `.js` file in `default_userdata/scripts/actions/standard/` or `custom/`
2. Export an object with: `signature` (function name), `description`, `check(gameData)`, `execute(gameData, args, runFileManager)`
3. Action automatically loaded on conversation start (unless in `disabledActions` config array)

### Modifying Prompts
System prompts stored in `Config` class (`mainPrompt`, `summarizePrompt`, `selfTalkPrompt`, etc.). Editable via ConfigWindow UI, saved to config.json.

### Supporting a New API Provider
1. Add type to `Connection.type` in `apiConnection.ts`
2. Implement in `ApiConnection.complete()` and `testConnection()`
3. Add context limit to `public/contextLimits.json` if known
4. Update `isChat()` if provider uses chat vs completion format

### Debugging Conversation Issues
- Check `votc_data/logs/debug.log` for detailed logging
- Verify game log path in config (CK3's `{userFolderPath}/logs/debug.log`)
- Ensure `VOTC:IN` block is present in CK3's debug log (mod must be active)
- Check `conversation_summaries/` and `conversation_history/` for past conversations

### TypeScript Build Issues
- Source: `src/**/*.ts`
- Output: `dist/**/*.js`
- Config: `tsconfig.json` (target: es6, module: commonjs, strict mode enabled)
- Sourcemaps enabled for debugging

## File Paths and Data Storage

User data stored in Electron's userData path + `votc_data/`:
- `configs/config.json`: User configuration
- `logs/debug.log`: Application logs (with API key sanitization)
- `conversation_summaries/{playerID}/{aiID}.json`: Conversation summaries per character
- `conversation_history/{playerID}/{playerID}_{aiID}_{timestamp}.txt`: Full conversation logs
- `scripts/`: User scripts (actions, prompts)
- `run/votc.txt`: Commands written to game (read by CK3 mod)

Game's user folder path configured in app, typically:
- Windows: `C:\Users\{user}\Documents\Paradox Interactive\Crusader Kings III`
- Linux: `~/.local/share/Paradox Interactive/Crusader Kings III`

## Testing API Connections

Use ConfigWindow's connection test button, which calls `ApiConnection.testConnection()`. Sends a "ping" message with `max_tokens: 1`. Returns success/failure and context limit warning if model not in `contextLimits.json`.

## Letta Integration (Optional)

Voices of the Court supports integration with Letta (formerly MemGPT) for persistent, stateful AI agents with managed memory systems. This is an optional feature that can be enabled via configuration.

### Architecture Overview

When Letta integration is enabled, VOTC can create persistent agents for CK3 characters that maintain memory across conversations and receive updates from in-game events.

**Core Components:**

1. **LettaAgentManager** (`src/main/letta/LettaAgentManager.ts`)
   - Manages save-specific agent mappings
   - Creates/retrieves Letta agents for characters
   - Handles agent initialization with character data
   - Manages agent backup/restore (TODO: implement with correct SDK methods)
   - Agent data stored in `votc_data/letta/saves/{save_id}/`

2. **EventBatcher** (`src/main/letta/EventBatcher.ts`)
   - Queues game events per agent
   - Batch flushes based on count, time, or conversation triggers
   - Prevents API spam by batching event updates

3. **MemoryTransformer** (`src/main/letta/MemoryTransformer.ts`)
   - Transforms third-person game events into first-person narratives
   - Uses LLM to generate character-perspective descriptions
   - Caches common event transformations for efficiency

4. **LettaMessageHandler** (`src/main/letta/LettaMessageHandler.ts`)
   - Handles message sending to Letta agents
   - Supports streaming and non-streaming responses
   - Converts Letta message types to VOTC format
   - Detects tool calls from agents and queues as actions

### Hybrid Flow

The **Conversation** class checks if a character has a Letta agent before generating messages:

```typescript
if (lettaEnabled && lettaAgentManager.hasAgent(character.id)) {
    // Use Letta agent
    generateLettaMessage(character);
} else {
    // Use traditional VOTC flow
    generateNewAIMessage(character);
}
```

This allows some characters to use Letta agents while others use the traditional system.

### Configuration

Letta settings in `config.json`:

- `lettaEnabled`: Enable/disable Letta integration
- `lettaServerUrl`: Letta server URL (default: `http://localhost:8283`)
- `lettaDefaultModel`: Default model for agents (e.g., `openai/gpt-4o-mini`)
- `lettaDefaultEmbedding`: Default embedding model
- `lettaEventBatchSize`: Number of events before forcing flush (default: 10)
- `lettaEventBatchTimeoutMs`: Max time before flushing events (default: 300000ms / 5 min)
- `lettaFirstPersonTransform`: Transform events to first-person (default: true)
- `lettaShowReasoning`: Show agent reasoning in debug logs (default: false)
- `lettaMaxEventQueueSize`: Max queued events before force flush (default: 50)
- `actionApprovalLevels`: Per-action approval settings (`auto`, `approval`, `blocked`)

### Save Isolation

Each CK3 save has independent agent storage:
- Agent mappings: `votc_data/letta/saves/{save_id}/agent_mappings.json`
- Agent backups: `votc_data/letta/saves/{save_id}/agent_backups/*.af`

Save ID is either provided by mod or generated from game data hash.

### Agent Memory Structure

Letta agents are initialized with:

**Core Memory Blocks:**
- `persona`: Character traits and personality
- `character_bio`: Name, age, house, culture, faith, titles
- `relationships`: Key relationships with other characters
- `current_context`: Recent in-game situation

**Archival Memory:**
- Character memories from game data
- Character secrets
- Conversation summaries from previous sessions

### Event Flow

1. CK3 mod triggers clipboard event (e.g., `VOTC:EVENT`)
2. Event parsed and queued in `EventBatcher` for relevant agent(s)
3. Events transformed to first-person if `lettaFirstPersonTransform` enabled
4. Events batched and flushed on:
   - Batch size reached (`lettaEventBatchSize`)
   - Timeout expired (`lettaEventBatchTimeoutMs`)
   - Conversation started (flush before sending message)
5. Events added to agent's archival memory

### Tool/Action System

Letta agents can call VOTC actions via a unified tool interface:
- Tool name: `execute_votc_action`
- Parameters: `action_name` (string), `params` (object)
- Approval levels configured per-action in `actionApprovalLevels`
  - `auto`: Execute immediately
  - `approval`: Require player confirmation
  - `blocked`: Prevent execution

Tool calls are detected by `LettaMessageHandler`, queued, and sent to UI for approval.

### Integration Points

**Conversation Class:**
- Initializes Letta components if `lettaEnabled` in constructor
- Routes to `generateLettaMessage()` or `generateNewAIMessage()` based on agent status

**Main Process:**
- TODO: Add clipboard event handlers for `VOTC:AGENT_CREATE`, `VOTC:EVENT`, `VOTC:SAVE_LOAD`, `VOTC:SAVE_CLOSE`
- TODO: Initialize LettaAgentManager for save on `VOTC:SAVE_LOAD`
- TODO: Backup agents on `VOTC:SAVE_CLOSE`

### Running Letta Server

Requires local Letta server running:

```bash
docker run -v ~/.letta/.persist/pgdata:/var/lib/postgresql/data \
  -p 8283:8283 \
  -e OPENAI_API_KEY="your_key" \
  letta/letta:latest
```

Or install Letta Python package and run server locally.

### Known Limitations / TODOs

- Agent export/import methods need SDK method confirmation (currently commented out)
- Tool registration system not yet implemented (LettaToolManager pending)
- CK3 mod changes required for new clipboard events
- UI components for Letta configuration not yet implemented
- Action approval workflow for Letta tool calls needs integration with existing action system

## Security Notes

- API keys sanitized in logs via regex: `/(key\s*:\s*['"])([^"']+)(['"])/gi` → replaces value with `********`
- `Config.toSafeConfig()` redacts keys and URLs before logging
- Never commit `config.json` or files with API keys
