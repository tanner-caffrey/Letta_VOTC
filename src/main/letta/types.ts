import { GameData } from '../../shared/gameData/GameData.js';

/**
 * Mapping between CK3 character ID and Letta agent ID
 */
export interface AgentMapping {
    characterId: number;
    agentId: string;
    characterName: string;
    createdAt: string;
    lastUpdated: string;
}

/**
 * Save-specific agent mappings
 */
export interface SaveAgentMappings {
    saveId: string;
    saveName?: string;
    agents: AgentMapping[];
}

/**
 * Wrapper for Letta agent data with VOTC context
 */
export interface LettaAgent {
    agentState: any; // Using any for Letta agent state type
    characterId: number;
    characterName: string;
    lastEventFlush: Date;
    pendingEvents: GameEvent[];
}

/**
 * Game event from CK3 to be sent to Letta agents
 */
export interface GameEvent {
    eventType: string;
    timestamp: Date;
    description: string;
    characterId: number;
    /**
     * Additional structured data about the event
     */
    metadata?: Record<string, any>;
}

/**
 * Action tool call from Letta agent
 */
export interface ActionToolCall {
    toolCallId: string;
    agentId: string;
    characterId: number;
    actionName: string;
    params: Record<string, any>;
    approvalLevel: 'auto' | 'approval' | 'blocked';
    status: 'pending' | 'approved' | 'rejected' | 'executed' | 'error';
    result?: string;
    error?: string;
}

/**
 * Configuration for Letta integration
 */
export interface LettaConfig {
    enabled: boolean;
    serverUrl: string;
    defaultModel: string;
    defaultEmbedding: string;
    eventBatchSize: number;
    eventBatchTimeoutMs: number;
    firstPersonTransform: boolean;
    actionApprovalLevels: Record<string, 'auto' | 'approval' | 'blocked'>;
    /**
     * Whether to show agent reasoning in chat window
     */
    showReasoning: boolean;
    /**
     * Maximum number of events to queue before forcing flush
     */
    maxEventQueueSize: number;
}

/**
 * Event transformer result with first-person narrative
 */
export interface TransformedEvent {
    originalEvent: GameEvent;
    firstPersonNarrative: string;
    emotionalContext?: string;
}

/**
 * Agent memory initialization data
 */
export interface AgentMemoryInit {
    persona: string;
    characterBio: string;
    relationships: string;
    currentContext: string;
    archivalMemories: string[];
}

/**
 * Type for save identification
 */
export interface SaveIdentifier {
    saveId: string;
    saveName?: string;
    gameDate?: string;
    playerCharacterId?: number;
}
