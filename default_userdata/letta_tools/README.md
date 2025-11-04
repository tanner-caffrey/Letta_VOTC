# Letta Tools for VOTC

This directory contains tools for integrating Letta (formerly MemGPT) with Voices of the Court.

## Prerequisites

1. **Letta Server Running**: You need a Letta server running locally or accessible via network
2. **Python Environment**: Python 3.8+ with letta package installed

### Installing Letta

```bash
pip install letta
```

### Running Letta Server

**Using Docker (recommended):**
```bash
docker run -v ~/.letta/.persist/pgdata:/var/lib/postgresql/data \
  -p 8283:8283 \
  -e OPENAI_API_KEY="your_openai_key" \
  letta/letta:latest
```

**Using Python:**
```bash
letta server
```

The server will be available at `http://localhost:8283`

## Registering the VOTC Action Tool

The `execute_votc_action` tool must be registered with your Letta server before agents can use it.

### One-Time Registration

```bash
cd default_userdata/letta_tools
python register_votc_tool.py
```

You should see output like:
```
==============================================================
  VOTC Action Tool Registration for Letta
==============================================================
Connecting to Letta server...
Registering execute_votc_action tool...

✓ Successfully registered tool!
  Tool name: execute_votc_action
  Tool ID: tool-abc123...

You can now attach this tool to agents using:
  agent = client.agents.create(tools=['execute_votc_action'], ...)

Verifying tool registration...
✓ Tool verified! ID: tool-abc123...

==============================================================
  Registration complete!
==============================================================
```

This only needs to be done **once per Letta server instance**. The tool will persist across restarts.

## Verifying Tool Registration

To check if the tool is registered:

```python
from letta import create_client

client = create_client()
tools = client.tools.list()

for tool in tools:
    if tool.name == "execute_votc_action":
        print(f"VOTC action tool is registered! ID: {tool.id}")
```

## How It Works

1. **Tool Registration**: The Python script registers `execute_votc_action` as a Letta tool
2. **Agent Attachment**: When VOTC creates a Letta agent, it attaches this tool
3. **Agent Calls Tool**: During conversations, agents can call `execute_votc_action`
4. **VOTC Handles Execution**: LettaMessageHandler detects tool calls and queues them as actions
5. **Player Approval**: Player approves/rejects actions in VOTC UI
6. **Action Execution**: Approved actions are executed via RunFileManager → CK3 mod

## Available Actions

The tool provides access to all VOTC actions, including:

### Emotional Expressions (auto-approve by default)
- `emotionHappy` - Express happiness
- `emotionSad` - Express sadness
- `emotionWorry` - Express worry
- `emotionPain` - Express pain

### Opinion Changes (auto-approve by default)
- `improveOpinionOfPlayer` - Increase opinion of player
- `lowerOpinionOfPlayer` - Decrease opinion of player

### Relationships (require approval by default)
- `becomeLovers` - Become lovers with player
- `becomeSoulmates` - Become soulmates with player
- `becomeCloseFriends` - Become close friends with player
- `becomeRivals` - Become rivals with player

### Diplomatic Actions (require approval)
- `allianceDiplomatic` - Form alliance with player
- `newAllianceDiplomatic` - Form new alliance
- `aiAgreedToTruce` - Agree to truce

### Employment Actions (require approval)
- `assignAiToCouncilPosition` - Join player's council
- `assignAiToCourtPosition` - Join player's court
- `fireAiFromCouncil` - Leave council position
- `aiEmployedByPlayer` - General employment by player

### Hostile Actions (require approval)
- `playerKillsAI` - Player kills AI character
- `playerImprisonsAI` - Player imprisons AI character
- `playerVassalizingAI` - Player vassalizes AI character

### Economic Actions (require approval)
- `aiPaysGoldToPlayer` - AI pays gold to player
- `playerPaysGoldToAi` - Player pays gold to AI

### Personal Actions (require approval)
- `intercourse` - Intimate relations
- `intercourseA` - Alternative intimate relations
- `undressAi` - Undress AI character
- `aiGetsWounded` - AI character gets wounded
- `aiInjured` - AI character gets injured
- `aiConvertsToPlayerReligion` - Convert to player's religion

## Approval Levels

Actions have three approval levels configured in VOTC's `config.json`:

- **`auto`**: Executed immediately without player input
- **`approval`**: Player must approve before execution
- **`blocked`**: Cannot be executed (agent will be notified)

## Troubleshooting

### Tool not found
```bash
# Re-run registration script
python register_votc_tool.py
```

### Connection refused
- Make sure Letta server is running on port 8283
- Check `VOTC config.json` → `lettaServerUrl` setting

### Tool calls not working
- Verify tool is attached to agent
- Check VOTC logs: `~/.config/Electron/votc_data/logs/debug.log`
- Ensure `lettaEnabled: true` in config

## Updating the Tool

If VOTC actions are added/modified:

1. The tool description is generated dynamically by VOTC
2. You may want to update the docstring in `register_votc_tool.py` manually
3. Optionally delete old tool and re-register:

```python
from letta import create_client

client = create_client()

# Find and delete old tool
tools = client.tools.list()
for tool in tools:
    if tool.name == "execute_votc_action":
        client.tools.delete(tool.id)
        print(f"Deleted old tool: {tool.id}")

# Re-run registration
# python register_votc_tool.py
```

## Example Agent Creation

```python
from letta import create_client

client = create_client()

# Create agent with VOTC action tool
agent = client.agents.create(
    name="ck3_character_agent",
    model="openai/gpt-4o-mini",
    embedding="openai/text-embedding-3-small",
    tools=["execute_votc_action"],  # Attach the VOTC tool
    memory_blocks=[
        {
            "label": "persona",
            "value": "I am a cunning noble in medieval Europe..."
        }
    ]
)

print(f"Created agent: {agent.id}")
```

The agent can now call `execute_votc_action` during conversations!
