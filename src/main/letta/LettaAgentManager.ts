import { LettaClient } from '@letta-ai/letta-client';
import { Config } from '../../shared/Config.js';
import { GameData } from '../../shared/gameData/GameData.js';
import { Character } from '../../shared/gameData/Character.js';
import {
    AgentMapping,
    SaveAgentMappings,
    LettaAgent,
    SaveIdentifier,
    AgentMemoryInit
} from './types.js';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import crypto from 'crypto';

const userDataPath = path.join(app.getPath('userData'), 'votc_data');

export class LettaAgentManager {
    private client: LettaClient;
    private config: Config;
    private currentSaveId: string | null = null;
    private agentMappings: Map<number, AgentMapping> = new Map();
    private activeAgents: Map<number, LettaAgent> = new Map();
    private savesBasePath: string;

    constructor(config: Config) {
        console.log('Initializing LettaAgentManager');
        this.config = config;
        this.client = new LettaClient({
            baseUrl: config.lettaServerUrl
        });
        this.savesBasePath = path.join(userDataPath, 'letta', 'saves');

        // Ensure base directory exists
        if (!fs.existsSync(this.savesBasePath)) {
            fs.mkdirSync(this.savesBasePath, { recursive: true });
            console.log(`Created Letta saves directory: ${this.savesBasePath}`);
        }
    }

    /**
     * Initialize manager for a specific save
     */
    async initializeForSave(saveIdentifier: SaveIdentifier): Promise<void> {
        console.log(`Initializing Letta agents for save: ${saveIdentifier.saveId}`);

        this.currentSaveId = saveIdentifier.saveId;
        this.agentMappings.clear();
        this.activeAgents.clear();

        const savePath = this.getSavePath(saveIdentifier.saveId);

        // Ensure save directory structure exists
        if (!fs.existsSync(savePath)) {
            fs.mkdirSync(savePath, { recursive: true });
            console.log(`Created save directory: ${savePath}`);
        }

        const backupPath = path.join(savePath, 'agent_backups');
        if (!fs.existsSync(backupPath)) {
            fs.mkdirSync(backupPath, { recursive: true });
            console.log(`Created agent backups directory: ${backupPath}`);
        }

        // Load existing mappings
        const mappingsPath = path.join(savePath, 'agent_mappings.json');
        if (fs.existsSync(mappingsPath)) {
            try {
                const mappingsData: SaveAgentMappings = JSON.parse(
                    fs.readFileSync(mappingsPath, 'utf8')
                );
                mappingsData.agents.forEach(mapping => {
                    this.agentMappings.set(mapping.characterId, mapping);
                });
                console.log(`Loaded ${mappingsData.agents.length} agent mappings for save ${saveIdentifier.saveId}`);
            } catch (error) {
                console.error('Error loading agent mappings:', error);
            }
        } else {
            // Create empty mappings file
            const emptyMappings: SaveAgentMappings = {
                saveId: saveIdentifier.saveId,
                saveName: saveIdentifier.saveName,
                agents: []
            };
            fs.writeFileSync(mappingsPath, JSON.stringify(emptyMappings, null, '\t'));
            console.log(`Created empty agent mappings file for save ${saveIdentifier.saveId}`);
        }

        // Restore agents from backups
        await this.restoreAgentsFromBackups(saveIdentifier.saveId);
    }

