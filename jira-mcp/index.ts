#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const JIRA_URL = process.env.JIRA_URL?.replace(/\/$/, '');
const JIRA_PAT = process.env.JIRA_PAT;

if (!JIRA_URL || !JIRA_PAT) {
    process.stderr.write('Missing required env vars: JIRA_URL, JIRA_PAT\n');
    process.exit(1);
}

async function jiraRequest(path: string, options: RequestInit = {}) {
    const url = `${JIRA_URL}/rest/api/2${path}`;
    const response = await fetch(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${JIRA_PAT}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(options.headers as Record<string, string>)
        }
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Jira API error ${response.status}: ${error}`);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : {};
}

const server = new Server({ name: 'jira-mcp', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: 'jira_search',
            description: 'Search Jira issues using JQL',
            inputSchema: {
                type: 'object',
                properties: {
                    jql: { type: 'string', description: 'JQL query (e.g. project = DROP AND status != Done)' },
                    maxResults: { type: 'number', description: 'Max results to return (default 20)' }
                },
                required: ['jql']
            }
        },
        {
            name: 'jira_get_issue',
            description: 'Get full details of a Jira issue by key',
            inputSchema: {
                type: 'object',
                properties: {
                    issueKey: { type: 'string', description: 'Issue key (e.g. DROP-1234)' }
                },
                required: ['issueKey']
            }
        },
        {
            name: 'jira_create_issue',
            description: 'Create a new Jira issue',
            inputSchema: {
                type: 'object',
                properties: {
                    projectKey: { type: 'string', description: 'Project key (e.g. DROP)' },
                    summary: { type: 'string', description: 'Issue title/summary' },
                    description: { type: 'string', description: 'Issue description' },
                    issueType: { type: 'string', description: 'Issue type (Bug, Story, Task, etc.) - default: Task' }
                },
                required: ['projectKey', 'summary']
            }
        },
        {
            name: 'jira_add_comment',
            description: 'Add a comment to a Jira issue',
            inputSchema: {
                type: 'object',
                properties: {
                    issueKey: { type: 'string', description: 'Issue key (e.g. DROP-1234)' },
                    comment: { type: 'string', description: 'Comment text' }
                },
                required: ['issueKey', 'comment']
            }
        },
        {
            name: 'jira_get_my_issues',
            description: 'Get open issues assigned to the current user',
            inputSchema: {
                type: 'object',
                properties: {
                    maxResults: { type: 'number', description: 'Max results to return (default 20)' }
                }
            }
        },
        {
            name: 'jira_transition_issue',
            description: 'Transition a Jira issue to a new status (e.g. In Progress, Done)',
            inputSchema: {
                type: 'object',
                properties: {
                    issueKey: { type: 'string', description: 'Issue key (e.g. DROP-1234)' },
                    transitionName: { type: 'string', description: 'Target status name (e.g. In Progress, Done)' }
                },
                required: ['issueKey', 'transitionName']
            }
        },
        {
            name: 'jira_update_issue',
            description:
                'Update fields on an existing Jira issue (summary, description, priority, assignee, team, labels, etc.)',
            inputSchema: {
                type: 'object',
                properties: {
                    issueKey: { type: 'string', description: 'Issue key (e.g. DROP-1234)' },
                    fields: {
                        type: 'object',
                        description: 'Map of field names to values. Use "team" for the team name string.'
                    }
                },
                required: ['issueKey', 'fields']
            }
        },
        {
            name: 'jira_attach_file',
            description: 'Attach a local file to a Jira issue',
            inputSchema: {
                type: 'object',
                properties: {
                    issueKey: { type: 'string', description: 'Issue key (e.g. DROP-1234)' },
                    filePath: { type: 'string', description: 'Absolute path to the local file to attach' }
                },
                required: ['issueKey', 'filePath']
            }
        }
    ]
}));

server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name, arguments: args } = request.params;

    try {
        switch (name) {
            case 'jira_search': {
                const { jql, maxResults = 20 } = args as { jql: string; maxResults?: number };
                const data = await jiraRequest(
                    `/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&fields=summary,status,assignee,priority,issuetype,created,updated`
                );
                const issues = (data.issues ?? []).map((i: any) => ({
                    key: i.key,
                    summary: i.fields.summary,
                    status: i.fields.status?.name,
                    type: i.fields.issuetype?.name,
                    priority: i.fields.priority?.name,
                    assignee: i.fields.assignee?.displayName ?? 'Unassigned',
                    updated: i.fields.updated,
                    url: `${JIRA_URL}/browse/${i.key}`
                }));
                return { content: [{ type: 'text', text: JSON.stringify(issues, null, 2) }] };
            }

            case 'jira_get_issue': {
                const { issueKey } = args as { issueKey: string };
                const data = await jiraRequest(
                    `/issue/${issueKey}?fields=summary,description,status,assignee,reporter,priority,issuetype,created,updated,comment`
                );
                const issue = {
                    key: data.key,
                    url: `${JIRA_URL}/browse/${data.key}`,
                    summary: data.fields.summary,
                    description: data.fields.description,
                    status: data.fields.status?.name,
                    type: data.fields.issuetype?.name,
                    priority: data.fields.priority?.name,
                    assignee: data.fields.assignee?.displayName ?? 'Unassigned',
                    reporter: data.fields.reporter?.displayName,
                    created: data.fields.created,
                    updated: data.fields.updated,
                    comments: (data.fields.comment?.comments ?? []).slice(-5).map((c: any) => ({
                        author: c.author?.displayName,
                        body: c.body,
                        created: c.created
                    }))
                };
                return { content: [{ type: 'text', text: JSON.stringify(issue, null, 2) }] };
            }

            case 'jira_create_issue': {
                const {
                    projectKey,
                    summary,
                    description,
                    issueType = 'Task'
                } = args as {
                    projectKey: string;
                    summary: string;
                    description?: string;
                    issueType?: string;
                };
                const data = await jiraRequest('/issue', {
                    method: 'POST',
                    body: JSON.stringify({
                        fields: {
                            project: { key: projectKey },
                            summary,
                            ...(description ? { description } : {}),
                            issuetype: { name: issueType }
                        }
                    })
                });
                return {
                    content: [{ type: 'text', text: `Created ${data.key}\n${JIRA_URL}/browse/${data.key}` }]
                };
            }

            case 'jira_add_comment': {
                const { issueKey, comment } = args as { issueKey: string; comment: string };
                await jiraRequest(`/issue/${issueKey}/comment`, {
                    method: 'POST',
                    body: JSON.stringify({ body: comment })
                });
                return { content: [{ type: 'text', text: `Comment added to ${issueKey}` }] };
            }

            case 'jira_get_my_issues': {
                const { maxResults = 20 } = args as { maxResults?: number };
                const jql = 'assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC';
                const data = await jiraRequest(
                    `/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&fields=summary,status,priority,issuetype,updated`
                );
                const issues = (data.issues ?? []).map((i: any) => ({
                    key: i.key,
                    summary: i.fields.summary,
                    status: i.fields.status?.name,
                    type: i.fields.issuetype?.name,
                    priority: i.fields.priority?.name,
                    updated: i.fields.updated,
                    url: `${JIRA_URL}/browse/${i.key}`
                }));
                return { content: [{ type: 'text', text: JSON.stringify(issues, null, 2) }] };
            }

            case 'jira_transition_issue': {
                const { issueKey, transitionName } = args as { issueKey: string; transitionName: string };
                const { transitions } = await jiraRequest(`/issue/${issueKey}/transitions`);
                const match = transitions.find((t: any) => t.name.toLowerCase() === transitionName.toLowerCase());
                if (!match) {
                    const available = transitions.map((t: any) => t.name).join(', ');
                    throw new Error(`Transition "${transitionName}" not found. Available: ${available}`);
                }
                await jiraRequest(`/issue/${issueKey}/transitions`, {
                    method: 'POST',
                    body: JSON.stringify({ transition: { id: match.id } })
                });
                return { content: [{ type: 'text', text: `${issueKey} transitioned to "${match.name}"` }] };
            }

            case 'jira_update_issue': {
                const { issueKey, fields } = args as { issueKey: string; fields: Record<string, any> };

                // Discover custom field IDs dynamically when needed
                let teamFieldId: string | null = null;
                if ('team' in fields) {
                    const allFields: any[] = await jiraRequest('/field');
                    const teamField = allFields.find((f: any) => f.name?.toLowerCase() === 'team' && f.custom);
                    teamFieldId = teamField?.id ?? null;
                }

                const jiraFields: Record<string, any> = {};
                for (const [key, value] of Object.entries(fields)) {
                    if (key === 'summary') jiraFields.summary = value;
                    else if (key === 'description') jiraFields.description = value;
                    else if (key === 'priority') jiraFields.priority = { name: value };
                    else if (key === 'assignee') jiraFields.assignee = { name: value };
                    else if (key === 'labels') jiraFields.labels = value;
                    else if (key === 'team') {
                        if (teamFieldId) jiraFields[teamFieldId] = { name: value };
                        else throw new Error('Could not find "Team" custom field in this Jira instance');
                    } else jiraFields[key] = value;
                }
                await jiraRequest(`/issue/${issueKey}`, {
                    method: 'PUT',
                    body: JSON.stringify({ fields: jiraFields })
                });
                return { content: [{ type: 'text', text: `${issueKey} updated successfully` }] };
            }

            case 'jira_attach_file': {
                const { issueKey, filePath } = args as { issueKey: string; filePath: string };
                const fs = await import('fs');
                const path = await import('path');
                const fileBuffer = fs.readFileSync(filePath);
                const fileName = path.basename(filePath);
                const formData = new FormData();
                formData.append('file', new Blob([fileBuffer]), fileName);
                const url = `${JIRA_URL}/rest/api/2/issue/${issueKey}/attachments`;
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${JIRA_PAT}`,
                        'X-Atlassian-Token': 'no-check'
                    },
                    body: formData
                });
                if (!response.ok) {
                    const error = await response.text();
                    throw new Error(`Jira API error ${response.status}: ${error}`);
                }
                return { content: [{ type: 'text', text: `File "${fileName}" attached to ${issueKey}` }] };
            }

            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    } catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
        };
    }
});

const transport = new StdioServerTransport();
(async () => {
    await server.connect(transport);
})();
