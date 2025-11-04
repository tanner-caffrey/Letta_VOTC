import { LettaClient } from '@letta-ai/letta-client';
import { Config } from '../../shared/Config.js';
import { Action } from '../ts/conversation_interfaces.js';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

const userDataPath = path.join(app.getPath('userData'), 'votc_data');

/**
 * Manages VOTC action tools for Letta agents
 *
 * NOTE: The actual tool must be registered on the Letta server using Python.
 * This manager handles tool metadata and validation from the TypeScript side.
 */
export class LettaToolManager {
    private client: LettaClient;
    private config: Config;
    private actions: Action[];
    private toolName: string = 'execute_votc_action';

    constructor(client: LettaClient, config: Config) {
        this.client = client;
        this.config = config;
        this.actions = [];
        console.log('LettaToolManager initialized');
    }

    /**
     * Load available VOTC actions to build tool description
     */
    async loadActions(): Promise<void> {
        console.log('Loading VOTC actions for tool description');
        this.actions = [];

        const actionsPath = path.join(userDataPath, 'scripts', 'actions');

        if (!fs.existsSync(actionsPath)) {
            console.warn(`Actions path does not exist: ${actionsPath}`);
            return;
        }

        const standardPath = path.join(actionsPath, 'standard');
        const customPath = path.join(actionsPath, 'custom');

        // Load standard actions
        if (fs.existsSync(standardPath)) {
            const standardFiles = fs.readdirSync(standardPath).filter(file => path.extname(file) === '.js');
            for (const file of standardFiles) {
                const actionName = path.basename(file, '.js');
                if (this.config.disabledActions.includes(actionName)) {
                    console.log(`Skipping disabled action: ${actionName}`);
                    continue;
                }

                try {
                    const filePath = path.join(standardPath, file);
                    delete require.cache[require.resolve(filePath)];
                    const action = require(filePath);
                    this.actions.push(action);
                    console.log(`Loaded standard action: ${actionName}`);
                } catch (error) {
                    console.error(`Error loading action ${file}:`, error);
                }
            }
        }

        // Load custom actions
        if (fs.existsSync(customPath)) {
            const customFiles = fs.readdirSync(customPath).filter(file => path.extname(file) === '.js');
            for (const file of customFiles) {
                const actionName = path.basename(file, '.js');
                if (this.config.disabledActions.includes(actionName)) {
                    console.log(`Skipping disabled action: ${actionName}`);
                    continue;
                }

                try {
                    const filePath = path.join(customPath, file);
                    delete require.cache[require.resolve(filePath)];
                    const action = require(filePath);
                    this.actions.push(action);
                    console.log(`Loaded custom action: ${actionName}`);
                } catch (error) {
                    console.error(`Error loading action ${file}:`, error);
                }
            }
        }

        console.log(`Loaded ${this.actions.length} total actions for tool description`);
    }

    /**
     * Generate tool description for Letta
     * This is used to inform agents about available actions
     */
    generateToolDescription(): string {
        const actionDescriptions = this.actions.map(action => {
            const argDescriptions = action.args.map(arg =>
                `  - ${arg.name} (${arg.type}): ${arg.desc}`
            ).join('\n');

            return `${action.signature}:
${action.description}
Arguments:
${argDescriptions}
Approval level: ${this.config.actionApprovalLevels[action.signature] || 'approval'}`;
        }).join('\n\n');

        return `Execute VOTC game actions. Available actions:\n\n${actionDescriptions}`;
    }

    /**
     * Validate that a tool call is for a valid action
     */
    validateToolCall(actionName: string, params: Record<string, any>): {
        valid: boolean;
        error?: string;
        action?: Action;
    } {
        const action = this.actions.find(a => a.signature === actionName);

        if (!action) {
            return {
                valid: false,
                error: `Action '${actionName}' not found`
            };
        }

        // Check if action is disabled
        if (this.config.disabledActions.includes(actionName)) {
            return {
                valid: false,
                error: `Action '${actionName}' is disabled`
            };
        }

        // Validate required arguments
        for (const arg of action.args) {
            if (!(arg.name in params)) {
                return {
                    valid: false,
                    error: `Missing required argument: ${arg.name}`
                };
            }
        }

        return {
            valid: true,
            action: action
        };
    }