    /**
     * Get or create a Letta agent for a character
     */
    async getOrCreateAgent(characterId: number, gameData: GameData): Promise<string> {
        console.log(`Getting or creating agent for character ID: ${characterId}`);

        if (!this.currentSaveId) {
            throw new Error('No save initialized. Call initializeForSave() first.');
        }

        // Check if agent already exists
        const existingMapping = this.agentMappings.get(characterId);
        if (existingMapping) {
            console.log(`Agent already exists for character ${characterId}: ${existingMapping.agentId}`);
            return existingMapping.agentId;
        }

        // Create new agent
        const character = gameData.getCharacter(characterId);
        if (!character) {
            throw new Error(`Character ${characterId} not found in game data`);
        }

        console.log(`Creating new Letta agent for character: ${character.fullName}`);

        // Build memory initialization
        const memoryInit = this.buildAgentMemory(character, gameData);

        // Create agent via Letta SDK
        const agentState = await this.client.agents.create({
            name: `votc_${this.currentSaveId}_${characterId}_${character.shortName}`,
            model: this.config.lettaDefaultModel,
            embedding: this.config.lettaDefaultEmbedding,
            memoryBlocks: [
                {
                    label: 'persona',
                    value: memoryInit.persona,
                    limit: 5000,
                    description: 'Character personality, traits, and behavioral patterns'
                },
                {
                    label: 'character_bio',
                    value: memoryInit.characterBio,
                    limit: 5000,
                    description: 'Basic biographical information about the character'
                },
                {
                    label: 'relationships',
                    value: memoryInit.relationships,
                    limit: 10000,
                    description: 'Important relationships with other characters'
                },
                {
                    label: 'current_context',
                    value: memoryInit.currentContext,
                    limit: 5000,
                    description: 'Current in-game situation and recent events'
                }
            ],
            tags: [
                `votc`,
                `save:${this.currentSaveId}`,
                `character:${characterId}`,
                `ck3`
            ]
        });

        console.log(`Created Letta agent: ${agentState.id} for character ${character.fullName}`);

        // Populate archival memory
        for (const memory of memoryInit.archivalMemories) {
            await this.client.agents.passages.create(agentState.id, {
                text: memory
            });
        }
        console.log(`Added ${memoryInit.archivalMemories.length} archival memories for agent ${agentState.id}`);

        // Create mapping
        const mapping: AgentMapping = {
            characterId: characterId,
            agentId: agentState.id,
            characterName: character.fullName,
            createdAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
        };

        this.agentMappings.set(characterId, mapping);
        this.saveMappings();

        // Create LettaAgent wrapper
        const lettaAgent: LettaAgent = {
            agentState: agentState,
            characterId: characterId,
            characterName: character.fullName,
            lastEventFlush: new Date(),
            pendingEvents: []
        };
        this.activeAgents.set(characterId, lettaAgent);

        return agentState.id;
    }

    /**
     * Check if character has an agent
     */
    hasAgent(characterId: number): boolean {
        return this.agentMappings.has(characterId);
    }

    /**
     * Get agent ID for character
     */
    getAgentId(characterId: number): string | null {
        const mapping = this.agentMappings.get(characterId);
        return mapping ? mapping.agentId : null;
    }

    /**
     * Get active agent for character
     */
    getAgent(characterId: number): LettaAgent | null {
        return this.activeAgents.get(characterId) || null;
    }

    /**
     * Get all agent mappings for current save (for UI display)
     */
    getAllAgents(): AgentMapping[] {
        return Array.from(this.agentMappings.values());
    }

    /**
     * Backup all agents for current save
     */
    async backupAgentsForSave(): Promise<void> {
        if (!this.currentSaveId) {
            console.warn('No save initialized, skipping backup');
            return;
        }

        console.log(`Backing up agents for save: ${this.currentSaveId}`);
        const backupPath = path.join(this.getSavePath(this.currentSaveId), 'agent_backups');

        // Ensure backup directory exists
        if (!fs.existsSync(backupPath)) {
            fs.mkdirSync(backupPath, { recursive: true });
        }

        let successCount = 0;
        let failCount = 0;

        for (const [characterId, mapping] of this.agentMappings) {
            try {
                console.log(`Backing up agent for character ${characterId}: ${mapping.agentId}`);

                // Export agent to serialized format (JSON string)
                const agentSchema = await this.client.agents.exportFile(mapping.agentId);

                // Save to .af file
                const backupFilePath = path.join(backupPath, `${characterId}_${mapping.agentId}.af`);
                // agentSchema is already a formatted JSON string from exportFile
                fs.writeFileSync(backupFilePath, agentSchema);

                console.log(`✓ Successfully backed up agent to ${backupFilePath}`);
                successCount++;
            } catch (error) {
                console.error(`✗ Error backing up agent for character ${characterId}:`, error);
                failCount++;
            }
        }

        console.log(`Completed backup: ${successCount} succeeded, ${failCount} failed (${this.agentMappings.size} total)`);
    }

