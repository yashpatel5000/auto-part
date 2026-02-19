import express from "express";
import webhookRouter from "./src/modules/webhook/route.js";
import logger from "./utils/logger.js";
import cron from "node-cron";
import { scheduleDailyJob } from "./utils/cron-job.js";
import { config } from "./config.js";
import { deleteAllImages } from "./utils/aws.js";

const app = express();

app.use(express.static("public"));
app.use(express.json());
app.use(webhookRouter);

const server = app.listen(3000, async () => {
  try {
    logger.info("App started on port 3000.");
    if (config.CRON_JOB_ENABLED) {
      cron.schedule(config.CRON_EXPRESSION, async () => {
        logger.info(`Cron job started at: ${new Date().toUTCString()}`);
        await scheduleDailyJob();
        logger.info(`Cron job ended at: ${new Date().toUTCString()}`);
      });

      cron.schedule(config.CRON_EXPRESSION_FOR_MEDIA_DELETION, async () => {
        logger.info(`Media deletion cron started at: ${new Date().toUTCString()}`);
        await deleteAllImages();
        logger.info(`Media deletion cron ended at: ${new Date().toUTCString()}`);
      });
    }
  } catch (error) {
    logger.error(`App startup error: ${error.message}`);
  }
});

const shutdown = (signal) => {
  logger.info(`${signal} received. Shutting down gracefully.`);
  server.close(() => {
    logger.info("HTTP server closed.");
    process.exit(0);
  });
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
