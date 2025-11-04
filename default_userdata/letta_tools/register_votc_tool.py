"""
VOTC Action Tool for Letta

This script registers the execute_votc_action tool with your Letta server.
It should be run once to make the tool available to agents.

Usage:
    python register_votc_tool.py

Requirements:
    pip install letta
"""

from letta import create_client
from typing import Optional
import sys


def execute_votc_action(action_name: str, params: Optional[dict] = None) -> str:
    """
    Execute a Voices of the Court game action.

    This tool allows Letta agents to trigger actions in the Crusader Kings 3 game
    through the Voices of the Court mod. Actions range from simple emotional
    expressions to complex diplomatic maneuvers.

    Available action categories:
    - Emotional expressions (emotionHappy, emotionSad, emotionWorry, emotionPain)
    - Opinion changes (improveOpinionOfPlayer, lowerOpinionOfPlayer)
    - Relationships (becomeLovers, becomeSoulmates, becomeCloseFriends, becomeRivals)
    - Diplomatic actions (allianceDiplomatic, aiAgreedToTruce)
    - Employment (assignAiToCouncilPosition, assignAiToCourtPosition, aiEmployedByPlayer)
    - Hostile actions (playerKillsAI, playerImprisonsAI, playerVassalizingAI)
    - Economic (aiPaysGoldToPlayer, playerPaysGoldToAi)
    - Personal (intercourse, undressAi, aiGetsWounded, aiConvertsToPlayerReligion)

    Args:
        action_name: The name of the action to execute (e.g., "becomeLovers")
        params: Dictionary of parameters for the action (action-specific)

    Returns:
        Result message indicating the action was queued for player approval/execution

    Note:
        Most actions require player approval before execution. The approval level
        is configured in VOTC's config.json under actionApprovalLevels.

        Actions are NOT executed immediately - they are queued and presented to
        the player for confirmation (unless set to "auto" approval level).

    Examples:
        execute_votc_action("emotionHappy", {})
        execute_votc_action("improveOpinionOfPlayer", {"amount": 10})
        execute_votc_action("becomeLovers", {})
    """
    # This function body is just a placeholder for Letta's tool registration
    # The actual execution is handled by VOTC's LettaMessageHandler
    if params is None:
        params = {}

    return f"Action '{action_name}' queued for execution with params: {params}"


def register_tool():
    """Register the VOTC action tool with Letta server"""
    try:
        print("Connecting to Letta server...")
        client = create_client()

        print("Registering execute_votc_action tool...")

        # Create tool from function
        tool = client.tools.create_from_function(
            func=execute_votc_action,
            name="execute_votc_action",
            description="Execute Voices of the Court game actions in Crusader Kings 3"
        )

        print(f"\n✓ Successfully registered tool!")
        print(f"  Tool name: {tool.name}")
        print(f"  Tool ID: {tool.id}")
        print(f"\nYou can now attach this tool to agents using:")
        print(f"  agent = client.agents.create(tools=['execute_votc_action'], ...)")

        return tool

    except Exception as e:
        print(f"\n✗ Error registering tool: {e}", file=sys.stderr)
        print(f"\nMake sure:")
        print(f"  1. Letta server is running (default: http://localhost:8283)")
        print(f"  2. You have the letta package installed: pip install letta")
        print(f"  3. Your Letta server is accessible")
        sys.exit(1)


def verify_tool():
    """Verify the tool is registered"""
    try:
        print("\nVerifying tool registration...")
        client = create_client()

        tools = client.tools.list()
        votc_tool = None

        for tool in tools:
            if tool.name == "execute_votc_action":
                votc_tool = tool
                break

        if votc_tool:
            print(f"✓ Tool verified! ID: {votc_tool.id}")
        else:
            print("✗ Tool not found in registry")

    except Exception as e:
        print(f"✗ Error verifying tool: {e}", file=sys.stderr)


if __name__ == "__main__":
    print("="*60)
    print("  VOTC Action Tool Registration for Letta")
    print("="*60)

    tool = register_tool()

    if tool:
        verify_tool()
        print("\n" + "="*60)
        print("  Registration complete!")
        print("="*60)