    /**
     * Get approval level for an action
     */
    getApprovalLevel(actionName: string): 'auto' | 'approval' | 'blocked' {
        return this.config.actionApprovalLevels[actionName] || 'approval';
    }

    /**
     * Check if a tool exists on the Letta server
     */
    async toolExists(): Promise<boolean> {
        try {
            const tools = await this.client.tools.list();
            // @ts-ignore - SDK types may not be complete
            return tools.some((tool: any) => tool.name === this.toolName);
        } catch (error) {
            console.error('Error checking if tool exists:', error);
            return false;
        }
    }

    /**
     * List all tools on the Letta server
     */
    async listTools(): Promise<any[]> {
        try {
            const tools = await this.client.tools.list();
            console.log('Available tools on Letta server:', tools);
            return tools;
        } catch (error) {
            console.error('Error listing tools:', error);
            return [];
        }
    }

    /**
     * Generate Python script for registering the tool
     * This creates a template that can be run separately
     */
    generatePythonToolScript(): string {
        const toolDescription = this.generateToolDescription();

        return `"""
VOTC Action Tool for Letta

This script registers the execute_votc_action tool with your Letta server.
It should be run once to make the tool available to agents.

Usage:
    python register_votc_tool.py
"""

from letta import create_client
from letta.schemas.tool import Tool
from typing import Optional

def execute_votc_action(action_name: str, params: Optional[dict] = None) -> str:
    """
    Execute a Voices of the Court game action.

    ${toolDescription.split('\n').map(line => `    ${line}`).join('\n')}

    Args:
        action_name: The name of the action to execute
        params: Dictionary of parameters for the action

    Returns:
        Result message indicating success or failure

    Note:
        This is a placeholder function. The actual execution happens
        in the VOTC application when the agent calls this tool.
    """
    # This function body is just a placeholder
    # The actual tool execution is handled by VOTC's LettaMessageHandler
    return f"Tool call queued: {action_name} with params {params}"

def register_tool():
    """Register the VOTC action tool with Letta server"""
    client = create_client()

    # Create tool from function
    tool = client.tools.create_from_function(
        func=execute_votc_action,
        name="execute_votc_action",
        description="Execute Voices of the Court game actions"
    )

    print(f"Registered tool: {tool.name}")
    print(f"Tool ID: {tool.id}")

    return tool

if __name__ == "__main__":
    register_tool()
`;
    }

    /**
     * Save Python tool script to file
     */
    async savePythonToolScript(): Promise<string> {
        const toolsDir = path.join(userDataPath, 'letta_tools');

        if (!fs.existsSync(toolsDir)) {
            fs.mkdirSync(toolsDir, { recursive: true });
            console.log(`Created letta_tools directory: ${toolsDir}`);
        }

        const scriptPath = path.join(toolsDir, 'register_votc_tool.py');
        const scriptContent = this.generatePythonToolScript();

        fs.writeFileSync(scriptPath, scriptContent);
        console.log(`Saved Python tool registration script to: ${scriptPath}`);

        // Also create a README
        const readmePath = path.join(toolsDir, 'README.md');
        const readmeContent = `# Letta Tools for VOTC

## Registering the VOTC Action Tool

To enable Letta agents to use VOTC actions, you need to register the tool with your Letta server:

\`\`\`bash
# Make sure your Letta server is running
python register_votc_tool.py
\`\`\`

This only needs to be done once per Letta server instance.

## Verifying Tool Registration

You can verify the tool is registered by:

\`\`\`python
from letta import create_client

client = create_client()
tools = client.tools.list()

for tool in tools:
    if tool.name == "execute_votc_action":
        print(f"VOTC action tool is registered! ID: {tool.id}")
\`\`\`

## Tool Updates

If VOTC actions are added or modified, you can update the tool by:
1. Deleting the old tool (if needed)
2. Re-running the registration script

The tool description will automatically include all enabled actions from VOTC.
`;

        fs.writeFileSync(readmePath, readmeContent);
        console.log(`Saved README to: ${readmePath}`);

        return scriptPath;
    }

    /**
     * Update configuration
     */
    updateConfig(config: Config): void {
        this.config = config;
        console.log('LettaToolManager configuration updated');
    }

    /**
     * Get available actions
     */
    getActions(): Action[] {
        return this.actions;
    }

    /**
     * Get action by name
     */
    getAction(actionName: string): Action | undefined {
        return this.actions.find(a => a.signature === actionName);
    }
}
