import { LettaClient } from '@letta-ai/letta-client';
import { Config } from '../../shared/Config.js';
import { GameEvent, TransformedEvent } from './types.js';
import { MemoryTransformer } from './MemoryTransformer.js';

export class EventBatcher {
    private config: Config;
    private client: LettaClient;
    private memoryTransformer: MemoryTransformer;
    private eventQueues: Map<string, GameEvent[]> = new Map(); // agentId -> events
    private lastFlushTime: Map<string, Date> = new Map(); // agentId -> last flush time
    private flushTimers: Map<string, NodeJS.Timeout> = new Map(); // agentId -> timer

    constructor(config: Config, client: LettaClient, memoryTransformer: MemoryTransformer) {
        this.config = config;
        this.client = client;
        this.memoryTransformer = memoryTransformer;
        console.log('EventBatcher initialized');
    }

    /**
     * Queue an event for an agent
     */
    queueEvent(agentId: string, event: GameEvent): void {
        console.log(`Queuing event for agent ${agentId}: ${event.eventType}`);

        // Get or create queue for this agent
        if (!this.eventQueues.has(agentId)) {
            this.eventQueues.set(agentId, []);
            this.lastFlushTime.set(agentId, new Date());
        }

        const queue = this.eventQueues.get(agentId)!;
        queue.push(event);

        console.log(`Agent ${agentId} now has ${queue.length} queued events`);

        // Check if we should flush based on count
        if (queue.length >= this.config.lettaEventBatchSize) {
            console.log(`Event batch size reached for agent ${agentId}, flushing`);
            this.flushEvents(agentId);
            return;
        }

        // Check if we should flush based on max queue size
        if (queue.length >= this.config.lettaMaxEventQueueSize) {
            console.log(`Max event queue size reached for agent ${agentId}, flushing`);
            this.flushEvents(agentId);
            return;
        }

        // Set/reset timeout for time-based flush
        this.resetFlushTimer(agentId);
    }

    /**
     * Flush events for a specific agent
     */
    async flushEvents(agentId: string): Promise<void> {
        const queue = this.eventQueues.get(agentId);

        if (!queue || queue.length === 0) {
            console.log(`No events to flush for agent ${agentId}`);
            return;
        }

        console.log(`Flushing ${queue.length} events for agent ${agentId}`);

        try {
            // Transform events if first-person transform is enabled
            const transformedEvents: TransformedEvent[] = [];

            if (this.config.lettaFirstPersonTransform) {
                for (const event of queue) {
                    const transformed = await this.memoryTransformer.transformEvent(event);
                    transformedEvents.push(transformed);
                }
            }

            // Combine events into archival memory entries
            const memoryEntries: string[] = [];

            if (this.config.lettaFirstPersonTransform) {
                // Use first-person narratives
                transformedEvents.forEach(te => {
                    let entry = `[${te.originalEvent.timestamp.toISOString()}] ${te.firstPersonNarrative}`;
                    if (te.emotionalContext) {
                        entry += ` (${te.emotionalContext})`;
                    }
                    memoryEntries.push(entry);
                });
            } else {
                // Use raw event descriptions
                queue.forEach(event => {
                    memoryEntries.push(`[${event.timestamp.toISOString()}] ${event.eventType}: ${event.description}`);
                });
            }

            // Add to agent's archival memory
            for (const entry of memoryEntries) {
                await this.client.agents.passages.create(agentId, {
                    text: entry
                });
            }

            console.log(`Added ${memoryEntries.length} memory entries to agent ${agentId}`);

            // Optionally send a user message to make the agent aware of events
            if (queue.length > 0) {
                const eventSummary = this.createEventSummary(queue, transformedEvents);
                await this.client.agents.messages.create(agentId, {
                    messages: [{
                        role: 'user',
                        content: eventSummary
                    }]
                });
                console.log(`Sent event summary message to agent ${agentId}`);
            }

            // Clear queue and update flush time
            this.eventQueues.set(agentId, []);
            this.lastFlushTime.set(agentId, new Date());

            // Clear timer if exists
            const timer = this.flushTimers.get(agentId);
            if (timer) {
                clearTimeout(timer);
                this.flushTimers.delete(agentId);
            }

            console.log(`Successfully flushed events for agent ${agentId}`);
        } catch (error) {
            console.error(`Error flushing events for agent ${agentId}:`, error);
            // Keep events in queue to retry later
        }
    }

    /**
     * Flush all pending events for all agents
     */
    async flushAllEvents(): Promise<void> {
        console.log('Flushing all pending events');
        const agentIds = Array.from(this.eventQueues.keys());

        for (const agentId of agentIds) {
            await this.flushEvents(agentId);
        }

        console.log('Completed flushing all events');
    }

    /**
     * Get pending event count for an agent
     */
    getPendingEventCount(agentId: string): number {
        const queue = this.eventQueues.get(agentId);
        return queue ? queue.length : 0;
    }

    /**
     * Clear all events for an agent without flushing
     */
    clearEvents(agentId: string): void {
        console.log(`Clearing events for agent ${agentId}`);
        this.eventQueues.set(agentId, []);
        const timer = this.flushTimers.get(agentId);
        if (timer) {
            clearTimeout(timer);
            this.flushTimers.delete(agentId);
        }
    }

    /**
     * Update configuration
     */
    updateConfig(config: Config): void {
        this.config = config;
        console.log('EventBatcher configuration updated');
    }

    /**
     * Reset flush timer for an agent
     */
    private resetFlushTimer(agentId: string): void {
        // Clear existing timer if any
        const existingTimer = this.flushTimers.get(agentId);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // Set new timer
        const timer = setTimeout(async () => {
            console.log(`Flush timer expired for agent ${agentId}`);
            await this.flushEvents(agentId);
        }, this.config.lettaEventBatchTimeoutMs);

        this.flushTimers.set(agentId, timer);
    }

    /**
     * Create a summary message about batched events
     */
    private createEventSummary(events: GameEvent[], transformedEvents: TransformedEvent[]): string {
        if (events.length === 0) {
            return '';
        }

        if (this.config.lettaFirstPersonTransform && transformedEvents.length > 0) {
            // Use first-person narratives
            const narratives = transformedEvents.map(te => te.firstPersonNarrative).join(' ');
            return `[System: Recent events have occurred] ${narratives}`;
        } else {
            // Use event summaries
            const eventSummaries = events.map(e => `${e.eventType}: ${e.description}`).join('; ');
            return `[System: Recent events] ${eventSummaries}`;
        }
    }

    /**
     * Cleanup method to clear all timers
     */
    cleanup(): void {
        console.log('Cleaning up EventBatcher');
        for (const timer of this.flushTimers.values()) {
            clearTimeout(timer);
        }
        this.flushTimers.clear();
    }
}
