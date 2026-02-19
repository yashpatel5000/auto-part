import puppeteer from "puppeteer";
import { uploadBufferToS3 } from "./aws.js";
import { SIGNED_URL_CONTENT_TYPE } from "./constant.js";
import { config } from "../config.js";
import logger from "./logger.js";

const getContentType = (url) => {
  const cleanUrl = url.split("?")[0];
  const ext = cleanUrl.split(".").pop().toUpperCase();
  return SIGNED_URL_CONTENT_TYPE[ext] || "image/jpeg";
};

const downloadImage = async (url) => {
  let browser;

  try {
    const fileName = `${Date.now()}.jpeg`;

    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/113.0.0.0 Safari/537.36"
    );

    const response = await page.goto(url, { waitUntil: "networkidle2" });

    if (!response || response.status() !== 200) {
      const status = response ? response.status() : "no response";
      logger.error(`❌ Failed to load image (${status}): ${url}`);
      throw new Error(`Failed to load image: HTTP ${status}`);
    }

    const buffer = await response.buffer();

    await uploadBufferToS3(buffer, fileName, getContentType(url));

    const filePath = `https://${config.AWS_S3_BUCKET_NAME}.s3.${config.AWS_REGION}.amazonaws.com/${fileName}`;

    return { filePath, fileName };
  } catch (error) {
    logger.error(`Failed to download image from ${url}: ${error.message}`);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};

export default downloadImage;