    /**
     * Restore agents from backups for a save
     */
    private async restoreAgentsFromBackups(saveId: string): Promise<void> {
        console.log(`Restoring agents from backups for save: ${saveId}`);
        const backupPath = path.join(this.getSavePath(saveId), 'agent_backups');

        if (!fs.existsSync(backupPath)) {
            console.log('No backups found to restore');
            return;
        }

        const backupFiles = fs.readdirSync(backupPath).filter(file => file.endsWith('.af'));

        if (backupFiles.length === 0) {
            console.log('No .af backup files found');
            return;
        }

        console.log(`Found ${backupFiles.length} agent backup(s) to restore`);

        let successCount = 0;
        let failCount = 0;

        for (const file of backupFiles) {
            try {
                const filePath = path.join(backupPath, file);
                console.log(`Restoring agent from ${file}`);

                // Read .af file and create ReadStream
                const fileStream = fs.createReadStream(filePath);

                // Import agent from file
                // Returns ImportedAgentsResponse with imported agent IDs
                const importResponse = await this.client.agents.importFile(fileStream, {});

                // importFile returns list of imported agent IDs
                if (!importResponse.agentIds || importResponse.agentIds.length === 0) {
                    console.warn(`No agents imported from ${file}`);
                    continue;
                }

                // Use the first imported agent (should only be one per file)
                const newAgentId = importResponse.agentIds[0];
                console.log(`✓ Successfully imported agent: ${newAgentId}`);

                // Get the agent state to extract name
                const agentState = await this.client.agents.retrieve(newAgentId);

                // Extract character ID from filename format: {characterId}_{oldAgentId}.af
                const characterId = parseInt(file.split('_')[0]);

                if (isNaN(characterId)) {
                    console.warn(`Could not extract character ID from filename: ${file}`);
                    continue;
                }

                // Update or create mapping with new agent ID
                // (Agent ID may change on import)
                const mapping: AgentMapping = {
                    characterId: characterId,
                    agentId: newAgentId,
                    characterName: agentState.name.replace(`votc_${saveId}_${characterId}_`, ''), // Extract character name
                    createdAt: new Date().toISOString(),
                    lastUpdated: new Date().toISOString()
                };

                this.agentMappings.set(characterId, mapping);
                console.log(`✓ Restored agent mapping for character ${characterId} → ${newAgentId}`);

                successCount++;
            } catch (error) {
                console.error(`✗ Error restoring agent from ${file}:`, error);
                failCount++;
            }
        }

        // Save updated mappings to disk
        if (successCount > 0) {
            this.saveMappings();
            console.log(`Saved ${successCount} restored agent mapping(s)`);
        }

        console.log(`Completed restoration: ${successCount} succeeded, ${failCount} failed (${backupFiles.length} total)`);
    }

    /**
     * Delete an agent
     */
    async deleteAgent(characterId: number): Promise<void> {
        const mapping = this.agentMappings.get(characterId);
        if (!mapping) {
            console.warn(`No agent found for character ${characterId}`);
            return;
        }

        console.log(`Deleting agent for character ${characterId}: ${mapping.agentId}`);

        try {
            await this.client.agents.delete(mapping.agentId);
            console.log(`Deleted agent ${mapping.agentId} from Letta server`);
        } catch (error) {
            console.error(`Error deleting agent ${mapping.agentId}:`, error);
        }

        this.agentMappings.delete(characterId);
        this.activeAgents.delete(characterId);
        this.saveMappings();

        console.log(`Removed agent mapping for character ${characterId}`);
    }

    /**
     * Test connection to Letta server
     */
    async testConnection(): Promise<boolean> {
        try {
            await this.client.agents.list({ limit: 1 });
            console.log('Letta server connection successful');
            return true;
        } catch (error) {
            console.error('Letta server connection failed:', error);
            return false;
        }
    }

