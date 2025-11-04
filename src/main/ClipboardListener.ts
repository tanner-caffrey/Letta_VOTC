import {clipboard} from "electron";
import {EventEmitter} from 'events';

export class ClipboardListener extends EventEmitter{
    previousClipboard: string;
    isListening: boolean;
    interval: any;

    constructor(){
        super();
        let clipboardText = clipboard.readText();
        if(clipboardText.startsWith('VOTC:')){
            clipboard.writeText('');
            this.previousClipboard = '';
        }
        else{
            this.previousClipboard = clipboardText;
        }

        this.isListening = false;
        console.log('ClipboardListener initialized.');
    }

    start(){
        if(this.isListening){
            throw new Error('ClipboardListener is already listening!');
        }
        this.interval = setInterval(this.readClipboard.bind(this), 100);
        this.isListening = true;
        console.log('ClipboardListener started.');
    }

    stop(){
        if(!this.isListening){
            throw new Error('ClipboardListener is not currently listening!');
        }

        clearInterval(this.interval);
        this.isListening = false;
        console.log('ClipboardListener stopped.');
    }

    readClipboard(){
        let currentClipboard = clipboard.readText();
        if(this.previousClipboard == currentClipboard) return;

        if(currentClipboard.startsWith('VOTC:')){
            const parts = currentClipboard.split(':');
            const command = parts[1];
            console.log(`VOTC command detected: ${command}`);

            switch (command){
                case "IN":
                    this.emit('VOTC:IN');
                    break;

                case "EFFECT_ACCEPTED":
                    this.emit('VOTC:EFFECT_ACCEPTED');
                    break;

                case "AGENT_CREATE":
                    // Format: VOTC:AGENT_CREATE:characterId:characterName
                    if (parts.length >= 4) {
                        const characterId = parseInt(parts[2]);
                        const characterName = parts.slice(3).join(':'); // Handle names with colons
                        console.log(`Agent creation requested for character ${characterId}: ${characterName}`);
                        this.emit('VOTC:AGENT_CREATE', { characterId, characterName });
                    } else {
                        console.error('Invalid AGENT_CREATE event format');
                    }
                    break;

                case "EVENT":
                    // Format: VOTC:EVENT:characterId:eventType:eventDescription
                    if (parts.length >= 5) {
                        const characterId = parseInt(parts[2]);
                        const eventType = parts[3];
                        const eventDescription = parts.slice(4).join(':'); // Handle descriptions with colons
                        console.log(`Game event for character ${characterId}: ${eventType}`);
                        this.emit('VOTC:EVENT', { characterId, eventType, eventDescription });
                    } else {
                        console.error('Invalid EVENT format');
                    }
                    break;

                case "SAVE_LOAD":
                    // Format: VOTC:SAVE_LOAD:saveId:saveName:gameDate:playerCharacterId
                    if (parts.length >= 3) {
                        const saveId = parts[2];
                        const saveName = parts.length >= 4 ? parts[3] : undefined;
                        const gameDate = parts.length >= 5 ? parts[4] : undefined;
                        const playerCharacterId = parts.length >= 6 ? parseInt(parts[5]) : undefined;
                        console.log(`Save loaded: ${saveId} (${saveName || 'unnamed'})`);
                        this.emit('VOTC:SAVE_LOAD', {
                            saveId,
                            saveName,
                            gameDate,
                            playerCharacterId
                        });
                    } else {
                        console.error('Invalid SAVE_LOAD format');
                    }
                    break;

                case "SAVE_CLOSE":
                    // Format: VOTC:SAVE_CLOSE:saveId
                    if (parts.length >= 3) {
                        const saveId = parts[2];
                        console.log(`Save closing: ${saveId}`);
                        this.emit('VOTC:SAVE_CLOSE', { saveId });
                    } else {
                        console.error('Invalid SAVE_CLOSE format');
                    }
                    break;

                default:
                    console.warn(`Unknown VOTC command: ${command}`);
            }

            clipboard.writeText(this.previousClipboard);
        }
        else{
            this.previousClipboard = clipboard.readText();
        }
    }
}

