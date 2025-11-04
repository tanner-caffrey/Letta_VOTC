import { LettaClient } from '@letta-ai/letta-client';
import { Config } from '../../shared/Config.js';
import { Message, MessageChunk, ActionResponse } from '../ts/conversation_interfaces.js';
import { ChatWindow } from '../windows/ChatWindow.js';
import { ActionToolCall } from './types.js';

/**
 * Handles message sending and streaming with Letta agents
 */
export class LettaMessageHandler {
    private client: LettaClient;
    private config: Config;
    private chatWindow: ChatWindow;
    private pendingToolCalls: Map<string, ActionToolCall> = new Map();

    constructor(client: LettaClient, config: Config, chatWindow: ChatWindow) {
        this.client = client;
        this.config = config;
        this.chatWindow = chatWindow;
        console.log('LettaMessageHandler initialized');
    }

    /**
     * Send a message to a Letta agent and handle the response
     */
    async sendMessage(
        agentId: string,
        characterId: number,
        characterName: string,
        userMessage: string
    ): Promise<ActionResponse[]> {
        console.log(`Sending message to Letta agent ${agentId} for character ${characterName}`);

        const actionResponses: ActionResponse[] = [];

        try {
            if (this.config.stream) {
                // Handle streaming response
                console.log('Using streaming mode');
                return await this.handleStreamingResponse(
                    agentId,
                    characterId,
                    characterName,
                    userMessage
                );
            } else {
                // Handle non-streaming response
                console.log('Using non-streaming mode');
                return await this.handleNonStreamingResponse(
                    agentId,
                    characterId,
                    characterName,
                    userMessage
                );
            }
        } catch (error) {
            console.error('Error sending message to Letta agent:', error);
            this.chatWindow.window.webContents.send('error-message', `Error communicating with Letta agent: ${error}`);
            return [];
        }
    }

    /**
     * Handle streaming response from Letta agent
     */
    private async handleStreamingResponse(
        agentId: string,
        characterId: number,
        characterName: string,
        userMessage: string
    ): Promise<ActionResponse[]> {
        const actionResponses: ActionResponse[] = [];
        let accumulatedContent = '';

        // Send stream start signal
        this.chatWindow.window.webContents.send('stream-start');

        try {
            const stream = await this.client.agents.messages.createStream(agentId, {
                messages: [{
                    role: 'user',
                    content: userMessage
                }],
                streamTokens: true
            });

            const messageAccumulators = new Map<string, { type: string; content: string }>();

            for await (const chunk of stream) {
                // Handle different message types
                const anyChunk = chunk as any; // Type assertion for SDK compatibility
                if (anyChunk.id && anyChunk.messageType) {
                    if (!messageAccumulators.has(anyChunk.id)) {
                        messageAccumulators.set(anyChunk.id, {
                            type: anyChunk.messageType,
                            content: ''
                        });
                    }

                    const acc = messageAccumulators.get(anyChunk.id)!;

                    // Accumulate content
                    if (anyChunk.content) {
                        acc.content += anyChunk.content;
                    }

                    // Process based on message type
                    switch (anyChunk.messageType) {
                        case 'assistant_message':
                            // Stream to chat window
                            const streamMessage: Message = {
                                role: 'assistant',
                                name: characterName,
                                content: acc.content
                            };
                            this.chatWindow.window.webContents.send('stream-message', streamMessage);
                            accumulatedContent = acc.content;
                            break;

                        case 'reasoning_message':
                            // Show reasoning if enabled
                            if (this.config.lettaShowReasoning && anyChunk.reasoning) {
                                console.log(`[Agent Reasoning] ${anyChunk.reasoning}`);
                            }
                            break;

                        case 'tool_call_message':
                            // Handle tool call
                            if (anyChunk.toolCall) {
                                console.log(`Tool call detected: ${anyChunk.toolCall.name}`);
                                const toolCall = this.parseToolCall(anyChunk, agentId, characterId);
                                if (toolCall) {
                                    this.pendingToolCalls.set(toolCall.toolCallId, toolCall);
                                }
                            }
                            break;

                        case 'tool_return_message':
                            // Tool execution completed
                            if (anyChunk.toolReturn) {
                                console.log(`Tool return: ${JSON.stringify(anyChunk.toolReturn)}`);
                            }
                            break;
                    }
                }
            }

            console.log('Streaming complete');

            // Convert pending tool calls to action responses
            for (const toolCall of this.pendingToolCalls.values()) {
                if (toolCall.agentId === agentId && toolCall.status === 'pending') {
                    const actionResponse = this.toolCallToActionResponse(toolCall);
                    if (actionResponse) {
                        actionResponses.push(actionResponse);
                    }
                }
            }

        } catch (error) {
            console.error('Error during streaming:', error);
            throw error;
        }

        return actionResponses;
    }

