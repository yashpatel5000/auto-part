import axios from "axios";
import dotenv from "dotenv";
import connectDB from "./db.js";
import express from "express";
import downloadImage from "./utils/download-image.js";
import { productCreate, createVariantQuery } from "./graphql/mutation.js";
import { shopifyGraphQLRequest } from "./utils/shopify-axios.js";
import { deleteMedias } from "./utils/aws.js";

dotenv.config();

const app = express();
app.use(express.static("public"));

const db = await connectDB(); // Ensure this returns MongoClient

const partsApiAuth = {
  username: process.env.PARTS_API_USER_NAME,
  password: process.env.PARTS_API_PASSWORD,
  user_token: process.env.PARTS_API_USER_TOKEN,
};

const partsEndpoint = "https://api.rrr.lt/v2/get/parts";

async function processImage(part) {
  const filePaths = [];
  if (part.part_photo_gallery.length) {
    part.part_photo_gallery = await Promise.all(
      part.part_photo_gallery.map(async (image) => {
        if (
          !image.includes("JPG") &&
          !image.includes("JPEG") &&
          !image.includes("PNG")
        ) {
          return {
            mediaContentType: "IMAGE",
            originalSource: image,
          };
        } else {
          const { fileName, filePath } = await downloadImage(image);
          filePaths.push(fileName);
          return {
            mediaContentType: "IMAGE",
            originalSource: filePath,
          };
        }
      })
    );
  } else {
    const image = part.photo;
    if (
      !image.includes("JPG") &&
      !image.includes("JPEG") &&
      !image.includes("PNG")
    ) {
      part.part_photo_gallery = [
        {
          mediaContentType: "IMAGE",
          originalSource: part.photo,
        },
      ];
    } else {
      const { fileName, filePath } = downloadImage(part.photo);
      filePaths.push(fileName);
      part.part_photo_gallery = [
        {
          mediaContentType: "IMAGE",
          originalSource: filePath,
        },
      ];
    }
  }

  return {
    part,
    filePaths,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function insertDataIntoShopify() {
  try {
    const limit = 100;
    const page = 1;

    const formData = new URLSearchParams();
    formData.append("username", partsApiAuth.username);
    formData.append("password", partsApiAuth.password);
    formData.append("user_token", partsApiAuth.user_token);

    const response = await axios.post(partsEndpoint, formData, {
      params: { page, limit },
    });

    const allParts = response.data.data;

    // Split into batches of 20
    const batchSize = 20;
    const batches = [];
    for (let i = 0; i < allParts.length; i += batchSize) {
      batches.push(allParts.slice(i, i + batchSize));
    }

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(
        `🚚 Processing batch ${batchIndex + 1} of ${batches.length}...`
      );

      for await (let part of batch) {
        const existingPart = await db
          .collection("rrr-parts")
          .findOne({ id: part.id });

        if (existingPart) {
          console.log(
            `ℹ️ Part Id : ${part.id} is already available in Shopify.`
          );
          continue;
        }

        const res = await processImage(part);
        part = res.part;

        console.log(`Media uploaded to s3 for part : ${part.id}.`)

        const safeTitle = part.name || "No Title";
        const safeNotes = part.notes || "No description";

        const variables = {
          input: {
            title: safeTitle,
            descriptionHtml: safeNotes,
          },
          media: part.part_photo_gallery,
        };

        try {
          const productResponse = await shopifyGraphQLRequest({
            query: productCreate,
            variables,
          });

          await deleteMedias(res.filePaths);
          console.log(`Media deleted from s3 for part id : ${part.id}`);

          const productId = productResponse.data.data.productCreate.product.id;
          const variantId =
            productResponse.data.data.productCreate.product.variants.edges[0]
              .node.id;

          const createVariantVariables = {
            productId,
            variants: [
              {
                id: variantId,
                price: part.original_price || "0.00",
                barcode: part.manufacturer_code || "",
              },
            ],
          };

          const variantResponse = await shopifyGraphQLRequest({
            query: createVariantQuery,
            variables: createVariantVariables,
          });

          await db.collection("rrr-parts").insertOne(part);

          await db.collection("shopify-parts").insertOne({
            ...productResponse.data.data.productCreate.product,
            ...variantResponse.data.data.productVariantsBulkUpdate
              .productVariants[0],
            rrr_partId: part.id,
            media: part.part_photo_gallery,
          });

          console.log(`✅ Part Id : ${part.id} stored in Shopify.`);
        } catch (error) {
          console.error("❌ Error creating product or variant:", error.message);
        }
      }

      // Sleep after processing a batch (except the last one)
      if (batchIndex < batches.length - 1) {
        console.log(`🕒 Waiting 5 minutes before next batch...`);
        await sleep(5 * 60 * 1000);
      }
    }
  } catch (err) {
    console.error("❌ API Error:", err.message);
  }
}

app.listen(3000, async () => {
  try {
    console.log("App started.");
    await insertDataIntoShopify();
  } catch (error) {
    console.log(error);
  }
});
