import dotenv from "dotenv";
import express from "express";
import { insertDataIntoShopify } from "./src/modules/parts/service.js";
import webhookRouter from "./src/modules/webhook/route.js";

dotenv.config();

const app = express();

app.use(express.static("public"));
app.use(express.json());
app.use(webhookRouter);

app.listen(3000, async () => {
  try {
    console.log("App started.");
    await insertDataIntoShopify();
  } catch (error) {
    console.log('Received');
    console.log(error);
    await insertDataIntoShopify();
  }
});
