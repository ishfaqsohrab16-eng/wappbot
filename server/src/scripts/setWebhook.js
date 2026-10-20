// Register this app's webhook on the Evolution API instance: npm run set-webhook
import { config } from "../config.js";
import { setWebhook, evolutionEnabled } from "../whatsapp/evolution.js";

if (!evolutionEnabled() || !config.publicUrl || !config.evolution.webhookSecret) {
  console.error("Set EVOLUTION_BASE_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE, PUBLIC_URL and WEBHOOK_SECRET first.");
  process.exit(1);
}
const url = `${config.publicUrl}/webhook/evolution/${config.evolution.webhookSecret}`;
try {
  await setWebhook(url);
  console.log(`Webhook set for instance "${config.evolution.instance}" -> ${config.publicUrl}/webhook/evolution/***`);
} catch (err) {
  console.error("Failed:", err.message, err.body ?? "");
  process.exit(1);
}
