import { ipcRenderer } from 'electron';

let testConnectionButton: HTMLButtonElement = document.querySelector("#test-letta-connection")!;
let connectionStatus: HTMLSpanElement = document.querySelector("#connection-status")!;
let refreshAgentsButton: HTMLButtonElement = document.querySelector("#refresh-agents")!;
let backupAgentsButton: HTMLButtonElement = document.querySelector("#backup-agents")!;
let agentsContainer: HTMLDivElement = document.querySelector("#agents-container")!;
let noAgentsMessage: HTMLParagraphElement = document.querySelector("#no-agents-message")!;

let config: any;

document.getElementById("container")!.style.display = "block";

init();

async function init() {
    config = await ipcRenderer.invoke('get-config');
    console.log('Letta config loaded:', config);

    // Test connection button
    testConnectionButton.addEventListener('click', async () => {
        await testLettaConnection();
    });

    // Refresh agents button
    refreshAgentsButton.addEventListener('click', async () => {
        await refreshAgentList();
    });

    // Backup agents button
    backupAgentsButton.addEventListener('click', async () => {
        await backupAgents();
    });

    // Initial agent list load
    await refreshAgentList();
}

async function testLettaConnection() {
    testConnectionButton.disabled = true;
    connectionStatus.innerText = " Testing...";
    connectionStatus.style.color = "blue";

    try {
        const result = await ipcRenderer.invoke('test-letta-connection');

        if (result.success) {
            connectionStatus.innerText = " ✓ Connected successfully";
            connectionStatus.style.color = "green";

            if (result.serverInfo) {
                connectionStatus.innerText += ` (v${result.serverInfo.version || 'unknown'})`;
            }
        } else {
            connectionStatus.innerText = ` ✗ Connection failed: ${result.error}`;
            connectionStatus.style.color = "red";
        }
    } catch (error: any) {
        connectionStatus.innerText = ` ✗ Error: ${error.message}`;
        connectionStatus.style.color = "red";
    } finally {
        testConnectionButton.disabled = false;
    }
}

async function refreshAgentList() {
    refreshAgentsButton.disabled = true;

    try {
        const result = await ipcRenderer.invoke('get-letta-agents');

        if (result.success && result.agents && result.agents.length > 0) {
            noAgentsMessage.style.display = "none";
            agentsContainer.innerHTML = "";

            result.agents.forEach((agent: any) => {
                const agentDiv = document.createElement("div");
                agentDiv.className = "agent-item";
                agentDiv.style.padding = "10px";
                agentDiv.style.marginBottom = "10px";
                agentDiv.style.border = "1px solid #444";
                agentDiv.style.borderRadius = "4px";

                const agentName = document.createElement("strong");
                agentName.innerText = agent.characterName || `Character ${agent.characterId}`;

                const agentId = document.createElement("span");
                agentId.innerText = ` (Agent ID: ${agent.agentId.substring(0, 8)}...)`;
                agentId.style.color = "#888";
                agentId.style.fontSize = "0.9em";

                const agentDate = document.createElement("div");
                agentDate.innerText = `Created: ${new Date(agent.createdAt).toLocaleString()}`;
                agentDate.style.fontSize = "0.85em";
                agentDate.style.color = "#666";
                agentDate.style.marginTop = "5px";

                agentDiv.appendChild(agentName);
                agentDiv.appendChild(agentId);
                agentDiv.appendChild(agentDate);
                agentsContainer.appendChild(agentDiv);
            });
        } else {
            noAgentsMessage.style.display = "block";
            agentsContainer.innerHTML = "";
        }
    } catch (error: any) {
        console.error('Error refreshing agent list:', error);
        noAgentsMessage.innerText = `Error loading agents: ${error.message}`;
        noAgentsMessage.style.display = "block";
        agentsContainer.innerHTML = "";
    } finally {
        refreshAgentsButton.disabled = false;
    }
}

async function backupAgents() {
    backupAgentsButton.disabled = true;
    const originalText = backupAgentsButton.innerText;
    backupAgentsButton.innerText = "Backing up...";

    try {
        const result = await ipcRenderer.invoke('backup-letta-agents');

        if (result.success) {
            backupAgentsButton.innerText = "✓ Backed up!";
            setTimeout(() => {
                backupAgentsButton.innerText = originalText;
            }, 2000);
        } else {
            backupAgentsButton.innerText = "✗ Backup failed";
            setTimeout(() => {
                backupAgentsButton.innerText = originalText;
            }, 2000);
        }
    } catch (error: any) {
        console.error('Error backing up agents:', error);
        backupAgentsButton.innerText = "✗ Error";
        setTimeout(() => {
            backupAgentsButton.innerText = originalText;
        }, 2000);
    } finally {
        backupAgentsButton.disabled = false;
    }
}
