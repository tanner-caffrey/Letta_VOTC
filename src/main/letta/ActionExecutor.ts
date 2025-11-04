import { Action, ActionResponse } from '../ts/conversation_interfaces.js';
import { GameData } from '../../shared/gameData/GameData.js';
import { RunFileManager } from '../RunFileManager.js';
import { Config } from '../../shared/Config.js';
import { ActionToolCall } from './types.js';

/**
 * Unified action executor for both traditional VOTC actions and Letta tool calls
 */
export class ActionExecutor {
    private actions: Action[];
    private config: Config;
    private runFileManager: RunFileManager;

    constructor(actions: Action[], config: Config, runFileManager: RunFileManager) {
        this.actions = actions;
        this.config = config;
        this.runFileManager = runFileManager;
        console.log('ActionExecutor initialized');
    }

    /**
     * Execute a Letta tool call as an action
     */
    async executeLettaToolCall(
        toolCall: ActionToolCall,
        gameData: GameData
    ): Promise<{ success: boolean; result?: string; error?: string }> {
        console.log(`Executing Letta tool call: ${toolCall.actionName}`);

        // Find the action
        const action = this.actions.find(a => a.signature === toolCall.actionName);

        if (!action) {
            const error = `Action not found: ${toolCall.actionName}`;
            console.error(error);
            return { success: false, error };
        }

        // Check if action is disabled
        if (this.config.disabledActions.includes(toolCall.actionName)) {
            const error = `Action is disabled: ${toolCall.actionName}`;
            console.error(error);
            return { success: false, error };
        }

        // Check approval level
        const approvalLevel = this.config.actionApprovalLevels[toolCall.actionName] || 'approval';

        if (approvalLevel === 'blocked') {
            const error = `Action is blocked by configuration: ${toolCall.actionName}`;
            console.error(error);
            return { success: false, error };
        }

        // Verify action is valid in current context
        try {
            if (!action.check(gameData)) {
                const error = `Action check failed for: ${toolCall.actionName}`;
                console.error(error);
                return { success: false, error };
            }
        } catch (checkError) {
            const error = `Action check error for ${toolCall.actionName}: ${checkError}`;
            console.error(error);
            return { success: false, error };
        }

        // Convert params to args array (if action expects args)
        const args: string[] = [];
        if (action.args && action.args.length > 0) {
            for (const arg of action.args) {
                const value = toolCall.params[arg.name];
                if (value !== undefined) {
                    args.push(String(value));
                } else {
                    const error = `Missing required argument: ${arg.name}`;
                    console.error(error);
                    return { success: false, error };
                }
            }
        }

        // Execute the action
        try {
            console.log(`Executing action ${toolCall.actionName} with args:`, args);

            // Create a callback for run file writing
            const runFileCallback = (command: string) => {
                this.runFileManager.append(command + '\n');
            };

            // Execute the action
            action.run(gameData, runFileCallback, args);

            const result = `Action ${toolCall.actionName} executed successfully`;
            console.log(result);
            return { success: true, result };
        } catch (execError) {
            const error = `Action execution error for ${toolCall.actionName}: ${execError}`;
            console.error(error);
            return { success: false, error };
        }
    }

    /**
     * Execute a traditional VOTC action (from checkActions)
     */
    async executeTraditionalAction(
        actionResponse: ActionResponse,
        gameData: GameData
    ): Promise<{ success: boolean; result?: string; error?: string }> {
        console.log(`Executing traditional action: ${actionResponse.actionName}`);

        // Find the action
        const action = this.actions.find(a => a.signature === actionResponse.actionName);

        if (!action) {
            const error = `Action not found: ${actionResponse.actionName}`;
            console.error(error);
            return { success: false, error };
        }

        // Traditional actions have already been checked and approved by UI
        // So we just execute

        try {
            // Parse args from the action response chat message if needed
            // This is a simplified version - traditional flow may handle this differently
            const runFileCallback = (command: string) => {
                this.runFileManager.append(command + '\n');
            };

            action.run(gameData, runFileCallback, []);

            const result = `Action ${actionResponse.actionName} executed successfully`;
            console.log(result);
            return { success: true, result };
        } catch (execError) {
            const error = `Action execution error for ${actionResponse.actionName}: ${execError}`;
            console.error(error);
            return { success: false, error };
        }
    }

    /**
     * Check if action requires approval
     */
    requiresApproval(actionName: string): boolean {
        const approvalLevel = this.config.actionApprovalLevels[actionName] || 'approval';
        return approvalLevel === 'approval';
    }

    /**
     * Check if action is auto-approved
     */
    isAutoApproved(actionName: string): boolean {
        const approvalLevel = this.config.actionApprovalLevels[actionName] || 'approval';
        return approvalLevel === 'auto';
    }

    /**
     * Check if action is blocked
     */
    isBlocked(actionName: string): boolean {
        const approvalLevel = this.config.actionApprovalLevels[actionName] || 'approval';
        return approvalLevel === 'blocked';
    }

    /**
     * Validate action parameters
     */
    validateParams(actionName: string, params: Record<string, any>): {
        valid: boolean;
        error?: string;
    } {
        const action = this.actions.find(a => a.signature === actionName);

        if (!action) {
            return { valid: false, error: `Action not found: ${actionName}` };
        }

        // Check required arguments
        for (const arg of action.args) {
            if (!(arg.name in params)) {
                return { valid: false, error: `Missing required parameter: ${arg.name}` };
            }
        }

        return { valid: true };
    }

    /**
     * Update configuration
     */
    updateConfig(config: Config): void {
        this.config = config;
        console.log('ActionExecutor configuration updated');
    }

    /**
     * Update actions list
     */
    updateActions(actions: Action[]): void {
        this.actions = actions;
        console.log(`ActionExecutor actions updated: ${actions.length} actions loaded`);
    }
}
