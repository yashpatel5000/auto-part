import fs from "fs";
import puppeteer from "puppeteer";

const getFileName = (url) => {
  const file = url.split("/").pop();
  const [name, ext] = file.split(/\.(?=[^\.]+$)/);
  return `${name}.${ext.toLowerCase()}`;
};

const downloadImage = async (url) => {
  const fileName = getFileName(url);
  const filePath = `public/images/${fileName}`;

  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/113.0.0.0 Safari/537.36"
  );

  const response = await page.goto(url, { waitUntil: "networkidle2" });

  if (!response || response.status() !== 200) {
    console.error("❌ Failed to load image:", response ? response.status() : "no response");
    await browser.close();
    return null;
  }

  const buffer = await response.buffer();
  fs.writeFileSync(filePath, buffer);
  console.log(`✅ Saved: ${filePath} (${buffer.length} bytes)`);

  await browser.close();
  return {
    filename: `https://8946-1-38-234-23.ngrok-free.app/${fileName}`,
    filePath
  };
};

export default downloadImage;
