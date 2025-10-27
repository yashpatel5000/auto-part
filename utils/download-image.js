import puppeteer from "puppeteer";
import { uploadBufferToS3 } from "./aws.js";
import { SIGNED_URL_CONTENT_TYPE } from "./constant.js";
import logger from "./logger.js";

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
      logger.error(
        "❌ Failed to load image:",
        response ? response.status() : "no response"
      );
      await browser.close();
      throw new Error("Failed to load image : 403");
    }

    const buffer = await response.buffer();

    await uploadBufferToS3(
      buffer,
      fileName,
      SIGNED_URL_CONTENT_TYPE[url.split(".").pop()]
    );

    return {
      filePath: `https://auto-part.s3.eu-north-1.amazonaws.com/${fileName}`,
      fileName,
    };
  } catch (error) {
    logger.error("Failed to load image : 403");
    throw error;
  } finally {
    if(browser){
      await browser.close()
    }
  }
};

export default downloadImage;
