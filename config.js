import dotenvSafe from "dotenv-safe";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenvSafe.config({
  path: path.resolve(__dirname, ".config/.env"),
  example: path.resolve(__dirname, ".env.example"),
});

export const config = {
  MONGO_URI: process.env.MONGO_URI,
  SHOPIFY_ACCESS_TOKEN: process.env.SHOPIFY_ACCESS_TOKEN,
  PARTS_API_USER_NAME: process.env.PARTS_API_USER_NAME,
  PARTS_API_PASSWORD: process.env.PARTS_API_PASSWORD,
  PARTS_API_USER_TOKEN: process.env.PARTS_API_USER_TOKEN,
  PARTS_API_ENDPOINT: process.env.PARTS_API_ENDPOINT,
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  AWS_REGION: process.env.AWS_REGION,
  AWS_S3_BUCKET_NAME: process.env.AWS_S3_BUCKET_NAME,
  CRON_JOB_ENABLED: process.env.CRON_JOB_ENABLED?.toString() !== "false",
  CRON_EXPRESSION: process.env.CRON_EXPRESSION,
  CRON_EXPRESSION_FOR_MEDIA_DELETION: process.env.CRON_EXPRESSION_FOR_MEDIA_DELETION,
  STORE: process.env.STORE,
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET,
};