    /**
     * Handle non-streaming response from Letta agent
     */
    private async handleNonStreamingResponse(
        agentId: string,
        characterId: number,
        characterName: string,
        userMessage: string
    ): Promise<ActionResponse[]> {
        const actionResponses: ActionResponse[] = [];

        const response = await this.client.agents.messages.create(agentId, {
            messages: [{
                role: 'user',
                content: userMessage
            }]
        });

        // Process all messages in response
        for (const message of response.messages) {
            const anyMessage = message as any; // Type assertion for SDK compatibility
            switch (anyMessage.messageType) {
                case 'assistant_message':
                    // Send assistant message to chat window
                    const content = typeof anyMessage.content === 'string'
                        ? anyMessage.content
                        : JSON.stringify(anyMessage.content);
                    const assistantMessage: Message = {
                        role: 'assistant',
                        name: characterName,
                        content: content || ''
                    };
                    this.chatWindow.window.webContents.send(
                        'message-receive',
                        assistantMessage,
                        this.config.actionsEnableAll
                    );
                    break;

                case 'reasoning_message':
                    // Log reasoning if enabled
                    if (this.config.lettaShowReasoning && anyMessage.reasoning) {
                        console.log(`[Agent Reasoning] ${anyMessage.reasoning}`);
                    }
                    break;

                case 'tool_call_message':
                    // Handle tool call
                    if (anyMessage.toolCall) {
                        console.log(`Tool call detected: ${anyMessage.toolCall.name}`);
                        const toolCall = this.parseToolCall(anyMessage, agentId, characterId);
                        if (toolCall) {
                            this.pendingToolCalls.set(toolCall.toolCallId, toolCall);
                        }
                    }
                    break;

                case 'tool_return_message':
                    // Tool execution completed
                    if (anyMessage.toolReturn) {
                        console.log(`Tool return: ${JSON.stringify(anyMessage.toolReturn)}`);
                    }
                    break;
            }
        }

        // Convert pending tool calls to action responses
        for (const toolCall of this.pendingToolCalls.values()) {
            if (toolCall.agentId === agentId && toolCall.status === 'pending') {
                const actionResponse = this.toolCallToActionResponse(toolCall);
                if (actionResponse) {
                    actionResponses.push(actionResponse);
                }
            }
        }

        return actionResponses;
    }

    /**
     * Parse a tool call from Letta message
     */
    private parseToolCall(
        message: any,
        agentId: string,
        characterId: number
    ): ActionToolCall | null {
        const toolCall = message.toolCall;
        if (!toolCall) return null;

        // Only process VOTC action tool
        if (toolCall.name !== 'execute_votc_action') {
            console.log(`Ignoring non-VOTC tool: ${toolCall.name}`);
            return null;
        }

        try {
            const args = JSON.parse(toolCall.arguments);
            const actionName = args.action_name;
            const params = args.params || {};

            // Determine approval level
            const approvalLevel = this.config.actionApprovalLevels[actionName] || 'approval';

            const actionToolCall: ActionToolCall = {
                toolCallId: toolCall.id || message.id,
                agentId: agentId,
                characterId: characterId,
                actionName: actionName,
                params: params,
                approvalLevel: approvalLevel,
                status: approvalLevel === 'blocked' ? 'rejected' : 'pending'
            };

            console.log(`Parsed action tool call: ${actionName} (${approvalLevel})`);

            return actionToolCall;
        } catch (error) {
            console.error('Error parsing tool call:', error);
            return null;
        }
    }

    /**
     * Convert tool call to action response for UI
     */
    private toolCallToActionResponse(toolCall: ActionToolCall): ActionResponse | null {
        if (toolCall.status === 'rejected') {
            console.log(`Skipping rejected action: ${toolCall.actionName}`);
            return null;
        }

        // Format parameters for display
        const paramsStr = Object.entries(toolCall.params)
            .map(([key, value]) => `${key}: ${value}`)
            .join(', ');

        const actionResponse: ActionResponse = {
            actionName: toolCall.actionName,
            chatMessage: `Agent wants to: ${toolCall.actionName}(${paramsStr})`,
            chatMessageClass: toolCall.approvalLevel === 'auto' ? 'auto-action' : 'approval-action'
        };

        return actionResponse;
    }

    /**
     * Get pending tool call by ID
     */
    getPendingToolCall(toolCallId: string): ActionToolCall | undefined {
        return this.pendingToolCalls.get(toolCallId);
    }

    /**
     * Mark tool call as approved
     */
    approveToolCall(toolCallId: string): void {
        const toolCall = this.pendingToolCalls.get(toolCallId);
        if (toolCall) {
            toolCall.status = 'approved';
            console.log(`Tool call ${toolCallId} approved`);
        }
    }

    /**
     * Mark tool call as rejected
     */
    rejectToolCall(toolCallId: string): void {
        const toolCall = this.pendingToolCalls.get(toolCallId);
        if (toolCall) {
            toolCall.status = 'rejected';
            console.log(`Tool call ${toolCallId} rejected`);
        }
    }

    /**
     * Mark tool call as executed
     */
    markToolCallExecuted(toolCallId: string, result?: string, error?: string): void {
        const toolCall = this.pendingToolCalls.get(toolCallId);
        if (toolCall) {
            toolCall.status = error ? 'error' : 'executed';
            toolCall.result = result;
            toolCall.error = error;
            console.log(`Tool call ${toolCallId} marked as ${toolCall.status}`);
        }
    }

    /**
     * Clear pending tool calls for an agent
     */
    clearPendingToolCalls(agentId: string): void {
        for (const [id, toolCall] of this.pendingToolCalls) {
            if (toolCall.agentId === agentId) {
                this.pendingToolCalls.delete(id);
            }
        }
        console.log(`Cleared pending tool calls for agent ${agentId}`);
    }

    /**
     * Update configuration
     */
    updateConfig(config: Config): void {
        this.config = config;
        console.log('LettaMessageHandler configuration updated');
    }
}
