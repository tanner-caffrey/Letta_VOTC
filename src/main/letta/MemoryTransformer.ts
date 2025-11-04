import { ApiConnection } from '../../shared/apiConnection.js';
import { Config } from '../../shared/Config.js';
import { GameEvent, TransformedEvent } from './types.js';

/**
 * Transforms game events into first-person narrative for agent memory
 */
export class MemoryTransformer {
    private apiConnection: ApiConnection;
    private config: Config;
    private transformCache: Map<string, string> = new Map(); // Cache for common event patterns

    constructor(config: Config) {
        this.config = config;

        // Use text generation API for transformation
        this.apiConnection = new ApiConnection(
            config.textGenerationApiConnectionConfig.connection,
            config.textGenerationApiConnectionConfig.parameters
        );

        console.log('MemoryTransformer initialized');
    }

    /**
     * Transform a game event into first-person narrative
     */
    async transformEvent(event: GameEvent): Promise<TransformedEvent> {
        console.log(`Transforming event: ${event.eventType}`);

        // Check cache first
        const cacheKey = this.getCacheKey(event);
        const cached = this.transformCache.get(cacheKey);
        if (cached) {
            console.log('Using cached transformation');
            return {
                originalEvent: event,
                firstPersonNarrative: cached
            };
        }

        try {
            const firstPersonNarrative = await this.generateFirstPersonNarrative(event);
            const emotionalContext = await this.generateEmotionalContext(event);

            // Cache the result
            this.transformCache.set(cacheKey, firstPersonNarrative);

            // Limit cache size
            if (this.transformCache.size > 100) {
                const firstKey = this.transformCache.keys().next().value;
                if (firstKey !== undefined) {
                    this.transformCache.delete(firstKey);
                }
            }

            console.log('Event transformation complete');

            return {
                originalEvent: event,
                firstPersonNarrative,
                emotionalContext
            };
        } catch (error) {
            console.error('Error transforming event:', error);
            // Fallback to simple transformation
            return {
                originalEvent: event,
                firstPersonNarrative: this.simpleTransform(event)
            };
        }
    }

    /**
     * Generate first-person narrative using LLM
     */
    private async generateFirstPersonNarrative(event: GameEvent): Promise<string> {
        const systemPrompt = 'You are a narrative transformer. Convert third-person game events into first-person narrative from the perspective of the character experiencing the event. Be concise but evocative. Write in past tense. Do not add speculation or extra details not present in the event.';
        const userPrompt = `Event type: ${event.eventType}\nDescription: ${event.description}\n\nTransform this into a first-person narrative (1-2 sentences max):`;

        let narrative: string;

        if (this.apiConnection.isChat()) {
            const prompt: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
                { role: 'system' as const, content: systemPrompt },
                { role: 'user' as const, content: userPrompt }
            ];
            narrative = await this.apiConnection.complete(prompt, false, {
                max_tokens: 100,
                temperature: 0.7
            });
        } else {
            // For non-chat APIs, convert to text format
            const textPrompt = `${systemPrompt}\n\n${userPrompt}\n\nFirst-person narrative:`;
            narrative = await this.apiConnection.complete(textPrompt, false, {
                max_tokens: 100,
                temperature: 0.7
            });
        }

        return narrative.trim();
    }

    /**
     * Generate emotional context (optional)
     */
    private async generateEmotionalContext(event: GameEvent): Promise<string | undefined> {
        // Only generate emotional context for certain event types
        const emotionalEvents = ['death', 'marriage', 'battle', 'betrayal', 'victory', 'defeat'];
        const hasEmotionalRelevance = emotionalEvents.some(type =>
            event.eventType.toLowerCase().includes(type)
        );

        if (!hasEmotionalRelevance) {
            return undefined;
        }

        try {
            const systemPrompt = 'You are analyzing emotional context. Given an event, describe the likely emotional state in 2-4 words.';
            const userPrompt = `Event: ${event.description}\n\nEmotional state:`;

            let emotion: string;

            if (this.apiConnection.isChat()) {
                const prompt: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
                    { role: 'system' as const, content: systemPrompt },
                    { role: 'user' as const, content: userPrompt }
                ];
                emotion = await this.apiConnection.complete(prompt, false, {
                    max_tokens: 20,
                    temperature: 0.5
                });
            } else {
                const textPrompt = `${systemPrompt}\n\n${userPrompt}`;
                emotion = await this.apiConnection.complete(textPrompt, false, {
                    max_tokens: 20,
                    temperature: 0.5
                });
            }

            return emotion.trim();
        } catch (error) {
            console.error('Error generating emotional context:', error);
            return undefined;
        }
    }

    /**
     * Simple rule-based transformation (fallback)
     */
    private simpleTransform(event: GameEvent): string {
        const desc = event.description;

        // Simple pattern matching for common event types
        const patterns = [
            { regex: /(\w+) died/, transform: (m: RegExpMatchArray) => `I learned of ${m[1]}'s death` },
            { regex: /(\w+) married (\w+)/, transform: (m: RegExpMatchArray) => `I witnessed ${m[1]} marry ${m[2]}` },
            { regex: /war declared on (\w+)/, transform: (m: RegExpMatchArray) => `I saw war declared upon ${m[1]}` },
            { regex: /gained trait (\w+)/, transform: (m: RegExpMatchArray) => `I gained the ${m[1]} trait` },
            { regex: /lost trait (\w+)/, transform: (m: RegExpMatchArray) => `I lost the ${m[1]} trait` }
        ];

        for (const pattern of patterns) {
            const match = desc.match(pattern.regex);
            if (match) {
                return pattern.transform(match);
            }
        }

        // Generic fallback
        return `I experienced: ${desc}`;
    }

    /**
     * Generate cache key for an event
     */
    private getCacheKey(event: GameEvent): string {
        // Cache based on event type and description (not timestamp or character ID)
        return `${event.eventType}:${event.description}`;
    }

    /**
     * Clear transformation cache
     */
    clearCache(): void {
        this.transformCache.clear();
        console.log('MemoryTransformer cache cleared');
    }

    /**
     * Update configuration
     */
    updateConfig(config: Config): void {
        this.config = config;
        this.apiConnection = new ApiConnection(
            config.textGenerationApiConnectionConfig.connection,
            config.textGenerationApiConnectionConfig.parameters
        );
        console.log('MemoryTransformer configuration updated');
    }

    /**
     * Batch transform multiple events (more efficient)
     */
    async transformEvents(events: GameEvent[]): Promise<TransformedEvent[]> {
        console.log(`Batch transforming ${events.length} events`);

        const results: TransformedEvent[] = [];

        for (const event of events) {
            const transformed = await this.transformEvent(event);
            results.push(transformed);
        }

        return results;
    }
}
