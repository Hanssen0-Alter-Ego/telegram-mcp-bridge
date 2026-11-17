// Distinct random key per client, stored with wrangler secret, not here.
// These are server-defined principals, NOT identities asserted by callers.
export default {
 owner: {secretEnv:'MCP_CLIENT_OWNER'},
 // collaborator: {secretEnv:'MCP_CLIENT_COLLABORATOR'},
};