    /**
     * Update configuration
     */
    updateConfig(config: Config): void {
        this.config = config;
        this.client = new LettaClient({
            baseUrl: config.lettaServerUrl
        });
        console.log(`Updated Letta configuration. Server URL: ${config.lettaServerUrl}`);
    }

    /**
     * Get client for advanced operations
     */
    getClient(): LettaClient {
        return this.client;
    }

    /**
     * Build agent memory from character and game data
     */
    private buildAgentMemory(character: Character, gameData: GameData): AgentMemoryInit {
        // Build persona from traits
        const traitDescriptions = character.traits.map(trait => trait.desc).join('. ');
        const persona = `I am ${character.fullName}, ${character.age} years old. ${traitDescriptions}`;

        // Build character bio
        const characterBio = `Name: ${character.fullName} (${character.shortName})
Age: ${character.age}
House: ${character.house}
Culture: ${character.culture}
Faith: ${character.faith}
Primary Title: ${character.primaryTitle || 'None'}
Personality: ${character.personality}`;

        // Build relationships
        let relationshipsText = 'Key Relationships:\n';

        // Relationships to player
        if (character.relationsToPlayer.length > 0) {
            relationshipsText += `With ${gameData.playerName}: ${character.relationsToPlayer.join(', ')}\n`;
        }

        // Opinion of player
        const playerOpinion = character.opinions.find(op => op.id === gameData.playerID);
        if (playerOpinion) {
            relationshipsText += `Opinion of ${gameData.playerName}: ${playerOpinion.opinon}\n`;
        }

        // Relationships with other characters
        character.relationsToCharacters.forEach(rel => {
            const otherChar = gameData.getCharacter(rel.id);
            if (otherChar) {
                relationshipsText += `With ${otherChar.fullName}: ${rel.relations.join(', ')}\n`;
            }
        });

        // Build current context
        const currentContext = `Current location: ${gameData.location}
Current date: ${gameData.date}
Scene: ${gameData.scene}`;

        // Build archival memories from character memories and secrets
        const archivalMemories: string[] = [];

        // Add character memories
        character.memories.forEach(memory => {
            archivalMemories.push(`[${memory.creationDate}] ${memory.type}: ${memory.desc}`);
        });

        // Add secrets (if any)
        character.secrets.forEach(secret => {
            archivalMemories.push(`[SECRET - ${secret.category}] ${secret.name}: ${secret.desc}`);
        });

        // Load existing conversation summaries if they exist
        const summariesPath = path.join(
            userDataPath,
            'conversation_summaries',
            gameData.playerID.toString(),
            `${character.id}.json`
        );

        if (fs.existsSync(summariesPath)) {
            try {
                const summaries = JSON.parse(fs.readFileSync(summariesPath, 'utf8'));
                summaries.forEach((summary: any) => {
                    archivalMemories.push(`[Conversation ${summary.date}] ${summary.content}`);
                });
                console.log(`Loaded ${summaries.length} conversation summaries for character ${character.id}`);
            } catch (error) {
                console.error(`Error loading conversation summaries for character ${character.id}:`, error);
            }
        }

        return {
            persona,
            characterBio,
            relationships: relationshipsText,
            currentContext,
            archivalMemories
        };
    }

    /**
     * Get save path for a save ID
     */
    private getSavePath(saveId: string): string {
        return path.join(this.savesBasePath, saveId);
    }

    /**
     * Save agent mappings to disk
     */
    private saveMappings(): void {
        if (!this.currentSaveId) return;

        const mappingsData: SaveAgentMappings = {
            saveId: this.currentSaveId,
            agents: Array.from(this.agentMappings.values())
        };

        const mappingsPath = path.join(this.getSavePath(this.currentSaveId), 'agent_mappings.json');
        fs.writeFileSync(mappingsPath, JSON.stringify(mappingsData, null, '\t'));
        console.log(`Saved agent mappings for save ${this.currentSaveId}`);
    }

    /**
     * Generate a save ID from game data (if not provided by mod)
     */
    static generateSaveId(gameData: GameData): string {
        const data = `${gameData.playerID}_${gameData.date}_${gameData.location}`;
        return crypto.createHash('md5').update(data).digest('hex').substring(0, 16);
    }
}
