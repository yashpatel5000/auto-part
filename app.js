import dotenv from "dotenv";
import express from "express";
import { insertDataIntoShopify } from "./src/modules/parts/service.js";
import webhookRouter from "./src/modules/webhook/route.js";
import logger from "./utils/logger.js";
import cron from "node-cron";

dotenv.config();

const app = express();

app.use(express.static("public"));
app.use(express.json());
app.use(webhookRouter);

cron.schedule('0 0 0 * * *', () => {
    console.log('running a task every minute');
});

app.listen(3000, async () => {
  try {
    console.log("App started.");
    await insertDataIntoShopify();
  } catch (error) {
    logger.error(error);
    await insertDataIntoShopify();
  }
});
