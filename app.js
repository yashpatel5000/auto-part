import express from "express";
import { insertDataIntoShopify } from "./src/modules/parts/service.js";
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

app.listen(3000, async () => {
  try {
    logger.info("App started.");
    if (config.CRON_JOB_ENABLED) {
      cron.schedule(config.CRON_EXPRESSION, async () => {
        logger.info(`Cron job started at : ${new Date().toUTCString()}`);
        await scheduleDailyJob();
        logger.info(`Cron job ended at : ${new Date().toUTCString()}`);
      });

      cron.schedule(config.CRON_EXPRESSION_FOR_MEDIA_DELETION, async () => {
        logger.info(`Cron Job for media deletion tarted at : ${new Date().toUTCString()}`);
        await deleteAllImages();
        logger.info(`Cron Job for media deletion ended at : ${new Date().toUTCString()}`);
      });
    }
  // await insertDataIntoShopify();
  } catch (error) {
    logger.error("App Crashed.");
  }
});
