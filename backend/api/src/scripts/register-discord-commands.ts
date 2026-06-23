import { env, logger } from "@almirant/config";
import { getDiscordSlashCommands } from "../domains/integrations/discord/services/discord-commands";

const DISCORD_API_BASE = "https://discord.com/api/v10";

const assertEnv = (): {
  botToken: string;
  applicationId: string;
  guildId: string;
} => {
  const botToken = env.DISCORD_BOT_TOKEN?.trim();
  const applicationId = env.DISCORD_APPLICATION_ID?.trim();
  const guildId = env.DISCORD_GUILD_ID?.trim();

  if (!botToken) {
    throw new Error("Missing DISCORD_BOT_TOKEN");
  }

  if (!applicationId) {
    throw new Error("Missing DISCORD_APPLICATION_ID");
  }

  if (!guildId) {
    throw new Error("Missing DISCORD_GUILD_ID");
  }

  return { botToken, applicationId, guildId };
};

const registerCommands = async (): Promise<void> => {
  const { botToken, applicationId, guildId } = assertEnv();

  const response = await fetch(
    `${DISCORD_API_BASE}/applications/${applicationId}/guilds/${guildId}/commands`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(getDiscordSlashCommands()),
    }
  );

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    throw new Error(
      `Failed to register Discord commands (${response.status}): ${raw.slice(0, 500)}`
    );
  }

  const payload = (await response.json()) as unknown[];
  logger.info(
    { guildId, applicationId, commandCount: Array.isArray(payload) ? payload.length : 0 },
    "Discord slash commands registered"
  );
};

registerCommands()
  .then(() => {
    console.log("Discord commands registered successfully.");
  })
  .catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Failed to register Discord commands"
    );
    process.exit(1);
  });
