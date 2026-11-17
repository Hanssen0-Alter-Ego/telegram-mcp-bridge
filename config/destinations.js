// Dedicated bot only. Pulls are explicit, never background; messages are untrusted data.
// Configuration is code-reviewed, not editable through MCP or a management UI.
// Add only destinations the owner has authorized. Use numeric chat IDs as strings.
export default {
  enabled: false,
  destinations: {
    // personal: { chatId: "123456789", description: "Owner's private chat", purpose: "Authorized notifications", canRead: true, canSend: true, allowedCallerIds: ["owner"]  },
    // team: { chatId: "-1001234567890", threadId: 42, description: "Team topic", purpose: "Approved project updates", canRead: true, canSend: true, allowedCallerIds: ["owner"]  },
  },
  maxTextLength: 4096,
  timeoutMs: 15000,
};
