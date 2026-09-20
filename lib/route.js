'use strict';

// Which Discord channel a message came from, and what may happen with it.
//
// Two channels since 19.09.2026:
//   chat   the public channel. Game chat in both directions.
//   admin  a private channel. !reboot, !save, !status, !say, !quiet, !loud
//          and the notices of the bridge. Nothing from here is relayed into
//          the game as chat - an admin channel that leaks into the game chat
//          would be a trap.
// Without an admin channel everything stays in the chat channel, as before.
function routeDiscordMessage({ channelId, chatChannelId, adminChannelId = null }) {
  const id = String(channelId);
  const isChat = id === String(chatChannelId);
  const isAdmin = adminChannelId !== null && adminChannelId !== undefined && id === String(adminChannelId);
  // Somebody may put the same id in both fields. Then it is one channel that
  // does both, which is exactly the behaviour from before the split.
  if (isChat && isAdmin) return 'both';
  if (isAdmin) return 'admin';
  if (isChat) return adminChannelId ? 'chat' : 'both';
  return 'ignore';
}

module.exports = { routeDiscordMessage };
